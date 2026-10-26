import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer as createNetServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {Engine} from '../src/engine.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import type {Actor, CodexInfo, ExecutionRef, KnowledgeEntry, Pipeline, Project, Run, Stage, StartRunInput, TaskOutput, Usage} from '../src/contracts.ts';
import type {AgentExecutionInput, CodexAdapter, CodexExecution, CodexExecutionInput, GithubAdapter, GithubObservation} from '../src/adapters/types.ts';

const OWNER: Actor = {name: 'Synthetic owner', kind: 'human'};
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Synthetic task completed.', artifacts: [], observations: []};
const result = (summary: string, outcome: TaskOutput['outcome'] = 'done'): TaskOutput => ({...OUTPUT, summary, outcome});
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const value = {settled: false, promise: new Promise<T>((resolveValue, rejectValue) => {resolvePromise = resolveValue; rejectPromise = rejectValue;}),
    resolve(value: T) {if (!this.settled) {this.settled = true; resolvePromise(value);}},
    reject(error: Error) {if (!this.settled) {this.settled = true; rejectPromise(error);}}};
  void value.promise.catch(() => {});
  return value;
}
type SyntheticCall = {
  input: CodexExecutionInput; ref: ExecutionRef; aborted: boolean;
  completion: ReturnType<typeof deferred<{output: TaskOutput; usage?: Usage}>>;
  finish(output?: TaskOutput, usage?: Usage): void;
};

class SyntheticCodex implements CodexAdapter {
  calls: SyntheticCall[] = [];
  abortBehavior: 'reject' | 'defer' = 'reject';
  prefix: string;
  constructor(prefix = 'synthetic') {this.prefix = prefix;}
  async info(): Promise<CodexInfo> {return {available: true, connected: true, authenticated: true, models: []};}
  async skills() {return [];}
  async start(input: CodexExecutionInput): Promise<CodexExecution> {
    const index = this.calls.length + 1;
    const ref = {threadId: `${this.prefix}-thread-${index}`, turnId: `${this.prefix}-turn-${index}`};
    const completion = deferred<{output: TaskOutput; usage?: Usage}>();
    const call: SyntheticCall = {input, ref, aborted: false, completion,
      finish(output = OUTPUT, usage) {completion.resolve({output, ...(usage ? {usage} : {})});}};
    const abort = () => {call.aborted = true; if (this.abortBehavior === 'reject') completion.reject(new Error('Synthetic native execution interrupted.'));};
    input.signal.addEventListener('abort', abort, {once: true});
    void completion.promise.finally(() => input.signal.removeEventListener('abort', abort)).catch(() => {});
    this.calls.push(call);
    input.onEvent({type: 'synthetic.started', message: 'Synthetic adapter execution started.', ref});
    if (input.signal.aborted) abort();
    return {ref, completion: completion.promise};
  }
  async steer() {}
  async interrupt(ref: ExecutionRef) {this.calls.find(call => call.ref.threadId === ref.threadId)?.completion.reject(new Error('Synthetic turn interrupted.'));}
  async close() {for (const call of this.calls) call.completion.reject(new Error('Synthetic adapter closed.')); await immediate();}
}

class SyntheticGithub implements GithubAdapter {
  observations: {repository: string; options: unknown}[] = [];
  dispatches: unknown[] = [];
  replies: (GithubObservation | Promise<GithubObservation>)[] = [];
  pending: ReturnType<typeof deferred<GithubObservation>>[] = [];
  async info() {return {available: true, authenticated: true};}
  queue(value: GithubObservation) {this.replies.push(value);}
  defer() {const value = deferred<GithubObservation>(); this.replies.push(value.promise); this.pending.push(value); return value;}
  async observe(repository: string, options: unknown) {
    this.observations.push({repository, options});
    return await (this.replies.shift() ?? {status: 'completed', summary: 'Synthetic CI passed.', runId: 314, url: 'https://example.invalid/actions/314'});
  }
  async dispatch(repository: string, workflow: string, ref: string) {this.dispatches.push({repository, workflow, ref}); return this.observe(repository, {workflow, ref});}
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-engine-test-'));
  const workspace = path.join(directory, 'workspace');
  const stateDirectory = path.join(directory, 'state');
  await mkdir(workspace);
  const codex = new SyntheticCodex();
  const github = new SyntheticGithub();
  const h = {directory, workspace, stateDirectory, codex, github, engine: new Engine(new Store(stateDirectory), codex, github)};
  t.after(async () => {
    for (const pending of h.github.pending) pending.resolve({status: 'queued', summary: 'Synthetic fixture teardown.', runId: 314});
    await immediate();
    await h.engine.close();
    await rm(directory, {recursive: true, force: true});
  });
  return h;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pump(h: Fixture, condition: () => boolean, label: string) {
  for (let count = 0; count < 100; count++) {
    await h.engine.tick();
    await immediate();
    if (condition()) return;
  }
  assert.fail(`Synthetic workflow did not reach ${label}.`);
}
async function project(h: Fixture) {return h.engine.createProject({name: 'Synthetic project', workspace: h.workspace, repository: 'synthetic-owner/synthetic-repository'}, OWNER);}
function stage(id: string, dependsOn: string[] = [], extra: Partial<Stage> = {}): Stage {
  return {id, name: `Synthetic ${id}`, roleId: 'development', executor: 'codex', dependsOn, prompt: `Perform the synthetic ${id} task.`, review: false, ...extra};
}
function pipeline(h: Fixture, project: Project, stages: Stage[], policy: Partial<Pipeline['policy']> = {}) {
  const initial = h.engine.createPipeline({projectId: project.id, roleId: 'development', name: 'Synthetic workflow'}, OWNER);
  return h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages, policy: {concurrency: 1, maxAttempts: 3, maxIterations: 2, timeoutSeconds: 30, tokenBudget: 1000, ...policy}}, OWNER);
}
function start(h: Fixture, project: Project, pipeline: Pipeline, extra: Partial<StartRunInput> = {}) {
  return h.engine.startRun({projectId: project.id, pipelineId: pipeline.id, goal: 'Complete the bounded synthetic task.', baseline: 'Synthetic fixture baseline.', idempotencyKey: randomUUID(), ...extra}, OWNER);
}
const state = (run: Run, id: string) => run.stages.find(stage => stage.stageId === id)!;
const errorCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test('manual dependencies and delivery wait for real recorded outcomes', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('inspect', [], {executor: 'manual'}), stage('repair', ['inspect']), stage('deliver', ['repair'], {executor: 'manual'})]);
  const run = start(h, p, flow);
  await pump(h, () => state(h.engine.run(run.id), 'inspect').status === 'waiting', 'the first manual gate');
  assert.equal(h.codex.calls.length, 0);
  assert.throws(() => h.engine.completeManual(run.id, 'deliver', OUTPUT, OWNER), errorCode('INVALID_STAGE_STATE'));
  h.engine.completeManual(run.id, 'inspect', result('Confirmed the synthetic mismatch.'), OWNER);
  await pump(h, () => h.codex.calls.length === 1, 'the dependent Codex task');
  assert.match(h.codex.calls[0].input.prompt, /Confirmed the synthetic mismatch/);
  h.codex.calls[0].finish(result('Prepared the synthetic correction.'));
  await pump(h, () => state(h.engine.run(run.id), 'deliver').status === 'waiting', 'the delivery gate');
  assert.equal(h.engine.run(run.id).status, 'waiting');
  assert.equal(h.engine.run(run.id).endedAt, undefined);
  h.engine.completeManual(run.id, 'deliver', result('Recorded the synthetic verification.'), OWNER);
  await pump(h, () => h.engine.run(run.id).status === 'completed', 'manual delivery completion');
  const ended = h.engine.run(run.id);
  assert.ok(ended.stages.every(stage => stage.status === 'completed' && stage.attempts[0].endedAt));
  assert.equal(h.engine.store.events({runId: run.id}).filter(event => event.type === 'manual.completed').length, 2);
});

