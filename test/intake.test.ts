import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {Engine} from '../src/engine.ts';
import {IntakeService, isNativeCapacityFailure} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import type {Actor, ExecutionRef, Intake, IntakeDecision, Pipeline, Run, TaskOutput, Usage} from '../src/contracts.ts';
import type {CodexAdapter, CodexExecutionInput, CodexGoalInput, CodexGoalResult} from '../src/adapters/types.ts';
import type {GoalPlanner, GoalPlannerInput} from '../src/goal-planner.ts';

const OWNER: Actor = {name: 'Synthetic goal owner', kind: 'human'};
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Synthetic delegated action completed.', artifacts: [], observations: []};
function deferred<T>() {
  let resolvePromise!: (value: T) => void, rejectPromise!: (error: Error) => void;
  const value = {settled: false, promise: new Promise<T>((resolve, reject) => {resolvePromise = resolve; rejectPromise = reject;}),
    resolve(result: T) {if (!this.settled) {this.settled = true; resolvePromise(result);}},
    reject(error: Error) {if (!this.settled) {this.settled = true; rejectPromise(error);}}};
  void value.promise.catch(() => {});
  return value;
}
class SyntheticNativeAdapter implements CodexAdapter {
  deferTaskAbort=false;
  goals: {input: CodexGoalInput; ref: ExecutionRef; completion: ReturnType<typeof deferred<CodexGoalResult>>; aborted: boolean}[] = [];
  tasks: {input: CodexExecutionInput; completion: ReturnType<typeof deferred<{output: TaskOutput}>>; aborted: boolean}[] = [];
  async info() {return {available: true, connected: true, authenticated: true, models: ['synthetic-primary','synthetic-fallback','synthetic-other'].map(id=>({id,name:id,efforts:['low','medium']}))};}
  async skills() {return [];}
  async start(input: CodexExecutionInput) {
    const completion = deferred<{output: TaskOutput}>(), task = {input, completion, aborted: false};
    this.tasks.push(task);
    input.signal.addEventListener('abort', () => {task.aborted = true; if(!this.deferTaskAbort)completion.reject(new Error('Synthetic delegated task cancelled.'));}, {once: true});
    return {ref: {threadId: `synthetic-task-${this.tasks.length}`, turnId: `synthetic-task-turn-${this.tasks.length}`}, completion: completion.promise};
  }
  async startGoal(input: CodexGoalInput) {
    const ref = {threadId: `synthetic-owned-goal-${this.goals.length + 1}`, turnId: 'synthetic-native-goal-turn'};
    const completion = deferred<CodexGoalResult>(), goal = {input, ref, completion, aborted: false};
    this.goals.push(goal);
    input.signal.addEventListener('abort', () => {goal.aborted = true; completion.resolve({status: 'cleared', summary: 'Synthetic owned goal was cleared.'});}, {once: true});
    input.onEvent({type: 'thread/goal/updated', message: 'Synthetic native goal is active.', ref, data: {goal: {threadId: ref.threadId, objective: input.objective, status: 'active', tokenBudget: input.tokenBudget, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 100, updatedAt: 100}}});
    input.onEvent({type:'codex.thread_configuration',message:'Synthetic effective native model.',ref,data:{model:input.role.model??'synthetic-primary',reasoningEffort:input.role.effort,serviceTier:'default'}});
    return {ref, completion: completion.promise};
  }
  async steer() {}
  async interrupt() {}
  async close() {
    for (const goal of this.goals) goal.completion.resolve({status: 'cleared', summary: 'Synthetic adapter closed.'});
    for (const task of this.tasks) task.completion.reject(new Error('Synthetic adapter closed.'));
    await immediate();
  }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-intake-test-')), workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  const codex = new SyntheticNativeAdapter();
  const github = {info: async () => ({available: true, authenticated: true}), observe: async () => ({status: 'completed' as const, summary: 'Synthetic CI result.'}), dispatch: async () => ({status: 'completed' as const, summary: 'Synthetic CI result.'})};
  const engine = new Engine(new Store(path.join(directory, 'state')), codex, github), intake = new IntakeService(engine);
  const project = await engine.createProject({name: 'Synthetic supervised project', workspace}, OWNER);
  const flows = ['inspect', 'verify'].map(id => {
    const initial = engine.createPipeline({projectId: project.id, roleId: 'development', name: `Synthetic ${id}`}, OWNER);
    return engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [{id, name: `Synthetic ${id}`, roleId: 'development', executor: 'codex', dependsOn: [], prompt: `Perform the synthetic ${id} action.`, review: false}], policy: {concurrency: 1, maxAttempts: 2, maxIterations: 1, timeoutSeconds: 30, tokenBudget: 10000}}, OWNER);
  });
  t.after(async () => {await codex.close(); await immediate(); await engine.close(); await rm(directory, {recursive: true, force: true});});
  return {directory, codex, engine, intake, project, flows};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const current = (h: Fixture, item: Intake) => h.intake.list(item.projectId).find(value => value.id === item.id)!;
function create(h: Fixture, policy: Partial<Intake['policy']> = {}) {
  return h.intake.create(h.project.id, {request: 'Resolve the bounded synthetic mismatch with evidence.', idempotencyKey: randomUUID(), policy: {maxRounds: 4, maxParallel: 2, maxTotalTokens: 10000, maxElapsedSeconds: 300, ...policy}}, OWNER);
}
const decision = (action: 'dispatch' | 'complete' | 'stop' | 'clarify', tasks: {pipelineId: string; goal: string}[] = []) => ({action, rationale: 'The synthetic evidence supports this next action.', expectedGain: 'Resolve one specific synthetic uncertainty.', tasks});
const task = (pipeline: Pipeline, goal = 'Inspect the assigned synthetic artifact.') => ({pipelineId: pipeline.id, goal});
async function pump(h: Fixture, condition: () => boolean, label: string) {
  for (let count = 0; count < 100; count++) {await h.engine.tick(); await immediate(); if (condition()) return;}
  assert.fail(`Synthetic native-goal supervision did not reach ${label}.`);
}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

test('goal starts are idempotent and the engine never replays a native goal as a task stage', async t => {
  const h = await fixture(t);
  const request = {request: 'One bounded synthetic goal.', idempotencyKey: 'synthetic-goal-idempotency'};
  const first = h.intake.create(h.project.id, request, OWNER), second = h.intake.create(h.project.id, {...request}, OWNER);
  assert.equal(first.id, second.id);
  assert.equal(h.codex.goals.length, 1);
  await h.engine.tick();
  assert.equal(h.codex.tasks.length, 0);
  assert.equal(h.engine.run(first.routerRunId).executionKind, 'native-goal');
  assert.throws(() => h.intake.create(h.project.id, {...request, request: 'Different synthetic work.'}, OWNER), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => h.engine.retry(first.routerRunId, 'supervise', 'Retry one native turn.', OWNER), code('NATIVE_GOAL_RETRY'));
  h.codex.goals[0].completion.resolve({status: 'budgetLimited', summary: 'Synthetic native budget boundary.'});
  await pump(h, () => current(h, first).status === 'stopped', 'the reported native budget boundary');
});

