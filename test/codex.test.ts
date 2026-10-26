import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {setImmediate as immediate} from 'node:timers/promises';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {createCodexAdapter} from '../src/adapters/codex.ts';
import type {CodexAdapterOptions, CodexProcess} from '../src/adapters/codex.ts';
import type {AdapterEvent, CodexExecutionInput} from '../src/adapters/types.ts';
import type {ExecutionRef, RoleProfile, TaskOutput} from '../src/contracts.ts';

type WireMessage = {id?: string | number; method?: string; params?: Record<string, any>; result?: any; error?: any};
type Handler = (message: WireMessage, child: FakeProcess) => boolean | void;
const WORKSPACE = '/workspace/synthetic-project';
const SKILL = {name: 'synthetic-check', path: '/skills/synthetic-check/SKILL.md', description: 'Check a synthetic artifact.', enabled: true};
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Checked the synthetic artifact.', artifacts: [], observations: ['No changes were needed.']};

class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly requests: WireMessage[] = [];
  readonly responses: WireMessage[] = [];
  readonly kills: NodeJS.Signals[] = [];
  readonly nativeGoals = new Map<string, Record<string, any>>();
  private buffer = '';
  private threads = 0;
  private serverId = 0;
  private exited = false;
  handler?: Handler;

  constructor(handler?: Handler) {
    super();
    this.handler = handler;
    this.stdin = new Writable({write: (chunk, _encoding, callback) => {
      this.buffer += chunk.toString();
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, newline)) as WireMessage;
        this.buffer = this.buffer.slice(newline + 1);
        if (message.method) {
          this.requests.push(message);
          if (!this.handler?.(message, this)) this.defaultReply(message);
        } else {
          this.responses.push(message);
          this.emit('response', message);
        }
      }
      callback();
    }});
  }

  defaultReply(message: WireMessage): void {
    const params = message.params ?? {};
    switch (message.method) {
      case 'initialize': this.reply(message.id!, {userAgent: 'synthetic/0.133.0', platformOs: 'synthetic', platformFamily: 'synthetic', codexHome: '/synthetic/codex'}); break;
      case 'initialized': break;
      case 'account/read': this.reply(message.id!, {account: {type: 'chatgpt', email: 'synthetic-account@example.invalid', planType: 'unknown'}, requiresOpenaiAuth: true}); break;
      case 'model/list': this.reply(message.id!, {data: [{id: 'catalog-id', model: 'synthetic-model', displayName: 'Synthetic Model', isDefault: true, supportedReasoningEfforts: [{reasoningEffort: 'low'}, {reasoningEffort: 'medium'}]}], nextCursor: null}); break;
      case 'skills/list': this.reply(message.id!, {data: [{cwd: params.cwds[0], skills: [SKILL, {...SKILL, name: 'disabled', enabled: false}], errors: []}]}); break;
      case 'thread/start': this.reply(message.id!, {thread: {id: `thread-${++this.threads}`}, model: 'native-effective-model', modelProvider: 'synthetic-provider', reasoningEffort: 'low', serviceTier: 'default', approvalPolicy: 'never', sandbox: params.sandbox === 'workspace-write' ? {type: 'workspaceWrite', networkAccess: false, writableRoots: [params.cwd]} : {type: 'readOnly', networkAccess: false}}); break;
      case 'thread/goal/set': {
        const goal = {threadId: params.threadId, objective: params.objective, status: params.status, tokenBudget: params.tokenBudget, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 100, updatedAt: 100};
        this.nativeGoals.set(params.threadId, goal);
        this.reply(message.id!, {goal});
        queueMicrotask(() => {this.notify('thread/goal/updated', {threadId: params.threadId, goal}); this.notify('turn/started', {threadId: params.threadId, turn: {id: `${params.threadId}-goal-turn-1`, status: 'inProgress', items: []}});});
        break;
      }
      case 'thread/goal/get': this.reply(message.id!, {goal: this.nativeGoals.get(params.threadId) ?? null}); break;
      case 'thread/goal/clear': {
        const cleared = this.nativeGoals.delete(params.threadId);
        this.reply(message.id!, {cleared});
        if (cleared) queueMicrotask(() => this.notify('thread/goal/cleared', {threadId: params.threadId}));
        break;
      }
      case 'turn/start': this.reply(message.id!, {turn: {id: `${params.threadId}-turn`, status: 'inProgress', items: [], error: null}}); break;
      case 'turn/steer': this.reply(message.id!, {turnId: params.expectedTurnId}); break;
      case 'turn/interrupt':
        this.reply(message.id!, {});
        queueMicrotask(() => this.notify('turn/completed', {threadId: params.threadId, turn: {id: params.turnId, status: 'interrupted', items: []}}));
        break;
      default: throw new Error(`Unexpected client method ${message.method}`);
    }
  }

  reply(id: string | number, result: unknown): void {this.send({id, result});}
  send(message: WireMessage): void {this.stdout.write(`${JSON.stringify(message)}\n`);}
  notify(method: string, params: Record<string, any>): void {
    if (method === 'thread/goal/updated') this.nativeGoals.set(params.threadId, params.goal);
    if (method === 'thread/goal/cleared') this.nativeGoals.delete(params.threadId);
    this.send({method, params});
  }
  async ask(method: string, params: Record<string, unknown>): Promise<WireMessage> {
    const id = `server-${++this.serverId}`;
    const response = new Promise<WireMessage>((resolveResponse, reject) => {
      const timer = setTimeout(() => {this.off('response', listener); reject(new Error(`Missing client response for ${method}`));}, 1000);
      const listener = (value: WireMessage) => {
        if (value.id !== id) return;
        clearTimeout(timer);
        this.off('response', listener);
        resolveResponse(value);
      };
      this.on('response', listener);
    });
    this.send({id, method, params});
    return response;
  }
  complete(ref: ExecutionRef, output: unknown = OUTPUT): void {
    this.notify('item/completed', {threadId: ref.threadId, turnId: ref.turnId, item: {id: 'final-item', type: 'agentMessage', phase: 'final_answer', text: typeof output === 'string' ? output : JSON.stringify(output)}});
    this.notify('turn/completed', {threadId: ref.threadId, turn: {id: ref.turnId, status: 'completed', items: []}});
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal);
    if (!this.exited) {this.exited = true; queueMicrotask(() => this.emit('exit', null, signal));}
    return true;
  }
}

function harness(t: TestContext, handler?: Handler, options: CodexAdapterOptions = {}) {
  const child = new FakeProcess(handler);
  let launches = 0;
  const adapter = createCodexAdapter({launch: () => {launches++; return child as unknown as CodexProcess;}, getVersion: async () => '0.133.0', requestTimeoutMs: 200, interruptGraceMs: 50, ...options});
  t.after(() => adapter.close());
  return {adapter, child, get launches() {return launches;}};
}