test('review revision retains the reviewer and earlier output while rerunning the required task', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('work', [], {review: true}), stage('follow', ['work'])]);
  const run = start(h, p, flow);
  await pump(h, () => h.codex.calls.length === 1, 'the first attempt');
  h.codex.calls[0].finish(result('First synthetic result.'), {input: 8, output: 2, total: 10});
  await pump(h, () => state(h.engine.run(run.id), 'work').status === 'review', 'review');
  assert.equal(h.codex.calls.length, 1);
  h.engine.review(run.id, 'work', 'revise', 'Add the missing synthetic evidence.', OWNER);
  await pump(h, () => h.codex.calls.length === 2, 'the revised attempt');
  const previous = state(h.engine.run(run.id), 'work').attempts[0];
  assert.equal(previous.output?.summary, 'First synthetic result.');
  assert.deepEqual(previous.usage, {input: 8, output: 2, total: 10});
  assert.equal(previous.review?.actor, OWNER.name);
  assert.equal(previous.review?.note, 'Add the missing synthetic evidence.');
  assert.equal(previous.status, 'completed');
  assert.match(h.codex.calls[1].input.prompt, /Add the missing synthetic evidence/);
  h.codex.calls[1].finish(result('Revised synthetic result.'));
  await pump(h, () => state(h.engine.run(run.id), 'work').status === 'review', 'the second review');
  h.engine.review(run.id, 'work', 'accept', 'The requested evidence is present.', OWNER);
  await pump(h, () => h.codex.calls.length === 3, 'the downstream task');
  assert.match(h.codex.calls[2].input.prompt, /Revised synthetic result/);
  h.codex.calls[2].finish();
  await pump(h, () => h.engine.run(run.id).status === 'completed', 'reviewed workflow completion');
  const attempts = state(h.engine.run(run.id), 'work').attempts;
  assert.deepEqual(attempts.map(attempt => attempt.number), [1, 2]);
  assert.equal(attempts[1].review?.decision, 'accept');
});

test('completed output requesting revision returns to the upstream task and invalidates downstream work', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('implement'), stage('verify', ['implement'], {reworkTo: 'implement'}), stage('deliver', ['verify'], {executor: 'manual'})]);
  const run = start(h, p, flow);
  await pump(h, () => h.codex.calls.length === 1, 'implementation');
  h.codex.calls[0].finish(result('First synthetic implementation.'));
  await pump(h, () => h.codex.calls.length === 2, 'verification');
  h.codex.calls[1].finish(result('Correct the synthetic regression.', 'revise'));
  await pump(h, () => h.codex.calls.length === 3, 'upstream rework');
  let current = h.engine.run(run.id);
  assert.equal(current.status, 'running');
  assert.equal(state(current, 'verify').attempts[0].status, 'completed');
  assert.equal(state(current, 'verify').attempts[0].output?.outcome, 'revise');
  assert.equal(state(current, 'deliver').attempts.length, 0);
  assert.match(h.codex.calls[2].input.prompt, /Correct the synthetic regression/);
  h.codex.calls[2].finish(result('Revised synthetic implementation.'));
  await pump(h, () => h.codex.calls.length === 4, 'repeated verification');
  h.codex.calls[3].finish(result('The synthetic regression is fixed.'));
  await pump(h, () => state(h.engine.run(run.id), 'deliver').status === 'waiting', 'delivery after re-verification');
  h.engine.completeManual(run.id, 'deliver', OUTPUT, OWNER);
  current = h.engine.run(run.id);
  assert.equal(current.status, 'completed');
  assert.equal(state(current, 'implement').attempts.length, 2);
  assert.equal(state(current, 'verify').attempts.length, 2);
  assert.equal(current.stages.some(stage => stage.attempts.some(attempt => attempt.error?.includes('ACTIVE_REWORK'))), false);
});

