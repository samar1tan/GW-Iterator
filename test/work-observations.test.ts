import assert from 'node:assert/strict';
import test from 'node:test';
import type {AuditEvent, Intake, Pipeline, Project, ProjectDetail, Run} from '../src/contracts.ts';
import {observeProjectWork, withCreatedWork} from '../web/platform/workObservations.ts';
import type {CreatedWork} from '../web/platform/workObservations.ts';

const timestamp = '2026-01-01T00:00:00Z';
function project(id = 'example', revision = 1): Project {
  return {id, revision, name: 'Synthetic project', description: 'Independent observation fixture.',
    workspace: '/synthetic/project', repository: 'synthetic/project', roles: [], knowledgeSources: [],
    createdAt: timestamp, updatedAt: timestamp};
}
function event(projectId: string, seq: number): AuditEvent {
  return {seq, projectId, at: timestamp, runId: null, stageId: null,
    type: 'run.created', actor: 'Synthetic owner', message: 'Synthetic work recorded.'};
}
function detail(projectId = 'example', seq = 10, revision = 1): ProjectDetail {
  return {project: project(projectId, revision), pipelines: [], runs: [], intakes: [],
    knowledge: [], proposals: [], events: [event(projectId, seq)]};
}
function run(id = 'created-run', projectId = 'example'): Run {
  const owner = project(projectId);
  const pipeline: Pipeline = {id: 'synthetic-flow', projectId, revision: 1,
    name: 'Synthetic human flow', description: 'Record synthetic evidence.', roleId: 'owner',
    stages: [], policy: {concurrency: 1, maxAttempts: 2, maxIterations: 1, timeoutSeconds: 300, tokenBudget: 1000},
    updatedAt: timestamp};
  return {id, projectId, pipelineId: pipeline.id, goal: 'Inspect the synthetic evidence.',
    baseline: 'synthetic-baseline', trigger: {kind: 'human', actor: 'Synthetic owner'},
    status: 'queued', iteration: 1, mode: 'once', createdAt: timestamp, updatedAt: timestamp,
    dependsOnRunIds: [], idempotencyKey: 'synthetic-run-key', inputHash: 'synthetic-hash',
    snapshot: {project: owner, pipeline, pipelines: [pipeline], knowledge: []}, stages: []};
}
function intake(id = 'created-intake', projectId = 'example'): Intake {
  return {id, projectId, request: 'Inspect the synthetic evidence.', baseline: 'synthetic-baseline',
    status: 'routing', createdAt: timestamp, updatedAt: timestamp, routerRunId: 'synthetic-router',
    idempotencyKey: 'synthetic-intake-key', targetRunIds: [], rounds: [],
    policy: {maxRounds: 2, maxParallel: 1, maxTotalTokens: 1000, maxElapsedSeconds: 300}};
}

test('local receipts add only missing identities in their project without replacing observed work', () => {
  const before = detail();
  const createdRun = run(), createdIntake = intake();
  const withRun = withCreatedWork(before, {kind: 'run', value: createdRun});
  const withBoth = withCreatedWork(withRun, {kind: 'intake', value: createdIntake});
  assert.deepEqual(before.runs, []);
  assert.deepEqual(before.intakes, []);
  assert.equal(withBoth.runs[0], createdRun);
  assert.equal(withBoth.intakes[0], createdIntake);
  assert.equal(withCreatedWork(withBoth, {kind: 'run', value: {...createdRun, status: 'failed'}}), withBoth);
  assert.equal(withCreatedWork(withBoth, {kind: 'intake', value: {...createdIntake, status: 'stopped'}}), withBoth);
  assert.equal(withCreatedWork(withBoth, {kind: 'run', value: run('other', 'another-project')}), withBoth);
  assert.equal(withBoth.events, before.events);
});

test('a pre-start GET arriving after creation and a subsequent 503 retain the created work', async () => {
  const beforeStart = detail();
  let pending: CreatedWork[] = [];
  let current = beforeStart;
  let finishOldGet!: (value: ProjectDetail) => void;
  const oldGet = new Promise<ProjectDetail>(resolve => {finishOldGet = resolve;});
  const read = async (response: Promise<ProjectDetail>) => {
    const incoming = await response;
    const observed = observeProjectWork(current, incoming, pending);
    current = observed.detail;
    pending = observed.pending;
  };
  const oldRead = read(oldGet);
  pending = [{kind: 'run', value: run()}, {kind: 'intake', value: intake()}];
  current = pending.reduce(withCreatedWork, current);
  finishOldGet(beforeStart);
  await oldRead;
  assert.deepEqual(current.runs.map(value => value.id), ['created-run']);
  assert.deepEqual(current.intakes.map(value => value.id), ['created-intake']);
  assert.equal(pending.length, 2);
  const retained = current;
  await assert.rejects(read(Promise.reject(new Error('Synthetic HTTP 503'))), /503/);
  assert.equal(current, retained, 'A failed GET supplies no observation to merge.');
  assert.equal(pending.length, 2);
});