function input(overrides: Partial<CodexExecutionInput> = {}, roleOverrides: Partial<RoleProfile> = {}) {
  const controller = new AbortController();
  const events: AdapterEvent[] = [];
  const role: RoleProfile = {id: 'synthetic-role', name: 'Synthetic', description: 'Synthetic test role.', instructions: 'Review the synthetic artifact.', model: 'synthetic-model', effort: 'medium', sandbox: 'read-only', skills: [], tools: [], ...roleOverrides};
  const value: CodexExecutionInput = {workspace: WORKSPACE, role, prompt: 'Check the supplied artifact.', timeoutSeconds: 5, tokenBudget: 10000, signal: controller.signal, onEvent: event => events.push(event), onTool: async () => ({synthetic: true}), ...overrides};
  return {value, controller, events, role};
}

test('initializes once, discovers models and enabled workspace skills, and exposes only native auth status', async t => {
  const h = harness(t, (message, child) => {
    if (message.method !== 'model/list') return;
    if (!message.params?.cursor) child.reply(message.id!, {data: [{id: 'catalog-a', model: 'synthetic-a', displayName: 'Synthetic A', supportedReasoningEfforts: [{reasoningEffort: 'low'}], isDefault: true}], nextCursor: 'next'});
    else child.reply(message.id!, {data: [{id: 'catalog-b', model: 'synthetic-b', displayName: 'Synthetic B', supportedReasoningEfforts: [{reasoningEffort: 'high'}], isDefault: false}], nextCursor: null});
    return true;
  });
  h.child.stderr.write('synthetic-account@example.invalid sk-synthetic-hidden-value');
  const [info, skills] = await Promise.all([h.adapter.info(), h.adapter.skills(WORKSPACE)]);
  assert.equal(h.launches, 1);
  assert.equal(h.child.requests[0].method, 'initialize');
  assert.equal(h.child.requests[0].params?.capabilities.experimentalApi, true);
  const initialized = h.child.requests.findIndex(message => message.method === 'initialized');
  assert.ok(initialized > 0);
  assert.ok(h.child.requests.findIndex(message => message.method === 'account/read') > initialized);
  assert.deepEqual(info, {available: true, connected: true, version: '0.133.0', authenticated: true, dynamicTools: true, models: [
    {id: 'synthetic-a', name: 'Synthetic A', efforts: ['low'], isDefault: true},
    {id: 'synthetic-b', name: 'Synthetic B', efforts: ['high'], isDefault: false},
  ]});
  assert.doesNotMatch(JSON.stringify(info), /synthetic-account|hidden-value|codexHome|planType/);
  assert.deepEqual(skills, [{name: SKILL.name, path: SKILL.path, description: SKILL.description}]);
  assert.deepEqual(h.child.requests.find(message => message.method === 'account/read')?.params, {refreshToken: false});
});

test('unauthenticated and failed discoveries remain distinct from connected native transport', async t => {
  const h = harness(t, (message, child) => {
    if (message.method === 'account/read') {child.reply(message.id!, {account: null, requiresOpenaiAuth: true}); return true;}
    if (message.method === 'model/list') {child.send({id: message.id!, error: {code: -32001, message: 'sk-synthetic-secret synthetic-account@example.invalid'}}); return true;}
  });
  const info = await h.adapter.info();
  assert.equal(info.connected, true);
  assert.equal(info.authenticated, false);
  assert.deepEqual(info.models, []);
  assert.match(info.error!, /model discovery failed/);
  assert.doesNotMatch(JSON.stringify(info), /synthetic-secret|synthetic-account/);
});

test('applies role settings and actual skills, streams progress, and completes with reported usage', async t => {
  const h = harness(t);
  const run = input({}, {sandbox: 'workspace-write', skills: [{name: SKILL.name, path: SKILL.path}], tools: ['context.read', 'knowledge.search']});
  const execution = await h.adapter.start(run.value);
  assert.deepEqual(execution.ref, {threadId: 'thread-1', turnId: 'thread-1-turn'});
  const thread = h.child.requests.find(message => message.method === 'thread/start')!.params!;
  const turn = h.child.requests.find(message => message.method === 'turn/start')!.params!;
  assert.equal(thread.cwd, WORKSPACE);
  assert.equal(thread.sandbox, 'workspace-write');
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.serviceTier, 'default');
  assert.match(thread.developerInstructions, /Review the synthetic artifact/);
  assert.deepEqual(thread.dynamicTools.map((tool: any) => tool.name), ['gwi_context_read', 'gwi_knowledge_search']);
  assert.equal(turn.model, 'synthetic-model');
  assert.equal(turn.effort, 'medium');
  assert.equal(turn.serviceTier, 'default');
  assert.deepEqual(turn.runtimeWorkspaceRoots, [WORKSPACE]);
  assert.deepEqual(turn.sandboxPolicy, {type: 'workspaceWrite', writableRoots: [WORKSPACE], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true});
  assert.equal(turn.approvalPolicy, 'never');
  assert.equal(turn.input[0].text, '$synthetic-check\n\nCheck the supplied artifact.');
  assert.deepEqual(turn.input[1], {type: 'skill', name: SKILL.name, path: SKILL.path});
  assert.equal(turn.outputSchema.additionalProperties, false);
  h.child.notify('item/agentMessage/delta', {...execution.ref, itemId: 'commentary', delta: 'Examining the artifact.'});
  h.child.notify('item/commandExecution/outputDelta', {...execution.ref, itemId: 'command', delta: 'Synthetic check output.'});
  h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 120, outputTokens: 40, totalTokens: 160}, last: {inputTokens: 50, outputTokens: 40, totalTokens: 90}}});
  h.child.complete(execution.ref, {...OUTPUT, artifacts: [{label: 'Synthetic report', path: '/workspace/synthetic-project/report.txt', url: null}]});
  const result = await execution.completion;
  assert.deepEqual(result.usage, {input: 120, output: 40, total: 160});
  assert.deepEqual(result.output.artifacts, [{label: 'Synthetic report', path: '/workspace/synthetic-project/report.txt'}]);
  assert.ok(run.events.some(event => event.message === 'Examining the artifact.'));
  assert.ok(run.events.some(event => event.message === 'Synthetic check output.'));
  assert.ok(run.events.some(event => event.usage?.total === 160));
  assert.ok(run.events.every(event => event.ref?.threadId === execution.ref.threadId));
});