test('one native goal dispatches multiple workflows, waits for evidence and records completion', async t => {
  const h = await fixture(t), item = create(h);
  const goal = h.codex.goals[0];
  const observations = goal.input.onTool('intake.route', decision('dispatch', h.flows.map((flow, index) => task(flow, `Complete distinct synthetic action ${index + 1}.`))));
  await pump(h, () => h.codex.tasks.length === 2, 'two delegated workflows');
  assert.equal(current(h, item).status, 'dispatched');
  await assert.rejects(goal.input.onTool('intake.route', decision('dispatch', [task(h.flows[0])])), code('ACTION_IN_PROGRESS'));
  assert.equal(h.engine.store.list<Run>('run').length, 3);
  h.codex.tasks[0].completion.resolve({output: {...OUTPUT, summary: 'First accepted synthetic action.'}});
  await immediate();
  assert.equal(current(h, item).status, 'dispatched');
  h.codex.tasks[1].completion.resolve({output: {...OUTPUT, summary: 'Second accepted synthetic action.'}});
  await pump(h, () => current(h, item).status === 'routing', 'actual action observations');
  const observed = await observations as {results: {status: string}[]};
  assert.deepEqual(observed.results.map(value => value.status), ['completed', 'completed']);
  assert.equal(h.codex.goals.length, 1);
  const reused = await goal.input.onTool('intake.route', decision('dispatch', h.flows.map((flow, index) => task(flow, `Complete distinct synthetic action ${index + 1}.`)))) as {reused: boolean};
  assert.equal(reused.reused, true);
  assert.equal(h.codex.tasks.length, 2);
  assert.equal(current(h, item).rounds.length, 1);
  const complete = await goal.input.onTool('intake.route', decision('complete')) as {accepted: boolean};
  assert.equal(complete.accepted, true);
  assert.equal(current(h, item).status, 'routing');
  goal.completion.resolve({status: 'complete', summary: 'Both synthetic actions meet the original objective.', nativeGoal: {threadId: goal.ref.threadId!, objective: goal.input.objective, status: 'complete', tokensUsed: 99, timeUsedSeconds: 7, createdAt: 100, updatedAt: 107}});
  await pump(h, () => current(h, item).status === 'completed', 'native and GWI accepted completion');
  const ended = h.engine.run(item.routerRunId);
  assert.equal(ended.status, 'completed');
  assert.equal(ended.stages[0].attempts[0].nativeGoal?.tokensUsed, 99);
  assert.equal(ended.stages[0].attempts[0].usage, undefined);
  assert.deepEqual(current(h, item).rounds.map(round => round.routerRunId), [item.routerRunId, item.routerRunId]);
  assert.equal(h.codex.goals.length, 1);
});

test('native complete alone cannot replace accepted delegated evidence', async t => {
  const h = await fixture(t), item = create(h);
  await assert.rejects(h.codex.goals[0].input.onTool('intake.route', decision('complete')), code('UNVERIFIED_COMPLETION'));
  h.codex.goals[0].completion.resolve({status: 'complete', summary: 'Synthetic model claimed completion without evidence.'});
  await pump(h, () => current(h, item).status === 'stopped', 'rejection of unsupported completion');
  assert.notEqual(h.engine.run(item.routerRunId).status, 'completed');
  assert.equal(h.codex.tasks.length, 0);
});

test('native-goal tools preserve project/family scope and the frozen workflow basis', async t => {
  const h = await fixture(t), item = create(h), goal = h.codex.goals[0];
  const original = h.flows[0];
  h.engine.updatePipeline(original.id, original.revision, {...original, name: 'Updated live synthetic workflow'}, OWNER);
  const values = await goal.input.onTool('pipeline.read', {pipelineId: original.id}) as Pipeline[];
  assert.equal(values[0].revision, original.revision);
  assert.equal(values[0].name, original.name);
  await assert.rejects(goal.input.onTool('context.read', {projectId: 'another-synthetic-project'}), code('PROJECT_SCOPE'));
  await assert.rejects(goal.input.onTool('pipeline.read', {pipelineId: 'outside-the-goal-basis'}), code('PIPELINE_NOT_FOUND'));
  const outside = h.engine.startRun({projectId: h.project.id, pipelineId: original.id, goal: 'A separate synthetic run.', baseline: 'Synthetic baseline.', idempotencyKey: randomUUID()}, OWNER);
  await assert.rejects(goal.input.onTool('run.read', {runId: outside.id}), code('PROJECT_SCOPE'));
  h.codex.tasks[0].completion.resolve({output: OUTPUT});
  await goal.input.onTool('intake.route', {...decision('clarify'), question: 'Which synthetic artifact is authoritative?'});
  await pump(h, () => current(h, item).status === 'clarification', 'one concrete human question');
  assert.equal(current(h, item).question, 'Which synthetic artifact is authoritative?');
});

test('duplicate tasks in one native decision cannot start duplicate paid work', async t => {
  const h = await fixture(t), item = create(h), goal = h.codex.goals[0];
  const pending = goal.input.onTool('intake.route', decision('dispatch', [task(h.flows[0]), task(h.flows[0])]));
  void pending.catch(() => {});
  await immediate();
  assert.equal(h.codex.tasks.length, 0, 'Identical tasks are rejected or deduplicated before starting execution.');
  await assert.rejects(pending, code('DUPLICATE_ACTION'));
  assert.equal(current(h, item).targetRunIds.length, 0);
});

test('expired native decisions cannot launch children or overwrite a stopped goal', async t => {
  const h = await fixture(t), item = create(h, {maxElapsedSeconds: 30}), goal = h.codex.goals[0];
  h.engine.store.put('intake', {...item, createdAt: new Date(Date.now() - 31000).toISOString()});
  const native=h.engine.run(item.routerRunId);native.createdAt=new Date(Date.now()-31000).toISOString();native.stages[0].attempts[0].startedAt=native.createdAt;h.engine.store.put('run',native);
  const pending = goal.input.onTool('intake.route', decision('dispatch', h.flows.map(flow => task(flow))));
  void pending.catch(() => {});
  await immediate();
  assert.equal(h.codex.tasks.length, 0, 'No child starts after the global elapsed boundary.');
  await assert.rejects(pending, /boundary|elapsed|limit|stopped/i);
  await h.engine.tick();
  assert.equal(current(h, item).status, 'stopped');
  assert.equal(current(h, item).targetRunIds.length, 0);
});

test('a partial dispatch failure cancels the native goal and every already-started child', async t => {
  const h = await fixture(t), item = create(h), goal = h.codex.goals[0];
  const original = h.engine.startRun.bind(h.engine);
  let starts = 0;
  h.engine.startRun = (...args: Parameters<Engine['startRun']>) => {if (++starts === 2) throw new AppError('SYNTHETIC_START_FAILURE', 'Synthetic second action failed to start.'); return original(...args);};
  const pending = goal.input.onTool('intake.route', decision('dispatch', h.flows.map(flow => task(flow))));
  await assert.rejects(pending, /second action failed/);
  h.engine.startRun = original;
  await pump(h, () => current(h, item).targetRunIds.every(id => h.engine.run(id).status === 'cancelled'), 'partial-dispatch cleanup');
  assert.equal(goal.aborted, true);
  assert.equal(h.codex.tasks.length, 1);
  assert.equal(h.codex.tasks[0].aborted, true);
  assert.equal(current(h, item).status, 'stopped');
});

test('global token boundaries include native goal totals and every active action', async t => {
  for (const source of ['native', 'thread'] as const) await t.test(source, async sub => {
    const h = await fixture(sub), item = create(h, {maxTotalTokens: 5000}), goal = h.codex.goals[0];
    const pending = goal.input.onTool('intake.route', decision('dispatch', h.flows.map(flow => task(flow))));
    void pending.catch(() => {});
    await pump(h, () => h.codex.tasks.length === 2, 'two bounded actions');
    if (source === 'native') goal.input.onEvent({type: 'thread/goal/updated', message: 'Synthetic native token report.', ref: goal.ref, data: {goal: {status: 'active', tokensUsed: 2000, timeUsedSeconds: 3}}});
    else goal.input.onEvent({type: 'thread/tokenUsage/updated', message: 'Synthetic newer thread token report.', ref: goal.ref, usage: {input: 1500, output: 500, total: 2000}});
    h.codex.tasks[0].input.onEvent({type: 'synthetic.usage', message: 'Synthetic first action usage.', usage: {input: 800, output: 200, total: 1000}});
    h.codex.tasks[1].input.onEvent({type: 'synthetic.usage', message: 'Synthetic second action usage.', usage: {input: 1500, output: 501, total: 2001}});
    if(source==='native'){
      await h.engine.tick();await immediate();
      assert.equal(current(h,item).status,'dispatched','An unproven native meter is not an exact GWI new-token total.');
      goal.input.onEvent({type:'thread/tokenUsage/updated',message:'Actual GWI usage with cache detail.',ref:goal.ref,usage:{input:2500,cachedInput:1000,output:500,total:3000}});
    }
    await pump(h, () => current(h, item).status === 'stopped' && current(h, item).targetRunIds.every(id => h.engine.run(id).status === 'cancelled'), 'aggregate boundary cleanup');
    await pending;
    assert.equal(goal.aborted, true);
    assert.ok(h.codex.tasks.every(task => task.aborted));
    assert.match(current(h, item).outcome!, /boundary/);
  });
});