test('review rework stops at the frozen attempt limit', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('work', [], {review: true})], {maxAttempts: 2});
  const run = start(h, p, flow);
  for (let attempt = 0; attempt < 2; attempt++) {
    await pump(h, () => h.codex.calls.length === attempt + 1, 'a bounded attempt');
    h.codex.calls[attempt].finish(result(`Synthetic attempt ${attempt + 1}.`));
    await pump(h, () => state(h.engine.run(run.id), 'work').status === 'review', 'bounded review');
    h.engine.review(run.id, 'work', 'revise', 'The synthetic requirement remains unmet.', OWNER);
  }
  await pump(h, () => h.engine.run(run.id).status === 'failed', 'the attempt limit');
  assert.equal(h.codex.calls.length, 2);
  assert.equal(state(h.engine.run(run.id), 'work').attempts.length, 2);
  assert.match(h.engine.run(run.id).stopReason!, /Attempt limit/);
});

test('cancellation waits for an in-flight GitHub observation and closes every local state', async t => {
  for (const phase of ['initial', 'poll'] as const) await t.test(phase, async sub => {
    const h = await fixture(sub), p = await project(h);
    if (phase === 'poll') h.github.queue({status: 'running', summary: 'Synthetic CI is running.', runId: 314});
    const observation = h.github.defer();
    const flow = pipeline(h, p, [stage('ci', [], {executor: 'github', options: {mode: 'observe'}}), stage('deliver', ['ci'], {executor: 'manual'})]);
    const run = start(h, p, flow);
    await pump(h, () => h.github.observations.length === (phase === 'poll' ? 2 : 1), `the ${phase} observation`);
    const cancelling = await h.engine.cancel(run.id, 'Stop this synthetic observation.', OWNER);
    assert.equal(cancelling.cancelRequested, true);
    assert.equal(cancelling.status, 'running');
    assert.equal(cancelling.endedAt, undefined);
    observation.resolve({status: 'queued', summary: 'External synthetic CI is queued.', runId: 314, url: 'https://example.invalid/actions/314'});
    await pump(h, () => h.engine.run(run.id).status === 'cancelled', 'local observation cancellation');
    const ended = h.engine.run(run.id), ci = state(ended, 'ci');
    assert.equal(ci.status, 'cancelled');
    assert.equal(ci.attempts[0].status, 'cancelled');
    assert.ok(ci.attempts[0].endedAt);
    assert.equal(ci.attempts[0].ref?.externalId, '314');
    assert.match(ci.attempts[0].error!, /external CI may continue/i);
    assert.equal(state(ended, 'deliver').attempts.length, 0);
    assert.equal(h.github.dispatches.length, 0);
  });
});

test('a cancelling parent waits for the linked child to acknowledge its end', async t => {
  const h = await fixture(t), p = await project(h);
  h.codex.abortBehavior = 'defer';
  const childFlow = pipeline(h, p, [stage('child-work')]);
  const parentFlow = pipeline(h, p, [stage('child', [], {executor: 'pipeline', options: {pipelineId: childFlow.id}})]);
  const parent = start(h, p, parentFlow);
  await pump(h, () => h.codex.calls.length === 1, 'child execution');
  const childId = state(h.engine.run(parent.id), 'child').attempts[0].ref!.childRunId!;
  const child = h.engine.run(childId);
  assert.equal(child.parentRunId, parent.id);
  assert.equal(child.parentStageId, 'child');
  const cancelling = await h.engine.cancel(parent.id, 'Cancel this synthetic family.', OWNER);
  assert.equal(cancelling.status, 'running');
  assert.equal(cancelling.endedAt, undefined);
  assert.equal(state(cancelling, 'child').status, 'running');
  assert.equal(h.engine.run(childId).status, 'running');
  assert.equal(h.engine.run(childId).cancelRequested, true);
  assert.equal(h.codex.calls[0].aborted, true);
  h.codex.calls[0].finish(result('Synthetic late native completion.'));
  await pump(h, () => h.engine.run(parent.id).status === 'cancelled', 'both cancellation acknowledgements');
  assert.equal(h.engine.run(childId).status, 'cancelled');
  assert.equal(state(h.engine.run(childId), 'child-work').attempts[0].status, 'cancelled');
  assert.equal(state(h.engine.run(parent.id), 'child').attempts[0].status, 'cancelled');
});

test('linked pipeline completion waits for its child review decision', async t => {
  const h = await fixture(t), p = await project(h);
  const childFlow = pipeline(h, p, [stage('child-work', [], {review: true})]);
  const parentFlow = pipeline(h, p, [stage('child', [], {executor: 'pipeline', options: {pipelineId: childFlow.id}})]);
  const parent = start(h, p, parentFlow);
  await pump(h, () => h.codex.calls.length === 1, 'the reviewed child');
  const childId = state(h.engine.run(parent.id), 'child').attempts[0].ref!.childRunId!;
  h.codex.calls[0].finish();
  await pump(h, () => h.engine.run(childId).status === 'review', 'child review');
  assert.equal(h.engine.run(parent.id).status, 'running');
  h.engine.review(childId, 'child-work', 'accept', 'Synthetic child evidence accepted.', OWNER);
  await pump(h, () => h.engine.run(parent.id).status === 'completed', 'the accepted child result');
  assert.equal(state(h.engine.run(parent.id), 'child').attempts[0].ref?.childRunId, childId);
});