test('missing selected skills and pre-cancelled work never launch native turns', async t => {
  const h = harness(t);
  const missing = input({}, {skills: [{name: 'not-installed', path: '/skills/not-installed/SKILL.md'}]});
  await assert.rejects(h.adapter.start(missing.value), /not installed and enabled/);
  const cancelled = input();
  cancelled.controller.abort();
  await assert.rejects(h.adapter.start(cancelled.value), /cancelled before it started/);
  assert.equal(h.child.requests.some(message => message.method === 'thread/start'), false);
  assert.equal(h.child.requests.some(message => message.method === 'turn/start'), false);
});

test('read-only policy is explicit and unavailable token usage is not synthesized', async t => {
  const h = harness(t);
  const run = input({}, {model: null});
  const execution = await h.adapter.start(run.value);
  const turn = h.child.requests.find(message => message.method === 'turn/start')!.params!;
  assert.deepEqual(turn.sandboxPolicy, {type: 'readOnly', networkAccess: false});
  assert.equal(Object.hasOwn(turn, 'model'), false);
  h.child.complete(execution.ref);
  const result = await execution.completion;
  assert.equal(Object.hasOwn(result, 'usage'), false);
  assert.deepEqual(result.output, OUTPUT);
});

test('dynamic tool callbacks are scoped to the active turn and frozen GWI role permissions', async t => {
  const h = harness(t);
  const calls: unknown[] = [];
  const run = input({onTool: async (tool, args) => {calls.push([tool, args]); return {projectId: 'synthetic-project', revision: 3};}}, {tools: ['context.read']});
  const execution = await h.adapter.start(run.value);
  run.role.tools.push('run.start');
  const allowed = await h.child.ask('item/tool/call', {...execution.ref, callId: 'call-1', tool: 'gwi_context_read', arguments: {}});
  assert.equal(allowed.result.success, true);
  assert.deepEqual(JSON.parse(allowed.result.contentItems[0].text), {projectId: 'synthetic-project', revision: 3});
  for (const params of [
    {...execution.ref, tool: 'gwi_run_start', arguments: {}},
    {...execution.ref, tool: 'gwi_project_bootstrap', arguments: {proposal: {}, sources: []}},
    {...execution.ref, tool: 'gwi_context_read', arguments: 'invalid'},
    {...execution.ref, turnId: 'another-turn', tool: 'gwi_context_read', arguments: {}},
    {...execution.ref, threadId: 'another-thread', tool: 'gwi_context_read', arguments: {}},
    {...execution.ref, namespace: 'unexpected', tool: 'gwi_context_read', arguments: {}},
  ]) {
    const denied = await h.child.ask('item/tool/call', {...params, callId: 'denied-call'});
    assert.equal(denied.result.success, false);
    assert.ok(denied.result.contentItems[0].text.length);
  }
  assert.deepEqual(calls, [['context.read', {}]]);
  assert.ok(run.events.some(event => event.type === 'gwi.tool.denied'));
  h.child.complete(execution.ref);
  await execution.completion;
});

test('tool validation errors are returned as failures with credentials redacted', async t => {
  const h = harness(t);
  const run = input({onTool: async () => {throw new Error('Denied project synthetic-account@example.invalid access_token=synthetic-secret sk-synthetic-key');}}, {tools: ['pipeline.write']});
  const execution = await h.adapter.start(run.value);
  const reply = await h.child.ask('item/tool/call', {...execution.ref, callId: 'call-error', tool: 'gwi_pipeline_write', arguments: {pipelineId: 'other-project-pipeline'}});
  assert.equal(reply.result.success, false);
  assert.match(reply.result.contentItems[0].text, /Denied project/);
  assert.doesNotMatch(JSON.stringify(reply), /synthetic-account|synthetic-secret|synthetic-key/);
  h.child.complete(execution.ref, {...OUTPUT, outcome: 'blocked'});
  await execution.completion;
});

test('concurrent threads retain separate progress, permissions, output and usage', async t => {
  const h = harness(t);
  const first = input({}, {tools: ['context.read']});
  const second = input({}, {tools: ['run.read']});
  const [a, b] = await Promise.all([h.adapter.start(first.value), h.adapter.start(second.value)]);
  assert.notEqual(a.ref.threadId, b.ref.threadId);
  h.child.notify('item/agentMessage/delta', {...a.ref, itemId: 'first-note', delta: 'First thread only.'});
  h.child.notify('thread/tokenUsage/updated', {...b.ref, tokenUsage: {total: {inputTokens: 7, outputTokens: 3, totalTokens: 10}}});
  const denied = await h.child.ask('item/tool/call', {...a.ref, callId: 'isolated', tool: 'gwi_run_read', arguments: {}});
  assert.equal(denied.result.success, false);
  assert.equal(first.events.some(event => event.usage), false);
  assert.equal(second.events.some(event => event.message === 'First thread only.'), false);
  h.child.complete(b.ref, {...OUTPUT, summary: 'Second result.'});
  h.child.complete(a.ref, {...OUTPUT, summary: 'First result.'});
  const [aResult, bResult] = await Promise.all([a.completion, b.completion]);
  assert.equal(aResult.output.summary, 'First result.');
  assert.equal(aResult.usage, undefined);
  assert.equal(bResult.output.summary, 'Second result.');
  assert.deepEqual(bResult.usage, {input: 7, output: 3, total: 10});
});

test('cancelling an outstanding control call returns failure and never accepts its late result', async t => {
  const h = harness(t);
  let resolveTool!: (value: unknown) => void;
  const run = input({onTool: () => new Promise(resolveResult => {resolveTool = resolveResult;})}, {tools: ['context.read']});
  const execution = await h.adapter.start(run.value);
  const response = h.child.ask('item/tool/call', {...execution.ref, callId: 'pending-call', tool: 'gwi_context_read', arguments: {}});
  await immediate();
  const ended = assert.rejects(execution.completion, /cancelled/);
  run.controller.abort();
  assert.equal((await response).result.success, false);
  await ended;
  resolveTool({late: 'must not be accepted'});
  await immediate();
  assert.equal(h.child.responses.length, 1);
  assert.equal(h.child.responses[0].result.success, false);
  assert.equal(h.child.kills.length, 0);
});