test('the action-round boundary permits completion and stops another paid dispatch', async t => {
  for (const next of ['complete', 'dispatch'] as const) await t.test(next, async sub => {
    const h = await fixture(sub), item = create(h, {maxRounds: 1}), goal = h.codex.goals[0];
    const observations = goal.input.onTool('intake.route', decision('dispatch', [task(h.flows[0])]));
    await pump(h, () => h.codex.tasks.length === 1, 'the only permitted action round');
    h.codex.tasks[0].completion.resolve({output: OUTPUT});
    await pump(h, () => current(h, item).status === 'routing', 'the last action observations');
    await observations;
    if (next === 'complete') {
      const accepted = await goal.input.onTool('intake.route', decision('complete')) as {accepted: boolean};
      assert.equal(accepted.accepted, true);
      goal.completion.resolve({status: 'complete', summary: 'The final permitted synthetic action satisfies the goal.'});
      await pump(h, () => current(h, item).status === 'completed', 'completion at the action-round boundary');
    } else {
      await assert.rejects(goal.input.onTool('intake.route', decision('dispatch', [task(h.flows[1], 'A different extra action.')])), code('GOAL_ROUND_LIMIT'));
      await pump(h, () => current(h, item).status === 'stopped', 'the extra action refusal');
      assert.equal(goal.aborted, true);
    }
    assert.equal(h.codex.tasks.length, 1);
  });
});

const CAPACITY='Selected model is at capacity. Please try a different model.';
async function capacityFailure(h:Fixture,item:Intake,usage?:{input:number;output:number;total:number;cachedInput?:number}) {
  const goal=h.codex.goals.at(-1)!;
  goal.input.onEvent({type:'error',message:CAPACITY,ref:goal.ref,data:{code:'model_at_capacity',willRetry:false}});
  goal.completion.resolve({status:'cleared',summary:CAPACITY,...(usage?{usage}:{})});
  await pump(h,()=>['failed','retry_wait'].includes(current(h,item).status),'a confirmed native capacity failure');
}

test('capacity classification is narrow and automatic recovery is off by default', async t=>{
  assert.equal(isNativeCapacityFailure(CAPACITY),true);
  assert.equal(isNativeCapacityFailure('Native turn failed: '+CAPACITY),true);
  assert.equal(isNativeCapacityFailure('A native error.','model_capacity_exceeded'),true);
  for(const value of ['Rate limit exceeded.','Task blocked: needs review.','Permission denied.','Token budget reached.','The service is at capacity.'])assert.equal(isNativeCapacityFailure(value),false);
  const h=await fixture(t),item=create(h);await capacityFailure(h,item);
  assert.equal(current(h,item).status,'failed');assert.equal(current(h,item).nextRetryAt,undefined);assert.equal(current(h,item).canRetry,true);
  assert.equal(h.codex.goals.length,1);assert.equal(current(h,item).lastFailure?.kind,'capacity');
});

test('manual recovery retains evidence, usage, identity and immutable old snapshots', async t=>{
  const h=await fixture(t),item=create(h),first=h.codex.goals[0];
  const observed=first.input.onTool('intake.route',decision('dispatch',[task(h.flows[0])]));
  await pump(h,()=>h.codex.tasks.length===1,'the original delegated action');
  h.codex.tasks[0].input.onEvent({type:'usage',message:'Synthetic child usage.',usage:{input:150,cachedInput:100,output:20,total:170}});
  h.codex.tasks[0].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the preserved evidence');await observed;
  await capacityFailure(h,item,{input:300,cachedInput:200,output:20,total:320});
  const before=h.engine.run(item.routerRunId),frozen=structuredClone(before.snapshot),oldRound=structuredClone(current(h,item).rounds);
  const recovered=await h.intake.retry(item.id,{note:'Retry the confirmed capacity failure with a selected model.',model:'synthetic-fallback'},OWNER);
  assert.notEqual(recovered.routerRunId,item.routerRunId);assert.deepEqual(recovered.supervisorRunIds,[item.routerRunId,recovered.routerRunId]);
  assert.equal(recovered.request,item.request);assert.equal(recovered.createdAt,item.createdAt);assert.deepEqual(recovered.rounds,oldRound);
  assert.deepEqual(h.engine.run(item.routerRunId).snapshot,frozen);assert.deepEqual(h.engine.run(item.routerRunId).stages[0].attempts[0].usage,{input:300,cachedInput:200,output:20,total:320});
  const second=h.codex.goals[1];assert.equal(second.input.role.model,'synthetic-fallback');assert.equal(second.input.tokenBudget,9810);assert.ok(second.input.timeoutSeconds<=300&&second.input.timeoutSeconds>290);
  assert.equal(h.engine.run(recovered.routerRunId).recoveryOfRunId,item.routerRunId);assert.match(second.input.prompt,/Synthetic delegated action completed/);
  await assert.rejects(first.input.onTool('intake.route',decision('stop')),code('INTAKE_SCOPE'));
  const reused=await second.input.onTool('intake.route',decision('dispatch',[task(h.flows[0])])) as {reused:boolean};assert.equal(reused.reused,true);assert.equal(h.codex.tasks.length,1);
  await second.input.onTool('intake.route',decision('complete'));second.completion.resolve({status:'complete',summary:'Recovered evidence satisfies the synthetic objective.'});
  await pump(h,()=>current(h,item).status==='completed','recovered goal completion');
  assert.equal(current(h,item).recoveryHistory?.[0].status,'completed');assert.equal(current(h,item).recoveryHistory?.[0].newRef?.threadId,second.ref.threadId);
});

test('manual policy extension is explicit and a fresh execution receives only the remainder', async t=>{
  const h=await fixture(t),item=create(h);await capacityFailure(h,item,{input:9000,output:500,total:9500});
  await assert.rejects(h.intake.retry(item.id,{note:'Attempt without more budget.',model:'synthetic-primary'},OWNER),code('GOAL_BOUNDARY'));
  const recovered=await h.intake.retry(item.id,{note:'Approve a larger cumulative synthetic allowance.',model:'synthetic-primary',policy:{maxTotalTokens:20000,maxElapsedSeconds:600}},OWNER);
  assert.equal(h.codex.goals[1].input.tokenBudget,10500);assert.ok(h.codex.goals[1].input.timeoutSeconds>590&&h.codex.goals[1].input.timeoutSeconds<=600);
  assert.equal(recovered.policy.maxTotalTokens,20000);assert.equal(h.engine.run(item.routerRunId).snapshot.pipeline.policy.tokenBudget,10000);
  assert.equal(recovered.recoveryHistory?.[0].previousPolicy?.maxTotalTokens,10000);assert.equal(recovered.recoveryHistory?.[0].newPolicy?.maxTotalTokens,20000);
  assert.ok(h.engine.store.events({runId:recovered.routerRunId}).some(event=>event.type==='goal.policy_extended'));
});

test('manual model selection is catalog validated and concurrent retries cannot duplicate execution', async t=>{
  const h=await fixture(t),item=create(h);await capacityFailure(h,item);
  await assert.rejects(h.intake.retry(item.id,{note:'Invalid model choice.',model:'not-in-the-actual-catalog'},OWNER),code('MODEL_NOT_AVAILABLE'));assert.equal(h.codex.goals.length,1);
  const original=h.codex.info.bind(h.codex),catalog=await original(),pending=deferred<typeof catalog>();h.codex.info=()=>pending.promise;
  const first=h.intake.retry(item.id,{note:'One explicit recovery.',model:'synthetic-primary'},OWNER);
  await assert.rejects(h.intake.retry(item.id,{note:'A duplicate recovery.',model:'synthetic-primary'},OWNER),code('RECOVERY_IN_PROGRESS'));
  pending.resolve(catalog);await first;assert.equal(h.codex.goals.length,2);
});