test('project, pipeline and knowledge revisions stay frozen for a run and its later child', async t => {
  const h = await fixture(t);
  const source = path.join(h.workspace, 'synthetic-history.txt');
  await writeFile(source, 'Original synthetic knowledge.');
  let p = await project(h);
  p = await h.engine.updateProject(p.id, p.revision, {...p, knowledgeSources: [{id: 'synthetic-source', kind: 'document', path: source, roles: ['development']}]}, OWNER);
  await h.engine.sync(p.id, OWNER);
  const childFlow = pipeline(h, p, [stage('child-work', [], {prompt: 'Original synthetic child instructions.'})]);
  const parentFlow = pipeline(h, p, [stage('gate', [], {executor: 'manual'}), stage('child', ['gate'], {executor: 'pipeline', options: {pipelineId: childFlow.id}})]);
  const parent = start(h, p, parentFlow);
  const frozen = structuredClone(h.engine.run(parent.id).snapshot);
  await writeFile(source, 'Updated synthetic knowledge.');
  await h.engine.sync(p.id, OWNER);
  const updatedProject = structuredClone(p);
  const role = updatedProject.roles.find(role => role.id === 'development')!;
  role.instructions = 'Updated synthetic role instructions.';
  role.tools = [];
  p = await h.engine.updateProject(p.id, p.revision, updatedProject, OWNER);
  const revisedChild = h.engine.updatePipeline(childFlow.id, childFlow.revision, {...childFlow, stages: [stage('child-work', [], {prompt: 'Updated synthetic child instructions.'})]}, OWNER);
  h.engine.updatePipeline(parentFlow.id, parentFlow.revision, {...parentFlow, name: 'Updated synthetic parent workflow'}, OWNER);
  assert.deepEqual(h.engine.run(parent.id).snapshot, frozen);
  assert.equal(h.engine.store.list<KnowledgeEntry>('knowledge')[0].revision, 2);
  const history = h.engine.store.list<{projectId: string; revision: number; document: Project}>('project-revision');
  assert.equal(history.find(entry => entry.projectId === p.id && entry.revision === frozen.project.revision)?.document.roles.find(role => role.id === 'development')?.instructions, frozen.project.roles.find(role => role.id === 'development')?.instructions);
  h.engine.completeManual(parent.id, 'gate', OUTPUT, OWNER);
  await pump(h, () => h.codex.calls.length === 1, 'the frozen child');
  const childId = state(h.engine.run(parent.id), 'child').attempts[0].ref!.childRunId!;
  const child = h.engine.run(childId);
  assert.equal(child.snapshot.project.revision, frozen.project.revision);
  assert.equal(child.snapshot.pipeline.revision, childFlow.revision);
  assert.ok(h.codex.calls[0].input.role.instructions.startsWith(frozen.project.roles.find(role => role.id === 'development')!.instructions));
  assert.match(h.codex.calls[0].input.role.instructions, /Current stage: Synthetic child-work/);
  assert.match(h.codex.calls[0].input.role.instructions, /Original synthetic child instructions/);
  assert.doesNotMatch(h.codex.calls[0].input.role.instructions, /Updated synthetic child instructions/);
  assert.match(h.codex.calls[0].input.prompt, /Original synthetic child instructions/);
  assert.match(h.codex.calls[0].input.prompt, /Original synthetic knowledge/);
  assert.doesNotMatch(h.codex.calls[0].input.prompt, /Updated synthetic knowledge/);
  const knowledge = await h.codex.calls[0].input.onTool('knowledge.search', {query: 'Original'});
  assert.equal((knowledge as KnowledgeEntry[])[0].revision, 1);
  assert.equal((knowledge as KnowledgeEntry[])[0].content, 'Original synthetic knowledge.');
  await assert.rejects(h.codex.calls[0].input.onTool('context.read', {projectId: 'another-synthetic-project'}), errorCode('PROJECT_SCOPE'));
  h.codex.calls[0].finish();
  await pump(h, () => h.engine.run(parent.id).status === 'completed', 'the original family completion');
  assert.deepEqual(h.engine.run(parent.id).snapshot, frozen);
  const fresh = start(h, p, revisedChild);
  await pump(h, () => h.codex.calls.length === 2, 'a new revision run');
  assert.ok(h.codex.calls[1].input.role.instructions.startsWith('Updated synthetic role instructions.'));
  assert.match(h.codex.calls[1].input.role.instructions, /Updated synthetic child instructions/);
  assert.match(h.codex.calls[1].input.prompt, /Updated synthetic child instructions/);
  assert.match(h.codex.calls[1].input.prompt, /Updated synthetic knowledge/);
  h.codex.calls[1].finish();
  await pump(h, () => h.engine.run(fresh.id).status === 'completed', 'the new revision completion');
});