test('native approvals, permission grants and human input are denied with recorded reasons', async t => {
  const h = harness(t);
  const run = input();
  const execution = await h.adapter.start(run.value);
  const cases: [string, unknown][] = [
    ['item/commandExecution/requestApproval', {decision: 'decline'}],
    ['item/fileChange/requestApproval', {decision: 'decline'}],
    ['execCommandApproval', {decision: 'denied'}],
    ['applyPatchApproval', {decision: 'denied'}],
    ['item/permissions/requestApproval', {permissions: {}, scope: 'turn'}],
    ['mcpServer/elicitation/request', {action: 'decline'}],
    ['item/tool/requestUserInput', {answers: {}}],
  ];
  for (const [method, result] of cases) {
    const response = await h.child.ask(method, {...execution.ref, reason: 'Synthetic escalation request.'});
    assert.deepEqual(response.result, result);
  }
  for (const method of ['account/chatgptAuthTokens/refresh', 'unknown/server/request']) {
    const response = await h.child.ask(method, {});
    assert.equal(response.error.code, -32601);
    assert.equal(Object.hasOwn(response, 'result'), false);
  }
  assert.equal(run.events.filter(event => event.type === 'codex.request_denied').length, cases.length + 2);
  assert.ok(run.events.filter(event => event.type === 'codex.request_denied').every(event => event.message.includes('cannot authorize')));
  h.child.complete(execution.ref, {...OUTPUT, outcome: 'blocked'});
  await execution.completion;
});

test('steering uses the active turn precondition and interruption reaches the real protocol', async t => {
  const h = harness(t);
  const run = input();
  const execution = await h.adapter.start(run.value);
  await h.adapter.steer(execution.ref, 'Limit the check to the supplied artifact.');
  const steer = h.child.requests.find(message => message.method === 'turn/steer');
  assert.deepEqual(steer?.params, {threadId: execution.ref.threadId, expectedTurnId: execution.ref.turnId, input: [{type: 'text', text: 'Limit the check to the supplied artifact.'}]});
  await assert.rejects(h.adapter.steer({...execution.ref, turnId: 'wrong-turn'}, 'Text'), /not active/);
  const ended = assert.rejects(execution.completion, error => error instanceof Error && error.name === 'AbortError');
  await Promise.all([h.adapter.interrupt(execution.ref), h.adapter.interrupt(execution.ref)]);
  await ended;
  assert.equal(h.child.requests.filter(message => message.method === 'turn/interrupt').length, 1);
  assert.equal(run.events.some(event => event.type === 'codex.interrupted'), true);
  await assert.rejects(h.adapter.steer(execution.ref, 'Late input'), /not active/);
});

test('cancellation, time limits and reported token limits interrupt rather than fabricate completion', async t => {
  for (const mode of ['cancel', 'time', 'tokens'] as const) await t.test(mode, async sub => {
    const h = harness(sub);
    const run = input(mode === 'time' ? {timeoutSeconds: 0.02} : mode === 'tokens' ? {tokenBudget: 15} : {});
    const execution = await h.adapter.start(run.value);
    const ended = assert.rejects(execution.completion, mode === 'cancel' ? /cancelled/ : mode === 'time' ? /time limit/ : /token budget/);
    if (mode === 'cancel') run.controller.abort();
    if (mode === 'tokens') h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 10, outputTokens: 6, totalTokens: 16}}});
    await ended;
    assert.equal(h.child.requests.filter(message => message.method === 'turn/interrupt').length, 1);
    assert.equal(h.child.kills.length, 0);
  });
});

test('unconfirmed interruption stops the native process and is visible to the supervisor', async t => {
  const h = harness(t, message => message.method === 'turn/interrupt', {interruptGraceMs: 10, requestTimeoutMs: 100});
  const run = input();
  const execution = await h.adapter.start(run.value);
  const ended = assert.rejects(execution.completion, /interrupted by the supervisor/);
  await h.adapter.interrupt(execution.ref);
  await ended;
  assert.ok(h.child.kills.includes('SIGTERM'));
  assert.ok(run.events.some(event => event.type === 'codex.disconnected' && event.message.includes('did not confirm interruption')));
});

test('runtime output guard rejects invalid or misleading final results', async t => {
  const cases: unknown[] = [
    '```json\n{"outcome":"done"}\n```',
    {...OUTPUT, outcome: 'completed'},
    {...OUTPUT, summary: ''},
    {...OUTPUT, observations: [42]},
    {...OUTPUT, unexpected: true},
    {...OUTPUT, artifacts: [{label: 'Unsafe link', url: 'javascript:alert(1)'}]},
    {...OUTPUT, artifacts: [{label: 'Wrong field type', path: 4}]},
  ];
  for (const [index, output] of cases.entries()) await t.test(`invalid final ${index + 1}`, async sub => {
    const h = harness(sub);
    const execution = await h.adapter.start(input().value);
    h.child.complete(execution.ref, output);
    await assert.rejects(execution.completion, /final output/);
  });
});

test('commentary cannot substitute for final output, and native failed status is never accepted', async t => {
  for (const status of ['completed', 'failed']) await t.test(status, async sub => {
    const h = harness(sub);
    const execution = await h.adapter.start(input().value);
    h.child.notify('item/completed', {...execution.ref, item: {id: 'commentary', type: 'agentMessage', phase: 'commentary', text: JSON.stringify(OUTPUT)}});
    h.child.notify('turn/completed', {threadId: execution.ref.threadId, turn: {id: execution.ref.turnId, status, items: [], error: {message: 'Native synthetic failure.'}}});
    await assert.rejects(execution.completion, status === 'completed' ? /without a final/ : /Native synthetic failure/);
  });
});

test('events and terminal output arriving before turn/start response keep actual identifiers', async t => {
  const h = harness(t, (message, child) => {
    if (message.method !== 'turn/start') return;
    const ref = {threadId: message.params!.threadId, turnId: 'early-native-turn'};
    child.notify('turn/started', {threadId: ref.threadId, turn: {id: ref.turnId, status: 'inProgress'}});
    child.complete(ref);
    child.reply(message.id!, {turn: {id: ref.turnId, status: 'inProgress', items: []}});
    return true;
  });
  const execution = await h.adapter.start(input().value);
  assert.equal(execution.ref.turnId, 'early-native-turn');
  assert.deepEqual((await execution.completion).output, OUTPUT);
});

test('fragmented JSONL with Unicode and multiple messages is decoded without losing output', async t => {
  const h = harness(t);
  const execution = await h.adapter.start(input().value);
  const output = {...OUTPUT, summary: '已检查合成内容。'};
  const wire = Buffer.from(`${JSON.stringify({method: 'item/completed', params: {...execution.ref, item: {id: 'unicode-final', type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(output)}}})}\n${JSON.stringify({method: 'turn/completed', params: {threadId: execution.ref.threadId, turn: {id: execution.ref.turnId, status: 'completed', items: []}}})}\n`);
  for (let offset = 0; offset < wire.length; offset += 7) h.child.stdout.write(wire.subarray(offset, offset + 7));
  assert.deepEqual((await execution.completion).output, output);
});