test('basis refresh is manual, revisioned and applies only to future snapshots', async t=>{
  const h=await fixture(t),item=create(h);await capacityFailure(h,item);
  const original=h.engine.project(h.project.id),updated=structuredClone(original);updated.roles.find(role=>role.id==='lead')!.instructions='Refreshed synthetic lead instructions.';updated.roles.find(role=>role.id==='development')!.model='synthetic-other';
  await h.engine.updateProject(original.id,original.revision,updated,OWNER);
  const flow=h.flows[0];h.engine.updatePipeline(flow.id,flow.revision,{...flow,name:'Refreshed synthetic workflow'},OWNER);
  const first=await h.intake.retry(item.id,{note:'Keep the original basis.',model:'synthetic-fallback'},OWNER);assert.notEqual(h.codex.goals[1].input.role.instructions,'Refreshed synthetic lead instructions.');
  const oldBasis=await h.codex.goals[1].input.onTool('pipeline.read',{pipelineId:flow.id}) as Pipeline[];assert.equal(oldBasis[0].revision,flow.revision);
  const delegated=h.codex.goals[1].input.onTool('intake.route',decision('dispatch',[task(h.flows[1])]));await pump(h,()=>h.codex.tasks.length===1,'delegation with its original role model');assert.equal(h.codex.tasks[0].input.role.model,null);h.codex.tasks[0].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the original role result');await delegated;
  await capacityFailure(h,item);
  const refreshed=await h.intake.retry(item.id,{note:'Use the updated project basis for future work.',model:'synthetic-primary',refreshConfiguration:true},OWNER);
  assert.equal(refreshed.basisRevision,2);assert.equal(h.codex.goals[2].input.role.instructions,'Refreshed synthetic lead instructions.');
  assert.equal(h.engine.run(first.routerRunId).snapshot.project.revision,original.revision);assert.equal(h.engine.run(refreshed.routerRunId).snapshot.project.revision,original.revision+1);
  assert.equal(refreshed.recoveryHistory?.at(-1)?.refreshConfiguration,true);assert.equal(refreshed.recoveryHistory?.at(-1)?.previousBasisRevision,1);
  assert.equal(h.engine.store.list<{intakeId:string}>('intake-basis-revision').filter(value=>value.intakeId===item.id).length,2);
});

test('unknown provider cleanup and active children block a second native execution', async t=>{
  await t.test('unconfirmed provider cleanup',async sub=>{
    const h=await fixture(sub),item=create(h,{recovery:{autoRetry:true,maxAttempts:2,backoffSeconds:1,allowedFallbackModels:[]}}),goal=h.codex.goals[0];
    goal.input.onEvent({type:'thread/goal/cleared',message:'Only a goal clear is known.',ref:goal.ref});goal.completion.reject(new Error(CAPACITY));
    await pump(h,()=>current(h,item).status==='failed','an unconfirmed cleanup failure');assert.equal(current(h,item).canRetry,false);assert.equal(current(h,item).nextRetryAt,undefined);
    await assert.rejects(h.intake.retry(item.id,{note:'Unsafe retry.',model:'synthetic-primary'},OWNER),code('RECOVERY_NOT_READY'));assert.equal(h.codex.goals.length,1);
  });
  await t.test('active delegated child',async sub=>{
    const h=await fixture(sub),item=create(h);h.codex.deferTaskAbort=true;
    const observed=h.codex.goals[0].input.onTool('intake.route',decision('dispatch',[task(h.flows[0])]));void observed.catch(()=>{});await pump(h,()=>h.codex.tasks.length===1,'an active delegated task');
    await capacityFailure(h,item);assert.equal(current(h,item).canRetry,false);await assert.rejects(h.intake.retry(item.id,{note:'Wait for child cleanup.',model:'synthetic-primary'},OWNER),code('RECOVERY_NOT_READY'));
    h.codex.tasks[0].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).canRetry===true,'child termination confirmation');
    await h.intake.retry(item.id,{note:'Child cleanup is now confirmed.',model:'synthetic-primary'},OWNER);assert.equal(h.codex.goals.length,2);
  });
});

test('automatic capacity recovery waits, uses only the explicit pool and stops at its cumulative attempt limit', async t=>{
  const h=await fixture(t),item=create(h,{recovery:{autoRetry:true,maxAttempts:2,backoffSeconds:1,allowedFallbackModels:['synthetic-fallback']}});
  await capacityFailure(h,item,{input:100,output:20,total:120});assert.equal(current(h,item).status,'retry_wait');assert.ok(Date.parse(current(h,item).nextRetryAt!)>Date.now());
  await h.engine.tick();assert.equal(h.codex.goals.length,1);
  const due=()=>{const value=current(h,item);value.nextRetryAt=new Date(Date.now()-1).toISOString();h.engine.store.put('intake',value);};
  due();await pump(h,()=>h.codex.goals.length===2,'the first automatic fresh execution');assert.equal(h.codex.goals[1].input.role.model,'synthetic-primary');assert.equal(h.codex.goals[1].input.tokenBudget,9880);
  await capacityFailure(h,item,{input:50,output:10,total:60});assert.equal(current(h,item).status,'retry_wait');due();await pump(h,()=>h.codex.goals.length===3,'the allowed fallback execution');assert.equal(h.codex.goals[2].input.role.model,'synthetic-fallback');
  await capacityFailure(h,item);assert.equal(current(h,item).status,'failed');assert.equal(current(h,item).nextRetryAt,undefined);assert.equal(current(h,item).recoveryHistory?.filter(value=>value.trigger==='automatic'&&value.newRunId).length,2);
  await h.engine.tick();assert.equal(h.codex.goals.length,3);assert.ok(current(h,item).recoveryHistory?.every(value=>!value.refreshConfiguration&&!value.previousPolicy&&!value.newPolicy));assert.equal(current(h,item).policy.maxTotalTokens,10000);assert.equal(current(h,item).policy.maxRounds,4);
});

test('budget/permission/task blockers never become automatic capacity retries and restart never resumes a scheduled retry', async t=>{
  for(const status of ['budgetLimited','usageLimited','blocked'] as const)await t.test(status,async sub=>{
    const h=await fixture(sub),item=create(h,{recovery:{autoRetry:true,maxAttempts:2,backoffSeconds:1,allowedFallbackModels:['synthetic-fallback']}});
    h.codex.goals[0].completion.resolve({status,summary:status==='blocked'?CAPACITY:'A native usage or budget boundary.'});await pump(h,()=>['stopped','clarification'].includes(current(h,item).status),'a non-capacity stop');assert.equal(current(h,item).nextRetryAt,undefined);assert.equal(h.codex.goals.length,1);
  });
  await t.test('restart',async sub=>{
    const h=await fixture(sub),item=create(h,{recovery:{autoRetry:true,maxAttempts:2,backoffSeconds:1,allowedFallbackModels:[]}});await capacityFailure(h,item);const old=h.intake;h.intake=new IntakeService(h.engine);h.intake.reconcile();await old.close();
    assert.equal(current(h,item).status,'failed');assert.equal(current(h,item).nextRetryAt,undefined);assert.match(current(h,item).error!,/restarted/);assert.equal(h.codex.goals.length,1);
  });
});

test('legacy cleanup is derived only from matching structured audit evidence', async t=>{
  for(const terminalProof of [true,false])await t.test(String(terminalProof),async sub=>{
    const h=await fixture(sub),item=create(h);await capacityFailure(h,item);const run=h.engine.run(item.routerRunId),attempt=run.stages[0].attempts[0];delete attempt.nativeCleanupConfirmed;delete attempt.nativeGoalCleared;h.engine.store.put('run',run);
    const event=(type:string,detail?:unknown)=>h.engine.store.event({projectId:item.projectId,runId:run.id,stageId:'supervise',type,actor:'synthetic-native',message:'Synthetic audit evidence.',data:{ref:attempt.ref,...(detail?{detail}:{})}});
    event('thread/goal/cleared');event('codex.goal_cleanup',{cleared:true});if(terminalProof)event('turn/completed',{status:'interrupted'});
    assert.equal(current(h,item).canRetry,terminalProof);
    if(terminalProof){await h.intake.retry(item.id,{note:'The owned audit confirms native cleanup.',model:'synthetic-primary'},OWNER);assert.equal(h.codex.goals.length,2);assert.equal(h.engine.run(run.id).stages[0].attempts[0].nativeCleanupConfirmed,undefined);}
    else await assert.rejects(h.intake.retry(item.id,{note:'Missing terminal proof.',model:'synthetic-primary'},OWNER),code('RECOVERY_NOT_READY'));
  });
});

