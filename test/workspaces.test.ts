import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Project} from '../src/contracts.ts';
import {defaultRoles} from '../src/defaults.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import {Workspaces} from '../src/workspaces.ts';

const execute = promisify(execFile);
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-workspace-test-')), source = path.join(directory, 'source');
  await mkdir(source);
  const git = (...args: string[]) => execute('git', ['-C', source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', ...args]);
  await git('init', '--template=');
  await writeFile(path.join(source, '.gitignore'), '.local/\n.env\nnode_modules/\n');
  await writeFile(path.join(source, 'tracked.txt'), 'Committed synthetic input.\n');
  await writeFile(path.join(source, 'package-lock.json'), '{"name":"synthetic-workspace","lockfileVersion":3,"packages":{}}\n');
  await git('add', '--', '.gitignore', 'tracked.txt', 'package-lock.json'); await git('commit', '-m', 'Create synthetic committed input');
  const store = new Store(path.join(directory, 'state')), workspaces = new Workspaces(store, path.join(directory, 'executions'));
  const project: Project = {id: 'synthetic-project', revision: 1, name: 'Synthetic isolated project', description: '', workspace: source, repository: '', roles: defaultRoles(), knowledgeSources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
  t.after(async () => {store.close(); await rm(directory, {recursive: true, force: true});});
  return {directory, source, git, store, workspaces, project};
}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

test('execution checkout uses committed input and excludes dirty, untracked, ignored and installed dependency state', async t => {
  const h = await fixture(t), commit = (await h.git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(path.join(h.source, 'tracked.txt'), 'Private dirty source edit.\n');
  await writeFile(path.join(h.source, 'scratch.txt'), 'Private untracked scratch.\n');
  await mkdir(path.join(h.source, '.local')); await writeFile(path.join(h.source, '.local', 'runtime.json'), '{"syntheticPrivate":"keep local"}\n');
  await writeFile(path.join(h.source, '.env'), 'SYNTHETIC_PRIVATE_VALUE=local-only\n');
  await mkdir(path.join(h.source, 'node_modules')); await writeFile(path.join(h.source, 'node_modules', 'synthetic-private-cache.txt'), 'Private installed state.\n');
  const [first, concurrent] = await Promise.all([h.workspaces.ensure(h.project, 'synthetic-run'), h.workspaces.ensure(h.project, 'synthetic-run')]);
  assert.deepEqual(first, concurrent); assert.equal(first.sourceCommit, commit); assert.notEqual(first.path, h.source);
  assert.equal(await readFile(path.join(first.path, 'tracked.txt'), 'utf8'), 'Committed synthetic input.\n');
  for (const file of ['scratch.txt', '.local', '.env', 'node_modules']) assert.equal(await lstat(path.join(first.path, file)).catch(() => null), null, `Private input is absent: ${file}`);
  await writeFile(path.join(first.path, 'tracked.txt'), 'Isolated synthetic correction.\n');
  assert.equal(await readFile(path.join(h.source, 'tracked.txt'), 'utf8'), 'Private dirty source edit.\n');
  const changes = await h.workspaces.changes(first.id); assert.match(changes.diff, /Isolated synthetic correction/); assert.match(changes.status, /tracked\.txt/);
  await h.git('add', '--', 'tracked.txt'); await h.git('commit', '-m', 'Advance the synthetic source revision');
  const restored = new Workspaces(h.store, path.join(h.directory, 'executions'));
  assert.deepEqual(await restored.ensure(h.project, first.id), first); assert.equal((await restored.artifact(first.id, 'tracked.txt')).sourceCommit, commit);
});

test('execution artifact previews reject traversal, private paths, symlink escapes and oversized files', async t => {
  const h = await fixture(t), record = await h.workspaces.ensure(h.project, 'synthetic-preview-run');
  assert.equal((await h.workspaces.artifact(record.id, 'tracked.txt')).content, 'Committed synthetic input.\n');
  const outside = path.join(h.directory, 'synthetic-private.txt'); await writeFile(outside, 'Private outside content.\n');
  await symlink(outside, path.join(record.path, 'escape.txt'));
  await writeFile(path.join(record.path, 'oversized.txt'), 'x'.repeat(512 * 1024 + 1));
  for (const relative of ['../synthetic-private.txt', '.git/config', '.local/runtime.json', '.env', outside]) await assert.rejects(h.workspaces.artifact(record.id, relative), code('INVALID_ARTIFACT_PATH'));
  await assert.rejects(h.workspaces.artifact(record.id, 'escape.txt'), code('INVALID_ARTIFACT_PATH'));
  await assert.rejects(h.workspaces.artifact(record.id, 'oversized.txt'), code('ARTIFACT_NOT_PREVIEWABLE'));
  await assert.rejects(h.workspaces.ensure(h.project, '../escape-run'), code('INVALID_EXECUTION_ID'));
});