test('process loss rejects running work and pending requests without accepting late results', async t => {
  const h = harness(t, message => message.method === 'turn/steer');
  const execution = await h.adapter.start(input().value);
  const completed = assert.rejects(execution.completion, /app-server exited/);
  const steering = assert.rejects(h.adapter.steer(execution.ref, 'Synthetic steering.'), /app-server exited/);
  h.child.emit('exit', 1, null);
  h.child.complete(execution.ref);
  await Promise.all([completed, steering]);
});

test('invalid JSON-RPC fails closed and a later connection can initialize independently', async t => {
  const first = new FakeProcess();
  const second = new FakeProcess();
  let launches = 0;
  const h = harness(t, undefined, {launch: () => (++launches === 1 ? first : second) as unknown as CodexProcess});
  const execution = await h.adapter.start(input().value);
  const ended = assert.rejects(execution.completion, /invalid JSON-RPC/);
  first.stdout.write('not-json\n');
  await ended;
  const info = await h.adapter.info();
  assert.equal(info.connected, true);
  assert.equal(launches, 2);
  assert.equal(second.requests[0].method, 'initialize');
});

test('unconfirmed turn startup is bounded and kills the connection instead of losing a native handle', async t => {
  const h = harness(t, message => message.method === 'turn/start', {requestTimeoutMs: 15});
  await assert.rejects(h.adapter.start(input().value), /request timed out/);
  assert.ok(h.child.kills.includes('SIGTERM'));
});

test('closing rejects active work and prevents adapter reuse', async t => {
  const h = harness(t);
  const execution = await h.adapter.start(input().value);
  const ended = assert.rejects(execution.completion, /adapter was closed/);
  await h.adapter.close();
  await ended;
  await assert.rejects(h.adapter.skills(WORKSPACE), /adapter is closed/);
  const info = await h.adapter.info();
  assert.equal(info.connected, false);
  assert.ok(h.child.kills.length > 0);
  await immediate();
});

function reportGoal(child: FakeProcess, ref: ExecutionRef, status: string, tokensUsed = 77) {
  child.notify('thread/goal/updated', {threadId: ref.threadId, turnId: ref.turnId, goal: {...child.nativeGoals.get(ref.threadId!), threadId: ref.threadId, status, tokensUsed, timeUsedSeconds: 3, updatedAt: 103}});
}

test('native goals drive their own turns and complete only from native goal state', async t => {
  const h = harness(t);
  const run = input({}, {tools: ['context.read']});
  const execution = await h.adapter.startGoal!({...run.value, objective: 'Complete the bounded synthetic objective.'});
  await immediate();
  const first = run.events.findLast(event => event.type === 'turn/started')!.ref!;
  assert.equal(h.child.requests.some(message => message.method === 'turn/start'), false);
  const thread = h.child.requests.find(message => message.method === 'thread/start')!.params!;
  assert.equal(thread.config.model_reasoning_effort, 'medium');
  assert.equal(thread.serviceTier, 'default');
  assert.equal(thread.config.sandbox_workspace_write.network_access, false);
  assert.match(thread.developerInstructions, /Check the supplied artifact/);
  assert.match(thread.developerInstructions, /single completed turn does not complete the goal/);
  let ended = false;
  void execution.completion.then(() => {ended = true;});
  h.child.notify('turn/completed', {threadId: first.threadId, turn: {id: first.turnId, status: 'completed', items: []}});
  await immediate();
  assert.equal(ended, false);
  const second = {...first, turnId: 'second-native-goal-turn'};
  h.child.notify('turn/started', {threadId: second.threadId, turn: {id: second.turnId, status: 'inProgress', items: []}});
  await assert.rejects(h.adapter.steer(first, 'Stale native turn.'), /not active/);
  await h.adapter.steer(second, 'Use the accepted evidence.');
  assert.equal(h.child.requests.findLast(message => message.method === 'turn/steer')?.params?.expectedTurnId, second.turnId);
  const tool = await h.child.ask('item/tool/call', {...second, callId: 'native-goal-control', tool: 'gwi_context_read', arguments: {}});
  assert.equal(tool.result.success, true);
  h.child.notify('item/completed', {...second, item: {type: 'agentMessage', id: 'goal-summary', phase: 'final_answer', text: 'The accepted synthetic evidence meets the objective.'}});
  reportGoal(h.child, second, 'complete');
  const result = await execution.completion;
  assert.equal(result.status, 'complete');
  assert.equal(result.summary, 'The accepted synthetic evidence meets the objective.');
  assert.equal(result.nativeGoal?.tokensUsed, 77);
  assert.equal(result.nativeGoal?.timeUsedSeconds, 3);
  assert.equal(result.nativeGoal?.status, 'complete');
  assert.equal(Object.hasOwn(result, 'usage'), false);
  assert.equal(h.child.nativeGoals.has(first.threadId!), false);
  assert.ok(run.events.some(event => event.type === 'codex.goal_cleanup'));
  const clearIndex = h.child.requests.findIndex(message => message.method === 'thread/goal/clear');
  const interruptIndex = h.child.requests.findIndex(message => message.method === 'turn/interrupt');
  assert.ok(clearIndex >= 0 && interruptIndex > clearIndex);
  assert.equal(h.child.requests.some(message => message.method === 'thread/goal/set' && message.params?.status === 'paused'), false);
});

test('native goal terminal statuses remain distinct from success and unavailable usage', async t => {
  for (const status of ['blocked', 'budgetLimited', 'usageLimited'] as const) await t.test(status, async sub => {
    const h = harness(sub), run = input();
    const execution = await h.adapter.startGoal!({...run.value, objective: 'A bounded synthetic native objective.'});
    await immediate();
    reportGoal(h.child, execution.ref, status, 12);
    const result = await execution.completion;
    assert.equal(result.status, status);
    assert.equal(result.nativeGoal?.status, status);
    assert.equal(result.nativeGoal?.tokensUsed, 12);
    assert.equal(result.usage, undefined);
  });
});