test('configuration CAS, history and idempotency reject conflicting edits without duplicating work', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('work')]);
  const request: StartRunInput = {projectId: p.id, pipelineId: flow.id, goal: 'One synthetic task.', baseline: 'Synthetic baseline.', idempotencyKey: 'same-synthetic-request'};
  const first = h.engine.startRun(request, OWNER), duplicate = h.engine.startRun({...request}, OWNER);
  assert.equal(first.id, duplicate.id);
  assert.equal(h.engine.store.list<Run>('run').length, 1);
  assert.throws(() => h.engine.startRun({...request, goal: 'Different synthetic task.'}, OWNER), errorCode('IDEMPOTENCY_CONFLICT'));
  const updates = await Promise.allSettled([
    h.engine.updateProject(p.id, p.revision, {...p, description: 'Synthetic competing update A.'}, OWNER),
    h.engine.updateProject(p.id, p.revision, {...p, description: 'Synthetic competing update B.'}, OWNER),
  ]);
  assert.equal(updates.filter(update => update.status === 'fulfilled').length, 1);
  assert.equal(updates.filter(update => update.status === 'rejected' && errorCode('REVISION_CONFLICT')(update.reason)).length, 1);
  const changed = h.engine.updatePipeline(flow.id, flow.revision, {...flow, name: 'Updated synthetic pipeline'}, OWNER);
  assert.throws(() => h.engine.updatePipeline(flow.id, flow.revision, flow, OWNER), errorCode('REVISION_CONFLICT'));
  const historyCount = h.engine.store.list('pipeline-revision').length;
  assert.throws(() => h.engine.updatePipeline(flow.id, changed.revision, {...changed, stages: [stage('a', ['b']), stage('b', ['a'])]}, OWNER), errorCode('PIPELINE_CYCLE'));
  assert.equal(h.engine.store.list('pipeline-revision').length, historyCount);
  assert.equal(h.engine.startRun(request, OWNER).id, first.id);
  assert.equal(h.engine.run(first.id).snapshot.pipeline.revision, flow.revision);
  assert.equal(h.engine.run(first.id).snapshot.project.revision, p.revision);
  await pump(h, () => h.codex.calls.length === 1, 'one deduplicated execution');
  h.codex.calls[0].finish();
  await pump(h, () => h.engine.run(first.id).status === 'completed', 'the deduplicated completion');
});

test('run dependencies prevent launch until the prerequisite has completed', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('gate', [], {executor: 'manual'})]);
  const prerequisite = start(h, p, flow);
  const dependent = start(h, p, flow, {dependsOnRunIds: [prerequisite.id]});
  await pump(h, () => h.engine.run(dependent.id).status === 'waiting', 'the run dependency');
  assert.equal(state(h.engine.run(dependent.id), 'gate').attempts.length, 0);
  h.engine.completeManual(prerequisite.id, 'gate', OUTPUT, OWNER);
  await pump(h, () => state(h.engine.run(dependent.id), 'gate').status === 'waiting', 'the dependent manual gate');
  h.engine.completeManual(dependent.id, 'gate', OUTPUT, OWNER);
  assert.equal(h.engine.run(dependent.id).status, 'completed');
  assert.equal(h.codex.calls.length, 0);
});

test('restart preserves review/manual waits, marks native work interrupted and requires explicit retry', async t => {
  const h = await fixture(t), p = await project(h);
  const externalFlow = pipeline(h, p, [stage('external')]);
  const manualFlow = pipeline(h, p, [stage('manual', [], {executor: 'manual'})]);
  const reviewFlow = pipeline(h, p, [stage('reviewed', [], {review: true})]);
  const external = start(h, p, externalFlow), manual = start(h, p, manualFlow), reviewed = start(h, p, reviewFlow);
  await pump(h, () => h.codex.calls.length === 2, 'two original native tasks');
  const externalCall = h.codex.calls.find(call => call.input.prompt.includes('Stage: Synthetic external'))!;
  const reviewCall = h.codex.calls.find(call => call.input.prompt.includes('Stage: Synthetic reviewed'))!;
  externalCall.input.onEvent({type: 'synthetic.usage', message: 'Synthetic native usage report.', usage: {input: 11, output: 4, total: 15}, ref: externalCall.ref});
  reviewCall.finish(result('Synthetic evidence awaits review.'));
  await pump(h, () => h.engine.run(reviewed.id).status === 'review', 'the preserved review');
  const before = h.engine.run(external.id);
  await h.engine.close();
  h.codex = new SyntheticCodex('after-restart');
  h.github = new SyntheticGithub();
  h.engine = new Engine(new Store(h.stateDirectory), h.codex, h.github);
  h.engine.recover();
  await h.engine.tick();
  const restored = h.engine.run(external.id), attempt = state(restored, 'external').attempts[0];
  assert.equal(restored.status, 'interrupted');
  assert.equal(state(restored, 'external').status, 'interrupted');
  assert.equal(attempt.status, 'interrupted');
  assert.deepEqual(attempt.ref, state(before, 'external').attempts[0].ref);
  assert.deepEqual(attempt.usage, {input: 11, output: 4, total: 15});
  assert.equal(h.codex.calls.length, 0);
  assert.equal(h.engine.run(manual.id).status, 'waiting');
  assert.equal(h.engine.run(reviewed.id).status, 'review');
  assert.equal(state(h.engine.run(reviewed.id), 'reviewed').attempts[0].output?.summary, 'Synthetic evidence awaits review.');
  h.engine.retry(external.id, 'external', 'Inspected the synthetic external reference.', OWNER);
  await pump(h, () => h.codex.calls.length === 1, 'the explicitly retried native task');
  h.codex.calls[0].finish();
  await pump(h, () => h.engine.run(external.id).status === 'completed', 'the retry completion');
  assert.deepEqual(state(h.engine.run(external.id), 'external').attempts.map(attempt => attempt.status), ['interrupted', 'completed']);
  h.engine.completeManual(manual.id, 'manual', OUTPUT, OWNER);
  h.engine.review(reviewed.id, 'reviewed', 'accept', 'Inspected the preserved synthetic evidence.', OWNER);
  assert.equal(h.engine.run(manual.id).status, 'completed');
  assert.equal(h.engine.run(reviewed.id).status, 'completed');
});