test('execution time merges parallel active windows and excludes stopped idle time', async t=>{
  const h=await fixture(t),item=create(h),first=h.codex.goals[0];const observed=first.input.onTool('intake.route',decision('dispatch',[task(h.flows[0])]));await pump(h,()=>h.codex.tasks.length===1,'the synthetic time window');h.codex.tasks[0].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the child end');await observed;await capacityFailure(h,item);
  const now=Date.now(),native=h.engine.run(item.routerRunId),child=h.engine.run(current(h,item).targetRunIds[0]);
  native.createdAt=native.stages[0].attempts[0].startedAt=new Date(now-120000).toISOString();native.endedAt=native.stages[0].attempts[0].endedAt=new Date(now-60000).toISOString();
  child.createdAt=child.stages[0].attempts[0].startedAt=new Date(now-110000).toISOString();child.endedAt=child.stages[0].attempts[0].endedAt=new Date(now-50000).toISOString();h.engine.store.put('run',native);h.engine.store.put('run',child);
  const value=current(h,item);value.createdAt=new Date(now-10000000).toISOString();delete value.executionTimeMeter;h.engine.store.put('intake',value);
  const timed=current(h,item);assert.equal(timed.executionTime?.usedSeconds,70);assert.ok(timed.executionTime!.totalElapsedSeconds>=10000);
  const recovered=await h.intake.retry(item.id,{note:'Continue using the remaining active-time allowance.',model:'synthetic-primary',policy:{maxElapsedSeconds:3600}},OWNER);assert.ok(h.codex.goals[1].input.timeoutSeconds>=3529&&h.codex.goals[1].input.timeoutSeconds<=3530);assert.equal(recovered.createdAt,value.createdAt);assert.equal(recovered.executionTimeMeter,'active-windows-v1');
  assert.ok(h.engine.store.events({runId:recovered.routerRunId}).some(event=>event.type==='goal.execution_time_meter_migrated'));
});

test('recovery can repeat a failed action against a refreshed workflow without replaying completed work', async t=>{
  const h=await fixture(t),item=create(h),originalFlow=h.flows[0],sameTask=task(originalFlow,'Repair the same bounded synthetic mismatch.');
  const firstObservation=h.codex.goals[0].input.onTool('intake.route',decision('dispatch',[sameTask]));await pump(h,()=>h.codex.tasks.length===1,'the first action');
  h.codex.tasks[0].completion.reject(new Error('Synthetic inspect budget failure.'));await pump(h,()=>current(h,item).status==='routing','the failed action evidence');await firstObservation;
  const failedRunId=current(h,item).targetRunIds[0];assert.equal(h.engine.run(failedRunId).status,'failed');await capacityFailure(h,item);
  const revised=h.engine.updatePipeline(originalFlow.id,originalFlow.revision,{...originalFlow,stages:[{...originalFlow.stages[0],prompt:'Perform the revised bounded synthetic repair.'}]},OWNER);
  await h.intake.retry(item.id,{note:'The earlier action failed; use the revised workflow.',model:'synthetic-primary',refreshConfiguration:true},OWNER);
  const secondObservation=h.codex.goals[1].input.onTool('intake.route',decision('dispatch',[sameTask]));await pump(h,()=>h.codex.tasks.length===2,'a new bounded action after the earlier failure');
  assert.match(h.codex.tasks[1].input.prompt,/revised bounded synthetic repair/);assert.equal(current(h,item).rounds.length,2);
  const secondRunId=current(h,item).targetRunIds[1];assert.equal(h.engine.run(secondRunId).snapshot.pipeline.revision,revised.revision);assert.equal(h.engine.run(failedRunId).snapshot.pipeline.revision,originalFlow.revision);
  h.codex.tasks[1].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the revised successful evidence');await secondObservation;
  const reused=await h.codex.goals[1].input.onTool('intake.route',decision('dispatch',[sameTask])) as {reused:boolean};assert.equal(reused.reused,true);assert.equal(h.codex.tasks.length,2);
});

test('stopping retry_wait during manual catalog validation cannot start a fresh native goal',async t=>{
  const h=await fixture(t),item=create(h,{recovery:{autoRetry:true,maxAttempts:2,backoffSeconds:30,allowedFallbackModels:[]}});await capacityFailure(h,item);
  const catalog=await h.codex.info(),pending=deferred<typeof catalog>();h.codex.info=()=>pending.promise;
  const starting=h.intake.retry(item.id,{note:'Replace the automatic wait manually.',model:'synthetic-primary'},OWNER);const ended=assert.rejects(starting,code('RECOVERY_CANCELLED'));
  h.intake.cancel(item.id,'Stop the waiting recovery while its catalog request is pending.',OWNER);pending.resolve(catalog);await ended;
  assert.equal(h.codex.goals.length,1);assert.equal(current(h,item).status,'stopped');assert.equal(current(h,item).nextRetryAt,undefined);
});

test('manual recovery extends action rounds only explicitly and never resets consumed actions',async t=>{
  const h=await fixture(t),item=create(h,{maxRounds:2});
  for(let index=0;index<2;index++){
    const observed=h.codex.goals[0].input.onTool('intake.route',decision('dispatch',[task(h.flows[index],`Accepted synthetic action ${index+1}.`)]));
    await pump(h,()=>h.codex.tasks.length===index+1,'an original accepted action');h.codex.tasks[index].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the accepted original result');await observed;
  }
  await h.codex.goals[0].input.onTool('intake.route',decision('stop'));await pump(h,()=>current(h,item).canRetry===true,'the first stopped supervisor');
  const originalSnapshot=structuredClone(h.engine.run(item.routerRunId).snapshot),oldDispatches=current(h,item).rounds.filter(round=>round.decision?.action==='dispatch').length;
  const sameBounds=await h.intake.retry(item.id,{note:'Continue without changing any action limit.',model:'synthetic-primary'},OWNER);
  assert.equal(sameBounds.policy.maxRounds,2);assert.equal(sameBounds.rounds.filter(round=>round.decision?.action==='dispatch').length,oldDispatches);
  await assert.rejects(h.codex.goals[1].input.onTool('intake.route',decision('dispatch',[task(h.flows[0],'A third distinct synthetic action.')])),code('GOAL_ROUND_LIMIT'));
  await pump(h,()=>current(h,item).canRetry===true,'the unchanged round-limit stop');assert.equal(h.codex.tasks.length,2);
  await assert.rejects(h.intake.retry(item.id,{note:'',model:'synthetic-primary',policy:{maxRounds:3}},OWNER),code('RECOVERY_NOTE_REQUIRED'));
  await assert.rejects(h.intake.retry(item.id,{note:'Do not shrink the action allowance.',model:'synthetic-primary',policy:{maxRounds:1}},OWNER),code('INVALID_POLICY_EXTENSION'));
  for(const maxRounds of [0,11])await assert.rejects(h.intake.retry(item.id,{note:'Reject an invalid action allowance.',model:'synthetic-primary',policy:{maxRounds}},OWNER),code('INVALID_GOAL_POLICY'));
  const note='Approve one additional cumulative action round.',expanded=await h.intake.retry(item.id,{note,model:'synthetic-primary',policy:{maxRounds:3}},OWNER);
  assert.equal(expanded.policy.maxRounds,3);assert.equal(expanded.rounds.filter(round=>round.decision?.action==='dispatch').length,2);
  const record=expanded.recoveryHistory!.at(-1)!;assert.equal(record.previousPolicy?.maxRounds,2);assert.equal(record.newPolicy?.maxRounds,3);
  const audit=h.engine.store.events({runId:expanded.routerRunId}).find(event=>event.type==='goal.policy_extended')!;assert.equal(audit.message,note);assert.deepEqual([(audit.data as {previous:Intake['policy']}).previous.maxRounds,(audit.data as {current:Intake['policy']}).current.maxRounds],[2,3]);
  const third=h.codex.goals[2].input.onTool('intake.route',decision('dispatch',[task(h.flows[0],'A third distinct synthetic action.')]));await pump(h,()=>h.codex.tasks.length===3,'the newly authorized third action');h.codex.tasks[2].completion.resolve({output:OUTPUT});await pump(h,()=>current(h,item).status==='routing','the third accepted result');await third;
  assert.equal(current(h,item).rounds.filter(round=>round.decision?.action==='dispatch').length,3);assert.deepEqual(h.engine.run(item.routerRunId).snapshot,originalSnapshot);
});