test('native goal cancellation, elapsed limits and reported token limits clear before interrupting', async t => {
  for (const mode of ['cancel', 'time', 'tokens', 'interrupt'] as const) await t.test(mode, async sub => {
    const h = harness(sub);
    const run = input(mode === 'time' ? {timeoutSeconds: 0.02} : mode === 'tokens' ? {tokenBudget: 15} : {});
    const execution = await h.adapter.startGoal!({...run.value, objective: 'Stop this synthetic native objective within its boundary.'});
    await immediate();
    if (mode === 'cancel') run.controller.abort();
    if (mode === 'interrupt') await h.adapter.interrupt({threadId: execution.ref.threadId});
    if (mode === 'tokens') {
      reportGoal(h.child, execution.ref, 'active', 16);
      h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 10, outputTokens: 6, totalTokens: 16}}});
    }
    const result = await execution.completion;
    assert.equal(result.status, 'cleared');
    assert.equal(result.nativeGoal?.status, 'active');
    assert.equal(h.child.nativeGoals.has(execution.ref.threadId!), false);
    const clearIndex = h.child.requests.findIndex(message => message.method === 'thread/goal/clear');
    const interruptIndex = h.child.requests.findIndex(message => message.method === 'turn/interrupt');
    assert.ok(clearIndex >= 0 && interruptIndex > clearIndex);
    if (mode === 'tokens') assert.deepEqual(result.usage, {input: 10, output: 6, total: 16});
  });
});

test('unsupported native goal APIs fail explicitly without falling back to a task turn', async t => {
  const h = harness(t, (message, child) => {
    if (message.method === 'thread/goal/set') {child.send({id: message.id!, error: {code: -32601, message: 'Unsupported native goal API.'}}); return true;}
  });
  await assert.rejects(h.adapter.startGoal!({...input().value, objective: 'A synthetic native objective.'}), /unsupported or failed/);
  assert.equal(h.child.requests.some(message => message.method === 'turn/start'), false);
  assert.equal(h.child.nativeGoals.size, 0);
});

test('native goal cleanup failures stop the process and reject instead of claiming completion', async t => {
  const h = harness(t, (message, child) => {
    if (message.method === 'thread/goal/clear') {child.send({id: message.id!, error: {code: -32601, message: 'Synthetic clear failure.'}}); return true;}
  });
  const run = input(), execution = await h.adapter.startGoal!({...run.value, objective: 'A synthetic objective with a cleanup failure.'});
  await immediate();
  const ended = assert.rejects(execution.completion, /cleanup failed/);
  reportGoal(h.child, execution.ref, 'complete');
  await ended;
  assert.ok(h.child.kills.includes('SIGTERM'));
  assert.ok(run.events.some(event => event.type === 'codex.goal_cleanup_failed'));
});

test('a delayed native turn after goal cleanup remains owned and is interrupted', async t => {
  const h = harness(t), run = input();
  const execution = await h.adapter.startGoal!({...run.value, objective: 'A synthetic objective with a late turn.'});
  await immediate();
  reportGoal(h.child, execution.ref, 'complete');
  await execution.completion;
  h.child.notify('turn/started', {threadId: execution.ref.threadId, turn: {id: 'late-native-turn', status: 'inProgress', items: []}});
  await immediate();
  assert.ok(h.child.requests.some(message => message.method === 'turn/interrupt' && message.params?.turnId === 'late-native-turn'));
  assert.equal(h.child.nativeGoals.has(execution.ref.threadId!), false);
});

test('native goal startup refuses an unconfirmed or weaker sandbox before activation', async t => {
  const h = harness(t, (message, child) => {
    if (message.method === 'thread/start') {child.reply(message.id!, {thread: {id: 'weaker-policy-thread'}, approvalPolicy: 'never', sandbox: {type: 'dangerFullAccess'}}); return true;}
  });
  await assert.rejects(h.adapter.startGoal!({...input().value, objective: 'An objective requiring its configured boundary.'}), /sandbox and approval policy/);
  assert.equal(h.child.requests.some(message => message.method === 'thread/goal/set'), false);
});

test('native goals receive the actual selected installed skill instructions without a fabricated input turn', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-goal-skill-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'SKILL.md');
  await writeFile(filename, 'Read the synthetic evidence before taking an action.');
  const h = harness(t, (message, child) => {
    if (message.method === 'skills/list') {child.reply(message.id!, {data: [{cwd: WORKSPACE, skills: [{...SKILL, path: filename}]}]}); return true;}
  });
  const run = input({}, {skills: [{name: SKILL.name, path: filename}]});
  const execution = await h.adapter.startGoal!({...run.value, objective: 'Use the selected synthetic skill.'});
  await immediate();
  const thread = h.child.requests.find(message => message.method === 'thread/start')!.params!;
  assert.match(thread.developerInstructions, /Selected installed skill \$synthetic-check/);
  assert.match(thread.developerInstructions, /Read the synthetic evidence before taking an action/);
  assert.equal(h.child.requests.some(message => message.method === 'turn/start'), false);
  reportGoal(h.child, execution.ref, 'blocked');
  await execution.completion;
});

test('native goal startup cancellation cannot leave an unconfirmed background goal', async t => {
  const h = harness(t, message => message.method === 'thread/goal/set', {requestTimeoutMs: 100, interruptGraceMs: 10});
  const run = input();
  const starting = h.adapter.startGoal!({...run.value, objective: 'A native objective cancelled during setup.'});
  const failed = assert.rejects(starting, /unsupported or failed/);
  await immediate();
  run.controller.abort();
  await failed;
  assert.ok(h.child.kills.includes('SIGTERM'));
  assert.equal(h.child.requests.some(message => message.method === 'turn/start'), false);
});

test('project bootstrap is exposed only when selected and forwards the proposal to its scoped callback', async t => {
  const h = harness(t);
  const calls: unknown[] = [];
  const run = input({onTool: async (tool, args) => {calls.push([tool, args]); return {recorded: true};}}, {tools: ['project.bootstrap']});
  const execution = await h.adapter.start(run.value);
  const thread = h.child.requests.find(message => message.method === 'thread/start')!.params!;
  assert.equal(thread.dynamicTools.length, 1);
  assert.equal(thread.dynamicTools[0].name, 'gwi_project_bootstrap');
  assert.deepEqual(thread.dynamicTools[0].inputSchema.required, ['proposal', 'sources']);
  const args = {proposal: {name: 'Synthetic project'}, sources: ['README.md']};
  const response = await h.child.ask('item/tool/call', {...execution.ref, callId: 'bootstrap-proposal', tool: 'gwi_project_bootstrap', arguments: args});
  assert.equal(response.result.success, true);
  assert.deepEqual(calls, [['project.bootstrap', args]]);
  h.child.complete(execution.ref);
  await execution.completion;
});