test('explicit outcome branches handle revise/blocked, propagate skipped paths and merge after live inputs', async t => {
  for (const outcome of ['revise', 'blocked'] as const) await t.test(outcome, async sub => {
    const h = await fixture(sub), p = await project(h);
    const flow = pipeline(h, p, [stage('inspect', [], {review: outcome === 'blocked'}),
      stage('handle', ['inspect'], {executor: 'manual', condition: {stageId: 'inspect', outcome}}),
      stage('unused', ['inspect'], {condition: {stageId: 'inspect', outcome: 'done'}}),
      stage('unused-follow', ['unused']), stage('merge', ['handle', 'unused-follow'])]);
    const run = start(h, p, flow);
    await pump(h, () => h.codex.calls.length === 1, 'the outcome source');
    h.codex.calls[0].finish(result('The configured branch must handle this finding.', outcome));
    if (outcome === 'blocked') {
      await pump(h, () => state(h.engine.run(run.id), 'inspect').status === 'review', 'review before the selected branch');
      assert.equal(state(h.engine.run(run.id), 'handle').attempts.length, 0);
      h.engine.review(run.id, 'inspect', 'accept', 'Accept this finding and hand it to the configured resolution branch.', OWNER);
    }
    await pump(h, () => state(h.engine.run(run.id), 'handle').status === 'waiting' && state(h.engine.run(run.id), 'unused-follow').status === 'skipped', 'the selected human branch');
    const selected = h.engine.run(run.id), original = state(selected, 'inspect').attempts[0];
    assert.equal(original.status, 'completed'); assert.equal(original.output?.outcome, outcome); assert.equal(original.error, undefined);
    assert.equal(h.codex.calls.length, 1); assert.equal(state(selected, 'merge').attempts.length, 0);
    for (const id of ['unused', 'unused-follow']) {assert.equal(state(selected, id).status, 'skipped'); assert.equal(state(selected, id).attempts.length, 0);}
    h.engine.completeManual(run.id, 'handle', result('Recorded the concrete branch resolution.'), OWNER);
    await pump(h, () => h.codex.calls.length === 2, 'the live-path merge');
    assert.match(h.codex.calls[1].input.prompt, /Stage: Synthetic merge/);
    h.codex.calls[1].finish(); await pump(h, () => h.engine.run(run.id).status === 'completed', 'the handled outcome completion');
    assert.equal(state(h.engine.run(run.id), 'inspect').attempts.length, 1);
  });
});

test('an unhandled blocked result still stops downstream work truthfully', async t => {
  const h = await fixture(t), p = await project(h), flow = pipeline(h, p, [stage('inspect'), stage('follow', ['inspect'])]), run = start(h, p, flow);
  await pump(h, () => h.codex.calls.length === 1, 'the blocking source');
  h.codex.calls[0].finish(result('A required external decision is missing.', 'blocked'));
  await pump(h, () => h.engine.run(run.id).status === 'failed', 'the unhandled blocker');
  assert.equal(h.codex.calls.length, 1); assert.equal(state(h.engine.run(run.id), 'follow').attempts.length, 0);
  assert.match(h.engine.run(run.id).stopReason!, /external decision/);
});

test('loop no_change exits through skipped leaves without reusing an earlier selected-path result', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('inspect'), stage('selected', ['inspect'], {condition: {stageId: 'inspect', outcome: 'done'}}), stage('follow', ['selected'])], {maxIterations: 4});
  const run = start(h, p, flow, {mode: 'loop'});
  for (let index = 0; index < 3; index++) {await pump(h, () => h.codex.calls.length === index + 1, 'the first selected path'); h.codex.calls[index].finish(result(`First-iteration result ${index}.`));}
  await pump(h, () => h.codex.calls.length === 4, 'the next bounded observation');
  const accepted = structuredClone(state(h.engine.run(run.id), 'follow').attempts[0]);
  h.codex.calls[3].finish(result('The requested outcome is already supported.', 'no_change'));
  await pump(h, () => h.engine.run(run.id).status === 'completed', 'the no-change exit');
  const ended = h.engine.run(run.id);
  assert.equal(ended.iteration, 2); assert.equal(h.codex.calls.length, 4); assert.match(ended.stopReason!, /No further change/);
  assert.equal(state(ended, 'selected').status, 'skipped'); assert.equal(state(ended, 'follow').status, 'skipped');
  assert.deepEqual(state(ended, 'follow').attempts, [accepted]);
});

test('loop budgets accumulate uncached tokens across iterations and retain prior attempts', async t => {
  const h = await fixture(t), p = await project(h), flow = pipeline(h, p, [stage('work')], {maxIterations: 5, tokenBudget: 1000}), run = start(h, p, flow, {mode: 'loop'});
  await pump(h, () => h.codex.calls.length === 1, 'the first budgeted iteration');
  h.codex.calls[0].finish(result('First useful synthetic increment.'), {input: 800, cachedInput: 700, output: 100, total: 900});
  await pump(h, () => h.codex.calls.length === 2, 'the remaining cumulative allowance');
  assert.equal(h.codex.calls[1].input.tokenBudget, 800);
  h.codex.calls[1].finish(result('Second useful synthetic increment.'), {input: 650, cachedInput: 0, output: 150, total: 800});
  await pump(h, () => h.engine.run(run.id).status === 'completed', 'the cumulative budget stop');
  const ended = h.engine.run(run.id), attempts = state(ended, 'work').attempts;
  assert.equal(ended.iteration, 2); assert.equal(h.codex.calls.length, 2); assert.match(ended.stopReason!, /Token budget/);
  assert.deepEqual(attempts.map(attempt => attempt.iteration), [1, 2]); assert.deepEqual(attempts.map(attempt => attempt.usage?.total), [900, 800]);
});