test('recovered completion uses the latest dispatch despite later stop or clarification decisions',async t=>{
  for(const closing of ['stop','clarify'] as const)for(const accepted of [true,false])await t.test(`${closing} accepted=${accepted}`,async sub=>{
    const h=await fixture(sub),item=create(h),first=h.codex.goals[0];
    const observed=first.input.onTool('intake.route',decision('dispatch',[task(h.flows[0])]));await pump(h,()=>h.codex.tasks.length===1,'the original action');
    if(accepted)h.codex.tasks[0].completion.resolve({output:OUTPUT});else h.codex.tasks[0].completion.reject(new Error('Synthetic evidence was not accepted.'));
    await pump(h,()=>current(h,item).status==='routing','the original action observations');await observed;
    await first.input.onTool('intake.route',{...decision(closing),...(closing==='clarify'?{question:'Which synthetic acceptance evidence should be used?'}:{})});
    await pump(h,()=>current(h,item).canRetry===true,'the closed native supervisor');assert.equal(current(h,item).rounds.at(-1)!.targetRunIds.length,0);
    const recovered=await h.intake.retry(item.id,{note:'Continue from the retained action evidence.',model:'synthetic-primary'},OWNER),second=h.codex.goals[1];
    if(!accepted){await assert.rejects(second.input.onTool('intake.route',decision('complete')),code('UNVERIFIED_COMPLETION'));assert.notEqual(current(h,item).status,'completed');return;}
    if(closing==='stop'){
      const linked=h.engine.startRun({projectId:h.project.id,pipelineId:h.flows[1].id,goal:'An active linked synthetic acceptance task.',baseline:item.baseline,idempotencyKey:randomUUID(),parentRunId:recovered.routerRunId},OWNER);
      await pump(h,()=>h.codex.tasks.length===2,'the additional active family member');await assert.rejects(second.input.onTool('intake.route',decision('complete')),code('ACTIVE_GOAL_WORK'));
      h.codex.tasks[1].completion.resolve({output:OUTPUT});await pump(h,()=>h.engine.run(linked.id).status==='completed','family termination');
    }
    const response=await second.input.onTool('intake.route',decision('complete')) as {accepted:boolean};assert.equal(response.accepted,true);assert.equal(current(h,item).status,'routing');
    second.completion.resolve({status:'complete',summary:'Retained accepted evidence completes the synthetic objective.'});await pump(h,()=>current(h,item).status==='completed','native completion after accepted evidence');
  });
});

function deliveryFlow(h:Fixture):Pipeline {
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'operations',name:'Synthetic manual delivery'},OWNER);
  return h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'delivery',name:'Manual browser and delivery acceptance',roleId:'operations',executor:'manual',dependsOn:[],prompt:'Record the actual synthetic browser and delivery evidence.',review:false}]},OWNER);
}

test('a blocked native supervisor preserves manual delivery and deployment observation until explicit continuation',async t=>{
  const h=await fixture(t),project=h.engine.project(h.project.id);h.project=await h.engine.updateProject(project.id,project.revision,{...project,repository:'synthetic-owner/synthetic-repository'},OWNER);
  const delivery=deliveryFlow(h),initial=h.engine.createPipeline({projectId:h.project.id,roleId:'operations',name:'Synthetic deployment observation'},OWNER);
  const deployment=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'observe',name:'Observe synthetic deployment',roleId:'operations',executor:'github',dependsOn:[],prompt:'Observe the configured synthetic CI run.',review:false,options:{mode:'observe'}}]},OWNER);
  const observation=deferred<{status:'completed'|'queued';summary:string;runId:number}>();h.engine.github.observe=async()=>observation.promise;
  const item=create(h),first=h.codex.goals[0];
  try{
    const delegated=first.input.onTool('intake.route',decision('dispatch',[task(delivery,'Record manual acceptance.'),task(deployment,'Observe the deployment.')]));
    await pump(h,()=>current(h,item).targetRunIds.length===2&&h.engine.run(current(h,item).targetRunIds[0]).status==='waiting'&&h.engine.run(current(h,item).targetRunIds[1]).status==='running','manual and deployment work');
    const [manualId,deploymentId]=current(h,item).targetRunIds;
    first.completion.resolve({status:'blocked',summary:'Waiting for manual browser acceptance and the deployment observation.'});
    await pump(h,()=>current(h,item).status==='clarification'&&h.engine.run(item.routerRunId).status==='cancelled','the native handoff');
    assert.equal((await delegated as {handoff:boolean}).handoff,true);
    assert.equal(h.engine.run(manualId).status,'waiting');assert.equal(h.engine.run(deploymentId).status,'running');assert.equal(h.engine.run(deploymentId).cancelRequested,undefined);
    assert.equal(current(h,item).canRetry,false);await assert.rejects(h.intake.retry(item.id,{note:'Do not duplicate pending handoff work.',model:'synthetic-primary'},OWNER),code('RECOVERY_NOT_READY'));
    const previousAttempt=structuredClone(h.engine.run(item.routerRunId).stages[0].attempts[0]);
    h.engine.completeManual(manualId,'delivery',{...OUTPUT,summary:'The synthetic live browser and delivery checks passed.'},OWNER);
    observation.resolve({status:'completed',summary:'The synthetic deployment succeeded.',runId:314});
    await pump(h,()=>current(h,item).targetRunIds.every(id=>h.engine.run(id).status==='completed'),'the existing handoff outcomes');
    assert.equal(h.codex.goals.length,1);assert.equal(current(h,item).status,'clarification');assert.equal(current(h,item).canRetry,true);assert.deepEqual(h.engine.run(item.routerRunId).stages[0].attempts[0],previousAttempt);
    await h.intake.retry(item.id,{note:'The existing manual and deployment evidence is complete; perform final acceptance.',model:'synthetic-primary'},OWNER);
    assert.equal(h.codex.goals.length,2);await h.codex.goals[1].input.onTool('intake.route',decision('complete'));h.codex.goals[1].completion.resolve({status:'complete',summary:'Accepted the retained manual and deployment evidence.'});
    await pump(h,()=>current(h,item).status==='completed','explicit final native acceptance');assert.deepEqual(h.engine.run(item.routerRunId).stages[0].attempts[0],previousAttempt);
  }finally{observation.resolve({status:'completed',summary:'Synthetic observation teardown.',runId:314});await immediate();}
});

test('handoff preservation never suppresses explicit cancellation, capacity or execution limits',async t=>{
  for(const mode of ['cancel','native_budget','capacity','handoff_budget','handoff_timeout'] as const)await t.test(mode,async sub=>{
    const h=await fixture(sub),delivery=deliveryFlow(h),item=create(h),first=h.codex.goals[0];
    const delegated=first.input.onTool('intake.route',decision('dispatch',[task(delivery),task(h.flows[0])]));void delegated.catch(()=>{});
    await pump(h,()=>current(h,item).targetRunIds.length===2&&h.codex.tasks.length===1,'work that must still obey stop conditions');
    if(mode==='capacity')first.input.onEvent({type:'error',message:CAPACITY,ref:first.ref,data:{code:'model_at_capacity'}});
    first.completion.resolve({status:mode==='native_budget'?'budgetLimited':'blocked',summary:mode==='capacity'?CAPACITY:'A synthetic native handoff or limit.'});
    if(mode==='native_budget'||mode==='capacity'){
      await pump(h,()=>current(h,item).targetRunIds.every(id=>h.engine.run(id).status==='cancelled'),'required native-failure cleanup');
      assert.equal(current(h,item).status,mode==='capacity'?'failed':'stopped');
    }else{
      await pump(h,()=>current(h,item).status==='clarification','the pending handoff');assert.equal(h.codex.tasks[0].aborted,false);
      if(mode==='cancel')h.intake.cancel(item.id,'Explicitly stop the pending handoff.',OWNER);
      if(mode==='handoff_budget')h.codex.tasks[0].input.onEvent({type:'usage',message:'Actual reported synthetic usage exceeds the goal limit.',usage:{input:10000,output:1,total:10001}});
      if(mode==='handoff_timeout'){const manual=h.engine.run(current(h,item).targetRunIds[0]);manual.stages[0].attempts[0].startedAt=new Date(Date.now()-301000).toISOString();h.engine.store.put('run',manual);}
      await pump(h,()=>current(h,item).status==='stopped'&&current(h,item).targetRunIds.every(id=>h.engine.run(id).status==='cancelled'),'explicit or bounded handoff cleanup');
    }
    await delegated;assert.equal(h.codex.tasks[0].aborted,true);assert.equal(h.codex.goals.length,1);
  });
});