test('native goals stop after three distinct failed turns and preserve the latest error', async t => {
  const h = harness(t), run = input();
  const execution = await h.adapter.startGoal!({...run.value, objective: 'A synthetic objective subject to repeated rate limits.'});
  await immediate();
  const first = run.events.findLast(event => event.type === 'turn/started')!.ref!;
  for (let retry = 0; retry < 4; retry++) h.child.notify('error', {...first, error: {message: 'Synthetic within-turn 429 retry.'}, willRetry: true});
  assert.equal(run.events.some(event => event.type === 'codex.goal_circuit_open'), false);
  const failedTurn = (turnId: string, error: string) => h.child.notify('turn/completed', {threadId: execution.ref.threadId, turn: {id: turnId, status: 'failed', items: [], error: {message: error}}});
  failedTurn(first.turnId!, 'Synthetic first failed turn.');
  failedTurn(first.turnId!, 'Duplicate completion is not another turn.');
  failedTurn(first.turnId!, 'Another duplicate completion.');
  assert.equal(run.events.some(event => event.type === 'codex.goal_circuit_open'), false);
  h.child.notify('turn/started', {threadId: first.threadId, turn: {id: 'second-failed-turn', status: 'inProgress'}});
  failedTurn('second-failed-turn', 'Synthetic second failed turn.');
  await immediate();
  assert.equal(h.child.requests.some(message => message.method === 'thread/goal/clear'), false);
  h.child.notify('turn/started', {threadId: first.threadId, turn: {id: 'third-failed-turn', status: 'inProgress'}});
  failedTurn('third-failed-turn', 'Synthetic latest 429 failure synthetic-account@example.invalid sk-synthetic-circuit-token');
  h.child.notify('turn/started', {threadId: first.threadId, turn: {id: 'racing-auto-turn', status: 'inProgress'}});
  const result = await execution.completion;
  assert.equal(result.status, 'cleared');
  assert.match(result.summary, /3 consecutive failed turns/);
  assert.match(result.summary, /Synthetic latest 429 failure/);
  assert.doesNotMatch(result.summary, /synthetic-account|synthetic-circuit-token/);
  const circuits = run.events.filter(event => event.type === 'codex.goal_circuit_open');
  assert.equal(circuits.length, 1);
  assert.deepEqual((circuits[0].data as {consecutiveFailedTurns: number}).consecutiveFailedTurns, 3);
  const clear = h.child.requests.findIndex(message => message.method === 'thread/goal/clear');
  const interrupt = h.child.requests.findIndex(message => message.method === 'turn/interrupt' && message.params?.turnId === 'racing-auto-turn');
  assert.ok(clear >= 0 && interrupt > clear);
  assert.equal(h.child.nativeGoals.has(first.threadId!), false);
});

test('successful native turns reset the circuit and each owned goal counts failures independently', async t => {
  const h = harness(t), first = input(), second = input();
  const a = await h.adapter.startGoal!({...first.value, objective: 'The first synthetic objective.'});
  const b = await h.adapter.startGoal!({...second.value, objective: 'The second synthetic objective.'});
  await immediate();
  const aTurn = first.events.findLast(event => event.type === 'turn/started')!.ref!;
  const bTurn = second.events.findLast(event => event.type === 'turn/started')!.ref!;
  const end = (ref: ExecutionRef, status: 'failed' | 'completed') => h.child.notify('turn/completed', {threadId: ref.threadId, turn: {id: ref.turnId, status, items: [], error: status === 'failed' ? {message: 'Synthetic failed turn.'} : null}});
  end(aTurn, 'failed');
  end(bTurn, 'failed');
  const success = {...aTurn, turnId: 'successful-reset'};
  h.child.notify('turn/started', {threadId: success.threadId, turn: {id: success.turnId, status: 'inProgress'}});
  end(success, 'completed');
  for (const index of [1, 2]) {
    const ref = {...aTurn, turnId: `after-success-${index}`};
    h.child.notify('turn/started', {threadId: ref.threadId, turn: {id: ref.turnId, status: 'inProgress'}});
    end(ref, 'failed');
  }
  await immediate();
  assert.equal(first.events.some(event => event.type === 'codex.goal_circuit_open'), false);
  assert.equal(second.events.some(event => event.type === 'codex.goal_circuit_open'), false);
  const third = {...aTurn, turnId: 'after-success-3'};
  h.child.notify('turn/started', {threadId: third.threadId, turn: {id: third.turnId, status: 'inProgress'}});
  end(third, 'failed');
  assert.equal((await a.completion).status, 'cleared');
  assert.equal(h.child.nativeGoals.has(b.ref.threadId!), true);
  assert.equal(h.child.requests.some(message => message.method === 'thread/goal/clear' && message.params?.threadId === b.ref.threadId), false);
  reportGoal(h.child, b.ref, 'blocked');
  await b.completion;
});

test('version discovery and process launch use the same pinned binary selection', async t => {
  const previous = process.env.GWI_CODEX_BIN;
  t.after(() => {if (previous === undefined) delete process.env.GWI_CODEX_BIN; else process.env.GWI_CODEX_BIN = previous;});
  for (const selection of [
    {name: 'default', environment: undefined, option: undefined, expected: 'codex'},
    {name: 'private environment', environment: '/synthetic/environment codex', option: undefined, expected: '/synthetic/environment codex'},
    {name: 'explicit option', environment: '/synthetic/environment-codex', option: '/synthetic/option-codex', expected: '/synthetic/option-codex'},
  ]) await t.test(selection.name, async sub => {
    if (selection.environment === undefined) delete process.env.GWI_CODEX_BIN; else process.env.GWI_CODEX_BIN = selection.environment;
    const seen: {kind: string; binary: string}[] = [];
    const child = new FakeProcess();
    const h = harness(sub, undefined, {binary: selection.option, launch: binary => {seen.push({kind: 'launch', binary}); return child as unknown as CodexProcess;}, getVersion: async binary => {seen.push({kind: 'version', binary}); return '0.164.0-alpha.11.1';}});
    process.env.GWI_CODEX_BIN = '/synthetic/later-environment-change';
    const info = await h.adapter.info();
    assert.equal(info.version, '0.164.0-alpha.11.1');
    assert.deepEqual(seen, [{kind: 'version', binary: selection.expected}, {kind: 'launch', binary: selection.expected}]);
  });
});