test('independent review rejection retains accepted parallel work and rechecks only the affected path', async t => {
  const h = await fixture(t), p = await project(h);
  const flow = pipeline(h, p, [stage('base'), stage('work', ['base'], {review: true}), stage('peer', ['base']),
    stage('verify', ['work'], {roleId: 'qa', review: true, reworkTo: 'work'}), stage('deliver', ['verify', 'peer'], {executor: 'manual'})], {concurrency: 2});
  const run = start(h, p, flow);
  await pump(h, () => h.codex.calls.length === 1, 'the common baseline'); h.codex.calls[0].finish();
  await pump(h, () => h.codex.calls.length === 3, 'the parallel owned tasks'); h.codex.calls[1].finish(); h.codex.calls[2].finish(result('Accepted independent peer artifact.'));
  await pump(h, () => state(h.engine.run(run.id), 'work').status === 'review', 'the owner artifact review'); h.engine.review(run.id, 'work', 'accept', 'The owner artifact passes its initial checks.', OWNER);
  await pump(h, () => h.codex.calls.length === 4, 'independent verification'); assert.equal(h.codex.calls[3].input.role.id, 'qa'); h.codex.calls[3].finish(result('The correction needs a review decision.'));
  await pump(h, () => state(h.engine.run(run.id), 'verify').status === 'review', 'the concrete review gate');
  const before = h.engine.run(run.id), base = structuredClone(state(before, 'base')), peer = structuredClone(state(before, 'peer'));
  h.engine.review(run.id, 'verify', 'revise', 'Correct this one artifact while retaining the independent peer.', OWNER);
  await pump(h, () => h.codex.calls.length === 5, 'the focused correction');
  assert.match(h.codex.calls[4].input.prompt, /Correct this one artifact while retaining the independent peer/);
  assert.equal(state(h.engine.run(run.id), 'work').attempts[0].review?.decision, 'accept');
  assert.deepEqual(state(h.engine.run(run.id), 'base'), base); assert.deepEqual(state(h.engine.run(run.id), 'peer'), peer);
  h.codex.calls[4].finish(result('Corrected the targeted artifact.')); await pump(h, () => state(h.engine.run(run.id), 'work').status === 'review', 'the corrected owner artifact'); h.engine.review(run.id, 'work', 'accept', 'The focused owner correction passes its checks.', OWNER);
  await pump(h, () => h.codex.calls.length === 6, 'independent re-verification'); h.codex.calls[5].finish();
  await pump(h, () => state(h.engine.run(run.id), 'verify').status === 'review', 'the final review'); h.engine.review(run.id, 'verify', 'accept', 'The corrected evidence is sufficient.', OWNER);
  await pump(h, () => state(h.engine.run(run.id), 'deliver').status === 'waiting', 'accepted delivery'); h.engine.completeManual(run.id, 'deliver', OUTPUT, OWNER);
  assert.equal(h.engine.run(run.id).status, 'completed'); assert.equal(h.codex.calls.length, 6);
  assert.equal(state(h.engine.run(run.id), 'work').attempts.length, 2); assert.equal(state(h.engine.run(run.id), 'verify').attempts.length, 2);
  assert.deepEqual(state(h.engine.run(run.id), 'peer'), peer);
});

test('pause lets current work finish, prevents new dispatch and resumes without replay', async t => {
  for (const mode of ['dependency', 'loop', 'final-stage'] as const) await t.test(mode, async sub => {
    const h = await fixture(sub), p = await project(h), flow = pipeline(h, p, mode === 'dependency' ? [stage('work'), stage('follow', ['work'])] : [stage('work')], {maxIterations: 3});
    const run = start(h, p, flow, {mode: mode === 'loop' ? 'loop' : 'once'});
    await pump(h, () => h.codex.calls.length === 1, 'the current execution'); h.engine.pause(run.id, 'Inspect this boundary before further dispatch.', OWNER);
    assert.equal(h.codex.calls[0].aborted, false); h.codex.calls[0].finish(result('The current task finished successfully.'));
    await pump(h, () => state(h.engine.run(run.id), 'work').status === 'completed', 'the paused current result');
    for (let index = 0; index < 5; index++) {await h.engine.tick(); await immediate();}
    assert.equal(h.codex.calls.length, 1);
    if (mode === 'final-stage') {assert.equal(h.engine.run(run.id).status, 'completed'); return;}
    assert.equal(h.engine.run(run.id).status, 'paused'); assert.equal(h.engine.run(run.id).iteration, 1);
    const first = structuredClone(state(h.engine.run(run.id), 'work').attempts[0]); h.engine.resume(run.id, OWNER);
    await pump(h, () => h.codex.calls.length === 2, 'the resumed next action');
    h.codex.calls[1].finish(result('No further work remains.', 'no_change'));
    await pump(h, () => h.engine.run(run.id).status === 'completed', 'the resumed completion');
    assert.deepEqual(state(h.engine.run(run.id), 'work').attempts[0], first);
  });
});

test('Multica steering routes by provider and preserves pending versus delivered receipts without a native turn ID', async t => {
  const h = await fixture(t), p = await project(h), flow = pipeline(h, p, [stage('work')]);
  const completion = deferred<{output: TaskOutput}>(), supplements: {ref: ExecutionRef; text: string}[] = [], calls: AgentExecutionInput[] = [];
  let nativeSteers = 0, receipt: {id: string; status: string} | undefined = {id: 'synthetic-supplement-1', status: 'pending'};
  h.codex.steer = async () => {nativeSteers++;};
  h.engine.agentExecutor = {async start(input) {calls.push(input); input.signal.addEventListener('abort', () => completion.reject(new Error('Synthetic task closed.')), {once: true}); return {ref: {provider: 'multica', externalId: 'synthetic-task', issueId: 'synthetic-issue'}, completion: completion.promise};}, async steer(ref, text) {supplements.push({ref, text}); return receipt;}};
  const run = start(h, p, flow); await pump(h, () => state(h.engine.run(run.id), 'work').attempts[0]?.ref?.externalId === 'synthetic-task', 'the Multica task reference');
  assert.deepEqual(await h.engine.steer(run.id, 'work', 'Inspect this additional synthetic evidence.', OWNER), receipt);
  assert.equal(h.engine.store.events({runId: run.id}).at(-1)?.type, 'multica.steer_pending');
  receipt = {id: 'synthetic-supplement-2', status: 'delivered'}; assert.deepEqual(await h.engine.steer(run.id, 'work', 'Use the confirmed synthetic supplement.', OWNER), receipt);
  assert.equal(h.engine.store.events({runId: run.id}).at(-1)?.type, 'multica.steered');
  receipt = undefined; await h.engine.steer(run.id, 'work', 'Preserve compatibility with a void adapter receipt.', OWNER);
  assert.equal(h.engine.store.events({runId: run.id}).at(-1)?.type, 'multica.steer_pending');
  assert.equal(nativeSteers, 0); assert.equal(supplements.length, 3); assert.equal(calls.length, 1); assert.equal(h.codex.calls.length, 0);
  completion.resolve({output: OUTPUT}); await pump(h, () => h.engine.run(run.id).status === 'completed', 'the supplemented task completion');
});