class SyntheticDecisionPlanner implements GoalPlanner {
  calls: {input: GoalPlannerInput; ref: ExecutionRef; completion: ReturnType<typeof deferred<{decision: IntakeDecision; usage?: Usage}>>}[] = [];
  private engine: Engine;
  constructor(engine: Engine) {this.engine = engine;}
  async start(input: GoalPlannerInput) {
    const ref: ExecutionRef = {provider: 'multica', externalId: `synthetic-planner-task-${this.calls.length + 1}`, issueId: `synthetic-planner-issue-${this.calls.length + 1}`};
    const record = {id: input.executionId, projectId: input.project.id, runId: input.executionId, stageId: `decision-${input.rounds.length + 1}`, taskId: ref.externalId, issueId: ref.issueId, status: 'running', cleanupConfirmed: false};
    this.engine.store.put('multica-execution', record);
    const completion = deferred<{decision: IntakeDecision; usage?: Usage}>();
    this.calls.push({input, ref, completion});
    input.signal.addEventListener('abort', () => {if (!completion.settled) {record.status = 'cancelled'; record.cleanupConfirmed = true; this.engine.store.put('multica-execution', record); completion.reject(new Error('Synthetic planner task authoritatively cancelled.'));}}, {once: true});
    input.onEvent({type: 'planner.task.started', message: 'A synthetic one-decision task started.', ref});
    return {ref, completion: completion.promise.then(value => {record.status = 'completed'; record.cleanupConfirmed = true; this.engine.store.put('multica-execution', record); return value;})};
  }
}
async function plannerFixture(t: TestContext) {
  const h = await fixture(t), planner = new SyntheticDecisionPlanner(h.engine);
  h.engine.goalPlanner = planner;
  return {...h, planner};
}

test('one-decision planning spends no model calls during manual/CI waits and preserves each real reference', async t => {
  const h = await plannerFixture(t), original = h.engine.project(h.project.id);
  h.project = await h.engine.updateProject(original.id, original.revision, {...original, repository: 'synthetic-owner/synthetic-repository'}, OWNER);
  const manual = deliveryFlow(h), initial = h.engine.createPipeline({projectId: h.project.id, roleId: 'operations', name: 'Synthetic observed CI'}, OWNER);
  const ci = h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [{id: 'observe', name: 'Observe CI', roleId: 'operations', executor: 'github', dependsOn: [], prompt: 'Observe one known synthetic run.', review: false, options: {mode: 'observe', runId: 314}}]}, OWNER);
  const observation = deferred<{status: 'completed'; summary: string; runId: number}>();
  h.engine.github.observe = async () => observation.promise;
  const item = create(h);
  h.planner.calls[0].completion.resolve({decision: decision('dispatch', [task(manual), task(ci)]), usage: {input: 100, cachedInput: 80, output: 10, total: 110}});
  await pump(h, () => current(h, item).targetRunIds.length === 2 && current(h, item).status === 'dispatched', 'manual and CI handoff');
  const [manualId, ciId] = current(h, item).targetRunIds;
  const firstRun = structuredClone(h.engine.run(item.routerRunId));
  for (let index = 0; index < 20; index++) {await h.engine.tick(); await immediate();}
  assert.equal(h.planner.calls.length, 1); assert.equal(h.codex.goals.length, 0); assert.equal(h.codex.tasks.length, 0);
  assert.equal(h.engine.run(manualId).status, 'waiting'); assert.equal(h.engine.run(ciId).status, 'running');
  h.engine.completeManual(manualId, 'delivery', OUTPUT, OWNER);
  for (let index = 0; index < 5; index++) {await h.engine.tick(); await immediate();}
  assert.equal(h.planner.calls.length, 1);
  observation.resolve({status: 'completed', summary: 'Synthetic CI is accepted.', runId: 314});
  await pump(h, () => h.planner.calls.length === 2, 'the next event-driven decision');
  assert.deepEqual(h.planner.calls[1].input.observations.map(value => value.status), ['completed', 'completed']);
  assert.equal(h.planner.calls[1].input.remaining.tokens, 9970);
  h.planner.calls[1].completion.resolve({decision: decision('complete'), usage: {input: 20, output: 5, total: 25}});
  await pump(h, () => current(h, item).status === 'completed', 'accepted planner completion');
  const ids = current(h, item).supervisorRunIds!;
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]); assert.deepEqual(h.engine.run(ids[0]), firstRun);
  for (const [index, id] of ids.entries()) {
    const run = h.engine.run(id), attempt = run.stages[0].attempts[0];
    assert.equal(run.executionKind, 'agent-goal'); assert.equal(attempt.provider, 'multica');
    assert.deepEqual(attempt.ref, h.planner.calls[index].ref); assert.ok(attempt.usage); assert.equal(attempt.nativeGoal, undefined);
  }
});

test('review feedback reworks only its stage and does not create another planner until acceptance', async t => {
  const h = await plannerFixture(t), original = h.flows[0];
  const reviewed = h.engine.updatePipeline(original.id, original.revision, {...original, stages: original.stages.map(stage => ({...stage, review: true}))}, OWNER);
  const item = create(h); h.planner.calls[0].completion.resolve({decision: decision('dispatch', [task(reviewed), task(h.flows[1])])});
  await pump(h, () => h.codex.tasks.length === 2, 'parallel worker tasks');
  h.codex.tasks[0].completion.resolve({output: OUTPUT}); h.codex.tasks[1].completion.resolve({output: OUTPUT});
  await pump(h, () => h.engine.run(current(h, item).targetRunIds[0]).status === 'review', 'independent review');
  const [reviewedId, acceptedId] = current(h, item).targetRunIds;
  const accepted = structuredClone(h.engine.run(acceptedId));
  h.engine.review(reviewedId, 'inspect', 'revise', 'Add the missing synthetic acceptance evidence.', OWNER);
  await pump(h, () => h.codex.tasks.length === 3, 'focused review correction');
  assert.equal(h.planner.calls.length, 1); assert.deepEqual(h.engine.run(acceptedId), accepted);
  h.codex.tasks[2].completion.resolve({output: {...OUTPUT, summary: 'The requested evidence is now present.'}});
  await pump(h, () => h.engine.run(reviewedId).status === 'review', 'corrected review result');
  assert.equal(h.planner.calls.length, 1); h.engine.review(reviewedId, 'inspect', 'accept', 'The revised evidence is sufficient.', OWNER);
  await pump(h, () => h.planner.calls.length === 2, 'a decision after real acceptance');
  assert.equal(h.engine.run(reviewedId).stages[0].attempts.length, 2);
  h.planner.calls[1].completion.resolve({decision: decision('complete')});
  await pump(h, () => current(h, item).status === 'completed', 'reviewed goal completion');
});

test('planner retries reuse an owned failed stage without replaying its successful predecessors or peers', async t => {
  const h = await plannerFixture(t), initial = h.flows[0];
  const flow = h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [
    {id: 'prepare', name: 'Prepare', roleId: 'development', executor: 'codex', dependsOn: [], prompt: 'Prepare one synthetic artifact.', review: false},
    {id: 'repair', name: 'Repair', roleId: 'development', executor: 'codex', dependsOn: ['prepare'], prompt: 'Verify one synthetic artifact.', review: false},
  ]}, OWNER);
  const item = create(h, {maxRounds: 3}); h.planner.calls[0].completion.resolve({decision: decision('dispatch', [task(flow), task(h.flows[1])])});
  await pump(h, () => h.codex.tasks.length === 2, 'initial parallel work');
  h.codex.tasks[0].completion.resolve({output: OUTPUT}); h.codex.tasks[1].completion.resolve({output: OUTPUT});
  await pump(h, () => h.codex.tasks.length === 3, 'the dependent stage');
  h.codex.tasks[2].completion.reject(new Error('Synthetic repair needs one bounded retry.'));
  await pump(h, () => h.planner.calls.length === 2, 'failure observations');
  const [failedId, peerId] = current(h, item).targetRunIds, peer = structuredClone(h.engine.run(peerId));
  const prepared = structuredClone(h.engine.run(failedId).stages[0]);
  h.planner.calls[1].completion.resolve({decision: {...decision('stop'), action: 'retry', retry: {runId: failedId, stageId: 'repair', note: 'Retry the failed check against the retained artifact.'}}});
  await pump(h, () => h.codex.tasks.length === 4, 'the single stage retry');
  assert.equal(h.planner.calls.length, 2); assert.deepEqual(h.engine.run(peerId), peer); assert.deepEqual(h.engine.run(failedId).stages[0], prepared);
  h.codex.tasks[3].completion.resolve({output: OUTPUT});
  await pump(h, () => h.planner.calls.length === 3, 'retry outcome observations');
  assert.equal(h.planner.calls[2].input.remaining.rounds, 1); assert.equal(h.engine.run(failedId).stages[1].attempts.length, 2);
  h.planner.calls[2].completion.resolve({decision: decision('complete')});
  await pump(h, () => current(h, item).status === 'completed', 'completion after the targeted retry');
  assert.deepEqual(current(h, item).rounds.map(round => round.decision?.action), ['dispatch', 'retry', 'complete']);
});