test('task and goal events report effective native configuration and waiting notifications', async t => {
  for (const mode of ['task', 'goal'] as const) await t.test(mode, async sub => {
    const h = harness(sub), run = input();
    const execution = mode === 'task' ? await h.adapter.start(run.value) : await h.adapter.startGoal!({...run.value, objective: 'A synthetic observable native goal.'});
    await immediate();
    const configuration = run.events.find(event => event.type === 'codex.thread_configuration')!;
    assert.deepEqual(configuration.data, {model: 'native-effective-model', modelProvider: 'synthetic-provider', reasoningEffort: 'low', serviceTier: 'default'});
    assert.notEqual((configuration.data as {model: string}).model, run.role.model);
    const ref = run.events.findLast(event => event.ref?.turnId)?.ref ?? execution.ref;
    h.child.notify('thread/status/changed', {threadId: ref.threadId, status: {type: 'active', activeFlags: ['waitingOnUserInput']}});
    h.child.notify('mcpServer/startupStatus/updated', {threadId: ref.threadId, name: 'synthetic-mcp', status: 'failed', error: 'synthetic-account@example.invalid sk-synthetic-startup-key'});
    h.child.notify('mcpServer/startupStatus/updated', {name: 'synthetic-global-mcp', status: 'starting'});
    h.child.notify('model/verification', {...ref, verifications: [{url: 'https://example.invalid/?token=synthetic-private'}]});
    h.child.notify('model/safetyBuffering/updated', {...ref, model: 'native-effective-model', showBufferingUi: true});
    h.child.notify('model/rerouted', {...ref, fromModel: 'native-effective-model', toModel: 'another-native-model', reason: 'Synthetic routing.'});
    h.child.notify('hook/started', {...ref, run: {command: 'synthetic-private-command'}});
    assert.ok(run.events.some(event => event.type === 'thread/status/changed' && (event.data as {activeFlags: string[]}).activeFlags.includes('waitingOnUserInput')));
    assert.ok(run.events.some(event => event.type === 'mcpServer/startupStatus/updated' && (event.data as {scope: string}).scope === 'connection'));
    assert.ok(run.events.some(event => event.type === 'model/verification' && (event.data as {count: number}).count === 1));
    assert.ok(run.events.some(event => event.type === 'model/safetyBuffering/updated'));
    assert.ok(run.events.some(event => event.type === 'model/rerouted'));
    assert.doesNotMatch(JSON.stringify(run.events), /synthetic-account|synthetic-startup-key|synthetic-private/);
    if (mode === 'task') h.child.complete(execution.ref);
    else reportGoal(h.child, execution.ref, 'blocked');
    await execution.completion;
  });
});

test('task budgets exclude reported cached input while retaining every raw usage counter', async t => {
  const h = harness(t), run = input({tokenBudget: 15});
  const execution = await h.adapter.start(run.value);
  h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 1000, cachedInputTokens: 990, outputTokens: 4, totalTokens: 1004}}});
  await immediate();
  assert.equal(h.child.requests.some(message => message.method === 'turn/interrupt'), false);
  assert.deepEqual(run.events.findLast(event => event.usage)?.usage, {input: 1000, cachedInput: 990, output: 4, total: 1004});
  h.child.complete(execution.ref);
  const result = await execution.completion;
  assert.deepEqual(result.usage, {input: 1000, cachedInput: 990, output: 4, total: 1004});
});

test('task and goal budgets stop at the new-token boundary without rewriting native goal usage', async t => {
  for (const mode of ['task', 'goal'] as const) await t.test(mode, async sub => {
    const h = harness(sub), run = input({tokenBudget: 15});
    const execution = mode === 'task' ? await h.adapter.start(run.value) : await h.adapter.startGoal!({...run.value, objective: 'A synthetic cache-aware native goal.'});
    await immediate();
    h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 1000, cachedInputTokens: 990, outputTokens: 4, totalTokens: 1004}}});
    await immediate();
    assert.equal(h.child.requests.some(message => message.method === 'turn/interrupt' || message.method === 'thread/goal/clear'), false);
    let rejected: Promise<unknown> | undefined;
    if (mode === 'task') rejected = assert.rejects(execution.completion, /token budget/);
    h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 1500, cachedInputTokens: 1490, outputTokens: 5, totalTokens: 1505}}});
    if (mode === 'task') await rejected;
    else {
      const result = await execution.completion;
      assert.equal('status' in result && result.status, 'cleared');
      assert.equal('nativeGoal' in result && result.nativeGoal?.tokensUsed, 0);
      assert.deepEqual(result.usage, {input: 1500, cachedInput: 1490, output: 5, total: 1505});
      assert.equal(h.child.requests.find(message => message.method === 'thread/goal/set')?.params?.tokenBudget, 15);
    }
    assert.deepEqual(run.events.findLast(event => event.usage)?.usage, {input: 1500, cachedInput: 1490, output: 5, total: 1505});
    assert.equal(h.child.requests.some(message => message.method === 'turn/interrupt'), true);
  });
});

test('missing or invalid cache counters use the conservative raw budget', async t => {
  for (const cachedInputTokens of [undefined, -1, '990']) await t.test(String(cachedInputTokens), async sub => {
    const h = harness(sub), run = input({tokenBudget: 15});
    const execution = await h.adapter.start(run.value);
    const ended = assert.rejects(execution.completion, /token budget/);
    h.child.notify('thread/tokenUsage/updated', {...execution.ref, tokenUsage: {total: {inputTokens: 1000, ...(cachedInputTokens !== undefined ? {cachedInputTokens} : {}), outputTokens: 4, totalTokens: 1004}}});
    await ended;
    const usage = run.events.findLast(event => event.usage)!.usage!;
    assert.deepEqual(usage, {input: 1000, output: 4, total: 1004});
    assert.equal(Object.hasOwn(usage, 'cachedInput'), false);
  });
});

test('the local default model applies only when the role has no explicit model', async t=>{
  for(const mode of ['task','goal'] as const)await t.test(mode,async sub=>{
    const h=harness(sub,undefined,{defaultModel:'synthetic-local-default'}),inherited=input({},{model:null});
    const a=mode==='task'?await h.adapter.start(inherited.value):await h.adapter.startGoal!({...inherited.value,objective:'Use the local model setting.'});await immediate();
    assert.equal(h.child.requests.find(message=>message.method==='thread/start')?.params?.model,'synthetic-local-default');
    if(mode==='task')h.child.complete(a.ref);else reportGoal(h.child,a.ref,'blocked');await a.completion;
    const explicit=input({},{model:'synthetic-explicit-role'}),b=mode==='task'?await h.adapter.start(explicit.value):await h.adapter.startGoal!({...explicit.value,objective:'Keep the explicit selected model.'});await immediate();
    assert.equal(h.child.requests.findLast(message=>message.method==='thread/start')?.params?.model,'synthetic-explicit-role');
    if(mode==='task'){assert.equal(h.child.requests.findLast(message=>message.method==='turn/start')?.params?.model,'synthetic-explicit-role');h.child.complete(b.ref);}else reportGoal(h.child,b.ref,'blocked');await b.completion;
    assert.equal((explicit.events.find(event=>event.type==='codex.thread_configuration')?.data as {model:string}).model,'native-effective-model');
  });
});
