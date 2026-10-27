import assert from 'node:assert/strict';
import test from 'node:test';
import {importRoleProfiles, prepareRoleImport, RoleImportInputError} from '../web/platform/teamImport.ts';
import type {RoleImportDraft, RoleImportProgress} from '../web/platform/teamImport.ts';

test('role import gives omitted IDs a stable retry identity and rejects ambiguous input', () => {
  const input = [{name: 'Synthetic first role'}, {id: 'synthetic-second', name: 'Synthetic second role'}];
  const roles = prepareRoleImport(input, () => 'synthetic-generated');
  assert.deepEqual(roles.map(role => role.id), ['synthetic-generated', 'synthetic-second']);
  assert.equal('id' in input[0], false);
  for (const value of [null, {}, [], [null], [{id: 5}], [{id: ''}], [{id: 'same'}, {id: 'same'}]]) {
    assert.throws(() => prepareRoleImport(value, () => 'synthetic-generated'), RoleImportInputError);
  }
});

test('partial role import retries the failed and unattempted remainder without resending confirmed roles', async () => {
  const original = prepareRoleImport([{id: 'first', name: 'Synthetic first'}, {id: 'second', name: ''}, {id: 'third', name: 'Synthetic third'}], () => 'unused');
  const saved = new Set<string>(), calls: {id: string; revision: number}[] = [], progress: RoleImportProgress[] = [];
  let revision = 1, reads = 0;
  const api = {
    async readRevision() {reads++; return revision;},
    async createRole(role: RoleImportDraft, expectedRevision: number) {
      assert.equal(expectedRevision, revision);
      calls.push({id: role.id, revision: expectedRevision});
      if (!role.name) throw new Error('Synthetic role validation rejected the missing name.');
      assert.equal(saved.has(role.id), false, 'A confirmed role must not be sent again.');
      saved.add(role.id);
      return {revision: ++revision};
    },
  };
  const first = await importRoleProfiles(original, api, value => progress.push(value));
  assert.equal(first.failed, true);
  assert.equal(first.confirmed, 1);
  assert.deepEqual(first.remaining.map(role => role.id), ['second', 'third']);
  assert.deepEqual(progress.map(value => [value.confirmed, value.remaining.map(role => role.id)]), [[1, ['second', 'third']]]);
  assert.deepEqual(original.map(role => role.id), ['first', 'second', 'third']);
  const retry = await importRoleProfiles(first.remaining.map(role => role.id === 'second' ? {...role, name: 'Synthetic repaired name'} : role), api, () => {});
  assert.equal(retry.failed, false);
  assert.equal(retry.confirmed, 2);
  assert.deepEqual(retry.remaining, []);
  assert.deepEqual(calls, [{id: 'first', revision: 1}, {id: 'second', revision: 2}, {id: 'second', revision: 2}, {id: 'third', revision: 3}]);
  assert.equal(reads, 2, 'Each retry gets the current team revision; valid POST receipts advance the batch.');
});

test('a failed metadata refresh after a successful role never puts that role back in the retry input', async () => {
  const roles = prepareRoleImport([{id: 'saved', name: 'Synthetic saved role'}, {id: 'pending', name: 'Synthetic pending role'}], () => 'unused');
  const calls: string[] = [], progress: RoleImportProgress[] = [];
  let reads = 0;
  const first = await importRoleProfiles(roles, {
    async readRevision() {if (++reads === 2) throw new Error('Synthetic team refresh failed after saving.'); return 1;},
    async createRole(role) {calls.push(role.id); return null;},
  }, value => progress.push(value));
  assert.equal(first.failed, true);
  assert.equal(first.confirmed, 1);
  assert.deepEqual(first.remaining.map(role => role.id), ['pending']);
  assert.equal(progress[0].confirmed, 1);
  const retry = await importRoleProfiles(first.remaining, {
    async readRevision() {return 2;},
    async createRole(role, revision) {assert.equal(revision, 2); calls.push(role.id); return {revision: 3};},
  }, () => {});
  assert.equal(retry.failed, false);
  assert.deepEqual(calls, ['saved', 'pending']);
});

test('revision discovery failure does not create roles or discard retry input', async () => {
  const roles = prepareRoleImport([{name: 'Synthetic pending role'}], () => 'stable-synthetic-id');
  const result = await importRoleProfiles(roles, {
    async readRevision() {throw new Error('Synthetic team is temporarily unavailable.');},
    async createRole() {assert.fail('No role may be created without a revision.');},
  }, () => assert.fail('No role was confirmed.'));
  assert.equal(result.failed, true);
  assert.equal(result.confirmed, 0);
  assert.deepEqual(result.remaining, roles);
  assert.equal(result.remaining[0].id, 'stable-synthetic-id');
});