test('a newer server observation acknowledges receipts and a later old snapshot cannot erase them', () => {
  const createdRun = run(), createdIntake = intake();
  const pending: CreatedWork[] = [{kind: 'run', value: createdRun}, {kind: 'intake', value: createdIntake}];
  const local = pending.reduce(withCreatedWork, detail());
  const observedRun: Run = {...createdRun, status: 'waiting'};
  const observedIntake: Intake = {...createdIntake, status: 'clarification', question: 'Inspect the synthetic result.'};
  const incoming = {...detail('example', 12), runs: [observedRun], intakes: [observedIntake]};
  const accepted = observeProjectWork(local, incoming, pending);
  assert.equal(accepted.detail, incoming);
  assert.equal(accepted.detail.runs[0], observedRun);
  assert.equal(accepted.detail.intakes[0], observedIntake);
  assert.deepEqual(accepted.pending, []);
  const late = observeProjectWork(accepted.detail, detail('example', 10), accepted.pending);
  assert.equal(late.detail, accepted.detail);
  assert.equal(late.detail.runs[0].status, 'waiting');
  assert.equal(late.detail.intakes[0].status, 'clarification');
});

test('either an older project revision or audit sequence rejects the complete observation', () => {
  const current = detail('example', 20, 3);
  assert.equal(observeProjectWork(current, detail('example', 19, 4), []).detail, current);
  assert.equal(observeProjectWork(current, detail('example', 21, 2), []).detail, current);
  const next = detail('example', 21, 3);
  assert.equal(observeProjectWork(current, next, []).detail, next);
  assert.equal(observeProjectWork(null, next, []).detail, next);
  assert.equal(observeProjectWork(undefined, next, []).detail, next);
});

test('audit order and unrelated events cannot change a project observation watermark', () => {
  const current = {...detail('example', 20), events: [event('example', 20), event('example', 18), event('another-project', 100)]};
  const next = {...detail('example', 21), events: [event('example', 21), event('example', 19)]};
  assert.equal(observeProjectWork(current, next, []).detail, next);
  assert.equal(observeProjectWork(current, detail('example', 19), []).detail, current);
});

test('a rejected observation cannot consume a still-pending receipt', () => {
  const receipt: CreatedWork = {kind: 'run', value: run()};
  const current = withCreatedWork(detail('example', 20), receipt);
  const staleWithReceipt = {...detail('example', 19), runs: [run()]};
  const observed = observeProjectWork(current, staleWithReceipt, [receipt]);
  assert.equal(observed.detail, current);
  assert.deepEqual(observed.pending, [receipt]);
});

test('run and intake identities are distinct and repeated receipts never duplicate list entries', () => {
  const createdRun = run('shared-id'), createdIntake = intake('shared-id');
  const runReceipt: CreatedWork = {kind: 'run', value: createdRun};
  const intakeReceipt: CreatedWork = {kind: 'intake', value: createdIntake};
  const incoming = {...detail(), runs: [createdRun]};
  const observed = observeProjectWork(null, incoming, [runReceipt, runReceipt, intakeReceipt, intakeReceipt]);
  assert.deepEqual(observed.detail.runs.map(value => value.id), ['shared-id']);
  assert.deepEqual(observed.detail.intakes.map(value => value.id), ['shared-id']);
  assert.deepEqual(observed.pending, [intakeReceipt]);
});

test('project switches compare only that project and preserve unrelated pending receipts', () => {
  const firstReceipt: CreatedWork = {kind: 'run', value: run('first-run', 'first-project')};
  const secondReceipt: CreatedWork = {kind: 'intake', value: intake('second-intake', 'second-project')};
  const first = withCreatedWork(detail('first-project', 100, 7), firstReceipt);
  const second = observeProjectWork(first, detail('second-project', 2, 1), [firstReceipt, secondReceipt]);
  assert.equal(second.detail.project.id, 'second-project');
  assert.deepEqual(second.detail.runs, []);
  assert.deepEqual(second.detail.intakes.map(value => value.id), ['second-intake']);
  assert.deepEqual(second.pending, [firstReceipt, secondReceipt]);
  const confirmed = observeProjectWork(second.detail, {...detail('second-project', 3), intakes: [secondReceipt.value]}, second.pending);
  assert.deepEqual(confirmed.pending, [firstReceipt]);
  assert.deepEqual(confirmed.detail.runs, []);
  assert.equal(first.runs[0], firstReceipt.value);
});