test('close aborts and awaits executor shutdown plus late task settlement before closing storage', async t => {
  const h = await fixture(t), p = await project(h), flow = pipeline(h, p, [stage('work')]);
  const shutdown = deferred<void>(), started = deferred<CodexExecution>(); let input: AgentExecutionInput | undefined, closeCalls = 0, storageClosed = false, writesAfterClose = 0;
  const originalClose = h.engine.store.close.bind(h.engine.store), originalPut = h.engine.store.put.bind(h.engine.store);
  h.engine.store.close = () => {storageClosed = true; originalClose();};
  h.engine.store.put = (kind, value) => {if (storageClosed) writesAfterClose++; originalPut(kind, value);};
  h.engine.agentExecutor = {async start(value) {input = value; return started.promise;}, async steer() {}, async close() {closeCalls++; await shutdown.promise; started.resolve({ref: {provider: 'multica', externalId: 'synthetic-late-task'}, completion: Promise.resolve({output: OUTPUT})});}};
  const run = start(h, p, flow); await pump(h, () => Boolean(input), 'the pending task submission');
  const closing = h.engine.close(); await immediate(); assert.equal(input!.signal.aborted, true); assert.equal(closeCalls, 1); assert.equal(storageClosed, false);
  assert.equal(h.engine.run(run.id).status, 'running'); shutdown.resolve(); await closing; await h.engine.close(); await immediate();
  assert.equal(storageClosed, true); assert.equal(closeCalls, 1); assert.equal(writesAfterClose, 0);
  const restored = new Store(h.stateDirectory);
  try {const saved = restored.get<Run>('run', run.id)!; assert.equal(state(saved, 'work').attempts[0].ref?.externalId, 'synthetic-late-task'); assert.equal(state(saved, 'work').status, 'running');}
  finally {restored.close();}
});

test('development server blocks synthetic private files through direct, raw, encoded and absolute paths', {timeout: 15000}, async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-private-http-test-'));
  const dataDirectory = path.join(directory, 'state');
  const probeParent = path.join(root, '.local', 'test-probes');
  await mkdir(probeParent, {recursive: true});
  const probeDirectory = await mkdtemp(path.join(probeParent, 'engine-'));
  await mkdir(dataDirectory);
  const marker = `SYNTHETIC_PRIVATE_HTTP_PROBE_${randomUUID()}`;
  const privateFile = path.join(probeDirectory, 'synthetic-private.txt');
  const externalPrivateFile = path.join(dataDirectory, 'synthetic-private.txt');
  await Promise.all([writeFile(privateFile, marker), writeFile(externalPrivateFile, marker)]);
  const reservation = createNetServer();
  await new Promise<void>(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
  const child = spawn(process.execPath, ['src/server.ts', '--dev'], {cwd: root, env: {...process.env, GWI_DATA_DIR: dataDirectory, GWI_PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => {stderr = (stderr + chunk).slice(-4000);});
  t.after(async () => {
    const exit = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exit;
      clearTimeout(timer);
    }
    await Promise.all([rm(directory, {recursive: true, force: true}), rm(probeDirectory, {recursive: true, force: true})]);
  });
  await new Promise<void>((resolveReady, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('Isolated development server did not become ready.')), 8000);
    child.stdout.setEncoding('utf8').on('data', chunk => {stdout += chunk; if (stdout.includes('GW-Iterator listening')) {clearTimeout(timer); resolveReady();}});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', code => {clearTimeout(timer); reject(new Error(`Isolated development server exited (${code}): ${stderr}`));});
  });
  const origin = `http://127.0.0.1:${port}`;
  const index = await readFile(path.join(root, 'index.html'), 'utf8');
  const entry = index.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(entry, 'The public entry script is declared.');
  for (const route of ['/', '/@vite/client', '/src/contracts.ts', entry]) {
    const response = await fetch(origin + route, {redirect: 'manual'});
    assert.equal(response.status, 200, `Public application asset remains usable: ${route}`);
    await response.text();
  }
  const relative = path.relative(root, privateFile).split(path.sep).join('/');
  const routes = [
    `/${relative}`, `/${relative}?raw`, `/${relative}?url`, `/${relative}?import`,
    `/@fs/${privateFile}?raw`, `/@fs/${externalPrivateFile}?raw`,
    `/${relative.replace('.local', '%2elocal')}?raw`,
    `/${relative.replace('.local/', '%2elocal%2f')}?raw`,
    `/${relative.replace('.local/', '%252elocal%252f')}?raw`,
    `/web/../${relative}?raw`,
  ];
  for (const route of routes) {
    const response = await fetch(origin + route, {redirect: 'manual'});
    const content = await response.text();
    assert.equal(response.status, 403, 'A synthetic private route is blocked before Vite serves it.');
    assert.equal(content.includes(marker), false);
  }
});