test('planner stage retries reject unowned work and cumulative action-round exhaustion', async t => {
  for (const mode of ['unowned', 'round-limit'] as const) await t.test(mode, async sub => {
    const h = await plannerFixture(sub);
    let unowned: Run | undefined;
    if (mode === 'unowned') {
      unowned = h.engine.startRun({projectId: h.project.id, pipelineId: h.flows[1].id, goal: 'An unrelated synthetic action.', baseline: 'Synthetic.', idempotencyKey: randomUUID()}, OWNER);
      await pump(h, () => h.codex.tasks.length === 1, 'unrelated work'); h.codex.tasks[0].completion.reject(new Error('Unrelated synthetic failure.'));
      await pump(h, () => h.engine.run(unowned!.id).status === 'failed', 'unrelated failure');
    }
    const offset = h.codex.tasks.length, item = create(h, {maxRounds: mode === 'unowned' ? 3 : 1});
    h.planner.calls[0].completion.resolve({decision: decision('dispatch', [task(h.flows[0])])});
    await pump(h, () => h.codex.tasks.length === offset + 1, 'owned work'); h.codex.tasks[offset].completion.reject(new Error('Owned synthetic failure.'));
    await pump(h, () => h.planner.calls.length === 2, 'owned failure observation');
    h.planner.calls[1].completion.resolve({decision: {...decision('stop'), action: 'retry', retry: {runId: unowned?.id ?? current(h, item).targetRunIds[0], stageId: mode === 'unowned' ? 'verify' : 'inspect', note: 'A bounded synthetic retry request.'}}});
    await pump(h, () => current(h, item).status === (mode === 'unowned' ? 'failed' : 'stopped'), 'rejected retry');
    assert.equal(h.codex.tasks.length, offset + 1); assert.equal(current(h, item).rounds.length, 1);
    if (mode === 'unowned') assert.match(current(h, item).error!, /only this goal/);
  });
});

test('planner restart preserves pending work and old native records until explicit continuation', async t => {
  const h = await fixture(t), legacy = create(h); h.intake.cancel(legacy.id, 'Close the legacy synthetic supervisor.', OWNER);
  await pump(h, () => h.engine.run(legacy.routerRunId).status === 'cancelled', 'legacy termination');
  const legacyRecord = structuredClone(h.engine.run(legacy.routerRunId)), planner = new SyntheticDecisionPlanner(h.engine); h.engine.goalPlanner = planner;
  const manual = deliveryFlow(h), item = create(h); planner.calls[0].completion.resolve({decision: decision('dispatch', [task(manual)])});
  await pump(h, () => current(h, item).status === 'dispatched', 'the pending manual handoff');
  const manualId = current(h, item).targetRunIds[0]; await h.intake.close(); h.intake = new IntakeService(h.engine);
  for (let index = 0; index < 5; index++) {await h.engine.tick(); await immediate();}
  assert.equal(planner.calls.length, 1); assert.equal(h.engine.run(manualId).status, 'waiting'); assert.equal(current(h, item).status, 'failed');
  h.engine.completeManual(manualId, 'delivery', OUTPUT, OWNER);
  await pump(h, () => current(h, item).canRetry === true, 'explicit continuation availability');
  assert.equal(planner.calls.length, 1); assert.deepEqual(h.engine.run(legacy.routerRunId), legacyRecord);
  await h.intake.retry(item.id, {note: 'Continue from the already accepted manual evidence.', model: 'synthetic-primary'}, OWNER);
  assert.equal(planner.calls.length, 2); assert.equal(planner.calls[1].input.observations[0].status, 'completed');
  planner.calls[1].completion.resolve({decision: decision('complete')});
  await pump(h, () => current(h, item).status === 'completed', 'explicitly continued goal completion');
  const recovery = current(h, item).recoveryHistory!.at(-1)!;
  assert.equal(recovery.status, 'completed'); assert.ok(recovery.endedAt); assert.deepEqual(recovery.newRef, planner.calls[1].ref);
  assert.deepEqual(h.engine.run(legacy.routerRunId), legacyRecord);
});

test('planner clarification retains owned pending work while explicit stop cancels it', async t => {
  const h = await plannerFixture(t), item = create(h), manual = deliveryFlow(h);
  const owned = h.engine.startRun({projectId: h.project.id, pipelineId: manual.id, goal: 'Retain this existing owned human action.', baseline: item.baseline, parentRunId: item.routerRunId, idempotencyKey: randomUUID()}, OWNER);
  await pump(h, () => h.engine.run(owned.id).status === 'waiting', 'existing human work');
  h.planner.calls[0].completion.resolve({decision: {...decision('clarify'), question: 'Which actual acceptance target should the reviewer use?'}});
  await pump(h, () => current(h, item).status === 'clarification', 'the clarification question');
  assert.equal(h.engine.run(owned.id).status, 'waiting'); assert.equal(h.planner.calls.length, 1);
  h.intake.cancel(item.id, 'Explicitly stop the remaining owned work.', OWNER);
  await pump(h, () => h.engine.run(owned.id).status === 'cancelled', 'explicit owned-work cancellation');
});

test('planner transport uncertainty cannot recover into a new run until the exact owned task cleanup is confirmed', async t => {
  const h = await plannerFixture(t), item = create(h), first = h.planner.calls[0];
  first.input.onEvent({type: 'usage', message: 'Synthetic usage before transport uncertainty.', ref: first.ref, usage: {input: 100, cachedInput: 50, output: 10, total: 110}});
  first.completion.reject(new AppError('TRANSPORT_ERROR', 'The task observation transport failed.', 409));
  await pump(h, () => current(h, item).status === 'failed', 'the uncertain task observation');
  const before = structuredClone(h.engine.run(item.routerRunId)), attempt = before.stages[0].attempts[0];
  assert.equal(attempt.output, undefined); assert.deepEqual(attempt.ref, first.ref); assert.deepEqual(attempt.usage, {input: 100, cachedInput: 50, output: 10, total: 110});
  assert.equal(current(h, item).canRetry, false);
  await assert.rejects(h.intake.retry(item.id, {note: 'Do not duplicate uncertain external work.', model: 'synthetic-primary'}, OWNER), code('RECOVERY_NOT_READY'));
  assert.equal(h.planner.calls.length, 1); assert.deepEqual(current(h, item).supervisorRunIds, [item.routerRunId]);
  const record = {...h.engine.store.get<{id: string; projectId: string; runId: string; stageId: string; taskId: string; issueId: string; status: string; cleanupConfirmed: boolean}>('multica-execution', item.routerRunId)!, status: 'failed', cleanupConfirmed: true};
  for (const patch of [{projectId: 'another-synthetic-project'}, {runId: 'another-synthetic-run'}, {stageId: 'supervise'}, {taskId: 'another-synthetic-task'}, {issueId: 'another-synthetic-issue'}, {status: 'running'}, {cleanupConfirmed: false}]) {
    h.engine.store.put('multica-execution', {...record, ...patch});
    assert.equal(current(h, item).canRetry, false, 'Another scope or unconfirmed/nonterminal record cannot authorize recovery.');
  }
  h.engine.store.put('multica-execution', record); assert.equal(current(h, item).canRetry, true);
  await h.intake.retry(item.id, {note: 'The exact previous task is now authoritatively terminal.', model: 'synthetic-primary'}, OWNER);
  assert.equal(h.planner.calls.length, 2); assert.equal(h.planner.calls[1].input.remaining.tokens, 9940); assert.deepEqual(h.engine.run(item.routerRunId), before);
});
