import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Actor, KnowledgeEntry, RoleProfile, TaskOutput} from '../src/contracts.ts';
import type {AgentExecutionInput, CodexAdapter} from '../src/adapters/types.ts';
import {MulticaClient} from '../src/adapters/multica.ts';
import type {MulticaAgent, MulticaIssue, MulticaProject, MulticaTask} from '../src/adapters/multica.ts';
import {ControlMcp} from '../src/control-mcp.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Platform} from '../src/platform.ts';
import {PlatformExecution} from '../src/platform-execution.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';

const OWNER: Actor = {name: 'Synthetic platform owner', kind: 'human'};
const WORKSPACE = 'synthetic-provider-workspace', PROVIDER_TOKEN = 'SYNTHETIC_PROVIDER_AUTH_VALUE';
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Synthetic provider result.', artifacts: [], observations: []};
const execute = promisify(execFile);
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};}
async function eventually(condition: () => boolean, label: string) {for (let index = 0; index < 300; index++) {if (condition()) return; await delay(10);} assert.fail(`Synthetic platform did not reach ${label}.`);}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-platform-test-')), workspace = path.join(directory, 'source'), stateDirectory = path.join(directory, 'state');
  await mkdir(workspace);
  await execute('git', ['-C', workspace, 'init', '--template=']);
  await writeFile(path.join(workspace, 'tracked.txt'), 'Committed synthetic workspace.\n');
  await execute('git', ['-C', workspace, 'add', '--', 'tracked.txt']);
  await execute('git', ['-C', workspace, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Create synthetic execution input']);
  const state = {
    agents: new Map<string, MulticaAgent>(), projects: new Map<string, MulticaProject>(), issues: new Map<string, MulticaIssue>(), tasks: new Map<string, MulticaTask[]>(),
    requests: [] as {method: string; path: string; body: Record<string, unknown>}[], issuePosts: 0, loseIssueResponse: false, failAgentCreation: false, taskListGate: undefined as Promise<void> | undefined,
    taskResult: (_issue: string): unknown => JSON.stringify(OUTPUT), taskStatus: 'completed', taskMessageError: false, taskListError: false, issuePutError: false, issueRejection: undefined as {code: string; status: number} | undefined,
  };
  const taskGate = deferred<void>();
  let controls: ControlMcp | undefined;
  const server = createServer((request, response) => {void (async () => {
    const url = new URL(request.url!, 'http://127.0.0.1');
    if (url.pathname === '/mcp/control') {assert.ok(controls); await controls.handle(request, response); return;}
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {};
    const method = request.method!, route = url.pathname; state.requests.push({method, path: route, body});
    const json = (value: unknown, status = 200) => {response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(value));};
    if (route !== '/healthz' && route !== '/api/config') assert.equal(request.headers.authorization, 'Bearer ' + PROVIDER_TOKEN);
    if (route === '/healthz') {json({status: 'ok'}); return;}
    if (route === '/api/config') {json({server_version: 'synthetic-test-version'}); return;}
    if (route === '/api/me') {json({id: 'synthetic-owner'}); return;}
    if (route === '/api/runtimes') {json([{id: 'synthetic-runtime', daemon_id: 'synthetic-daemon', workspace_id: WORKSPACE, name: 'Synthetic runtime', provider: 'codex', status: 'online', metadata: {private: 'SYNTHETIC_RUNTIME_METADATA'}}]); return;}
    if (route === '/api/skills' || route === `/api/workspaces/${WORKSPACE}/mcp-servers`) {json([]); return;}
    if (route === '/api/projects' && method === 'GET') {json({projects: [...state.projects.values()], total: state.projects.size}); return;}
    if (route === '/api/projects' && method === 'POST') {const value = {id: 'synthetic-project-' + (state.projects.size + 1), workspace_id: WORKSPACE, status: 'planned', ...body} as MulticaProject; state.projects.set(value.id, value); json(value); return;}
    if (route.startsWith('/api/projects/') && method === 'GET') {json(state.projects.get(route.split('/').at(-1)!)); return;}
    if (route === '/api/agents' && method === 'GET') {json([...state.agents.values()]); return;}
    if (route === '/api/agents' && method === 'POST') {if (state.failAgentCreation || [...state.agents.values()].some(agent => agent.name === body.name)) {json({code: 'AGENT_NAME_CONFLICT', error: 'An agent with this name already exists in the workspace.'}, 409); return;} const value = {id: 'synthetic-agent-' + (state.agents.size + 1), workspace_id: WORKSPACE, status: 'active', updated_at: String(state.requests.length), ...body} as MulticaAgent; state.agents.set(value.id, value); json(value); return;}
    const agentResource = route.match(/^\/api\/agents\/([^/]+)(?:\/(skills|mcp-servers|tasks))?$/);
    if (agentResource) {
      const agent = state.agents.get(agentResource[1])!;
      if (agentResource[2] === 'tasks') {json([...state.tasks.values()].flat().filter(task => task.agent_id === agentResource[1])); return;}
      if (agentResource[2] === 'mcp-servers') {json([]); return;}
      if (agentResource[2] === 'skills') {if (method === 'PUT') agent.skills = (body.skill_ids as string[]).map(id => ({id, name: id})); json(agent.skills ?? []); return;}
      if (method === 'PUT') {if (body.name && [...state.agents.values()].some(other => other.id !== agent.id && other.name === body.name)) {json({code: 'AGENT_NAME_CONFLICT', error: 'An agent with this name already exists in the workspace.'}, 409); return;} Object.assign(agent, body, {updated_at: String(state.requests.length)});} json(agent); return;
    }
    if (route === '/api/issues' && method === 'POST') {
      state.issuePosts++; if (state.issueRejection) {json({code: state.issueRejection.code, error: 'Synthetic assignment was rejected.'}, state.issueRejection.status); return;} const issue = {id: 'synthetic-issue-' + state.issuePosts, workspace_id: WORKSPACE, ...body} as MulticaIssue; state.issues.set(issue.id, issue);
      state.tasks.set(issue.id, [{id: 'synthetic-task-' + state.issuePosts, workspace_id: WORKSPACE, issue_id: issue.id, agent_id: String(body.assignee_id), runtime_id: 'synthetic-runtime', status: state.taskStatus, started_at: new Date().toISOString(), result: state.taskResult(issue.id), usage: [{model: 'synthetic-model', input_tokens: 100, cache_read_tokens: 300, cache_write_tokens: 20, output_tokens: 20}]}]);
      if (state.loseIssueResponse) {response.destroy(); return;} json(issue); return;
    }
    const issue = route.match(/^\/api\/issues\/([^/]+)$/);
    if (issue) {const value = state.issues.get(issue[1]); if (!value) {json({code: 'NOT_FOUND', error: 'Synthetic issue not found.'}, 404); return;} if (method === 'PUT') {if (state.issuePutError) {json({code: 'SYNTHETIC_METADATA_FAILURE', error: 'Synthetic issue metadata unavailable.'}, 503); return;} Object.assign(value, body);} json(value); return;}
    const tasks = route.match(/^\/api\/issues\/([^/]+)\/task-runs$/); if (tasks) {if (state.taskListError) {json({code: 'SYNTHETIC_TRANSPORT_FAILURE', error: 'Synthetic task list unavailable.'}, 503); return;} await state.taskListGate; json(state.tasks.get(tasks[1]) ?? []); return;}
    if (/^\/api\/tasks\/[^/]+\/messages$/.test(route)) {if (state.taskMessageError) {json({code: 'SYNTHETIC_TRANSPORT_FAILURE', error: 'Synthetic task observation unavailable.'}, 503); return;} json([]); return;}
    json({error: 'Unhandled synthetic route: ' + method + ' ' + route}, 404);
  })().catch(error => {if (!response.headersSent) response.writeHead(error instanceof AppError ? error.status : 500, {'content-type': 'application/json'}); response.end(JSON.stringify({error: {code: error instanceof AppError ? error.code : 'SYNTHETIC_SERVER_FAILURE', message: String(error)}}));});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const connection = {baseUrl: `http://127.0.0.1:${address.port}`, token: PROVIDER_TOKEN, workspaceId: WORKSPACE}; controls = new ControlMcp(connection.baseUrl);
  const codex: CodexAdapter = {async info() {return {available: true, connected: true, authenticated: true, models: [{id: 'synthetic-model', name: 'Synthetic model', efforts: ['low']}]};}, async skills() {return [];}, async start() {throw new Error('A real native model must never run in this test.');}, async steer() {}, async interrupt() {}, async close() {}};
  const engine = new Engine(new Store(stateDirectory), codex, {async info() {return {available: true, authenticated: true};}, async observe() {return {status: 'completed', summary: 'Synthetic CI.'};}, async dispatch() {return {status: 'completed', summary: 'Synthetic CI.'};}});
  const rootsFile = path.join(directory, 'synthetic-runtime-roots.json'); await writeFile(rootsFile, '{"roots":[]}\n');
  const client = new MulticaClient(connection), platform = new Platform(engine, connection, stateDirectory, 'synthetic-model', {runtimeId: 'synthetic-runtime', daemonId: 'synthetic-daemon', permissionEvidence: 'Synthetic permission fixture.', verified: true, permissions: {readOnly: {name: 'gwi-readonly', verified: true}, workspaceWrite: {name: 'gwi-workspace', verified: true}}, authorizedRootsFile: rootsFile}, client);
  const execution = new PlatformExecution(platform, controls), project = await engine.createProject({name: 'Synthetic platform project', workspace}, OWNER);
  const input = (extra: Partial<AgentExecutionInput> = {}): AgentExecutionInput => ({project: structuredClone(project), workspace, role: {...project.roles.find(role => role.id === 'development')!, model: 'synthetic-model', tools: ['context.read']}, runId: 'synthetic-run', stageId: 'work', attemptId: 'synthetic-attempt', prompt: 'Perform only the synthetic check.', timeoutSeconds: 5, tokenBudget: 1000, signal: new AbortController().signal, onEvent() {}, onTool: async () => ({projectId: project.id}), ...extra});
  t.after(async () => {taskGate.resolve(); state.taskListGate = undefined; await execution.close(); await engine.close(); controls!.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, {recursive: true, force: true});});
  return {directory, state, connection, controls, client, engine, platform, execution, project, input, taskGate};
}

test('permission profile names alone never authorize execution without verified effective protections', async t => {
  const h = await fixture(t);
  const unverified = new Platform(h.engine, h.connection, h.platform.dataDirectory, 'synthetic-model', {runtimeId: 'synthetic-runtime', daemonId: 'synthetic-daemon', permissionEvidence: 'A name list is not permission verification.', permissionProfiles: ['gwi-readonly', 'gwi-workspace'], authorizedRootsFile: path.join(h.directory, 'synthetic-runtime-roots.json')}, h.client);
  const execution = new PlatformExecution(unverified);
  await assert.rejects(execution.agent.start(h.input()), code('RUNTIME_VERIFICATION_REQUIRED'));
  assert.equal(h.state.issuePosts, 0); assert.equal(h.state.agents.size, 0);
});

test('binding a shared agent copies it, project edits are scoped and browser representations omit native credentials', async t => {
  const h = await fixture(t);
  const shared: MulticaAgent = {id: 'synthetic-shared-agent', workspace_id: WORKSPACE, name: 'Shared template', runtime_id: 'synthetic-runtime', status: 'active', instructions: 'Shared template instructions.', model: 'synthetic-model', updated_at: '1', mcp_config: {mcpServers: {synthetic: {headers: {Authorization: 'SYNTHETIC_PRIVATE_MCP_AUTH'}}}}, runtime_config: {env: {SYNTHETIC_SECRET: 'SYNTHETIC_PRIVATE_RUNTIME_AUTH'}}, custom_args: ['SYNTHETIC_PRIVATE_ARGUMENT']};
  h.state.agents.set(shared.id, structuredClone(shared));
  const role: RoleProfile = {...h.project.roles.find(role => role.id === 'development')!, instructions: 'Frozen project responsibility.', multica: {agentId: shared.id, runtimeId: shared.runtime_id}};
  const bound = await h.platform.agent(h.project, role, false); assert.notEqual(bound.id, shared.id); assert.deepEqual(h.state.agents.get(shared.id), shared); assert.match(bound.instructions!, /Frozen project responsibility/);
  const other = await h.engine.createProject({name: 'Another synthetic project', workspace: h.project.workspace}, OWNER), foreign = await h.platform.agent(other, {...role, multica: undefined}, false);
  await assert.rejects(h.platform.saveAgent(h.project.id, {instructions: 'Unrelated edit.'}, OWNER, shared.id), code('AGENT_PROJECT_SCOPE'));
  await assert.rejects(h.platform.saveAgent(h.project.id, {instructions: 'Cross-project edit.'}, OWNER, foreign.id), code('AGENT_PROJECT_SCOPE'));
  await assert.rejects(h.platform.setAgentSkills(h.project.id, foreign.id, {skillIds: []}, OWNER), code('AGENT_PROJECT_SCOPE'));
  const visible = JSON.stringify(await h.platform.team(h.project.id, OWNER));
  for (const secret of [PROVIDER_TOKEN, 'SYNTHETIC_PRIVATE_MCP_AUTH', 'SYNTHETIC_PRIVATE_RUNTIME_AUTH', 'SYNTHETIC_PRIVATE_ARGUMENT', 'SYNTHETIC_RUNTIME_METADATA']) assert.equal(visible.includes(secret), false);
  assert.equal(h.state.requests.some(request => request.method === 'PUT' && request.path === '/api/agents/' + shared.id), false);
});

test('role revisions preserve the remote agent used by an earlier frozen project basis', async t => {
  const h = await fixture(t), role = {...h.project.roles.find(role => role.id === 'development')!, model: 'synthetic-model'};
  const first = await h.platform.agent(h.project, role, false), original = structuredClone(first);
  await assert.rejects(h.platform.saveAgent(h.project.id, {instructions: 'Changed live agent instructions.'}, OWNER, first.id), code('ROLE_REVISION_IMMUTABLE'));
  await assert.rejects(h.platform.setAgentSkills(h.project.id, first.id, {skillIds: []}, OWNER), code('ROLE_REVISION_IMMUTABLE'));
  await assert.rejects(h.platform.setAgentMcp(h.project.id, first.id, 'synthetic-server', 'add', true, OWNER), code('ROLE_REVISION_IMMUTABLE'));
  const frozen = await h.platform.agent(structuredClone(h.project), structuredClone(role), false);
  assert.equal(frozen.instructions, original.instructions, 'An existing role hash must not execute a mutable edited agent configuration.');
  const updated = await h.platform.saveRole(h.project.id, h.project.revision, {...role, instructions: 'A deliberately revised project responsibility.'}, OWNER, role.id);
  const revisedRole = updated.roles.find(value => value.id === role.id)!, revised = await h.platform.agent(updated, revisedRole, false);
  assert.notEqual(revised.id, frozen.id); assert.notEqual(revised.name, frozen.name); assert.equal(new Set([...h.state.agents.values()].map(agent => agent.name)).size, h.state.agents.size); assert.match(revised.instructions!, /deliberately revised/); assert.equal((await h.platform.agent(h.project, role, false)).instructions, original.instructions);
});

test('pre-assignment metadata failures recover without invented output, usage or execution references', async t => {
  for (const history of ['recorded', 'legacy-without-record'] as const) await t.test(history, async sub => {
    const h = await fixture(sub); h.state.failAgentCreation = true;
    h.state.taskResult = () => JSON.stringify({action: 'stop', rationale: 'The synthetic preparation recovery is verified.', expectedGain: 'No additional work.', tasks: []});
    h.engine.goalPlanner = h.execution.planner; h.engine.agentExecutor = h.execution.agent;
    const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Verify synthetic startup recovery.', idempotencyKey: 'synthetic-startup-recovery'}, OWNER), current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
    await eventually(() => current().status === 'failed', 'the metadata preparation failure');
    const before = structuredClone(h.engine.run(item.routerRunId)), attempt = before.stages[0].attempts[0];
    assert.match(attempt.error!, /name already exists/); assert.equal(attempt.ref, undefined); assert.equal(attempt.output, undefined); assert.equal(attempt.usage, undefined); assert.equal(h.state.issuePosts, 0);
    if (history === 'legacy-without-record') {
      for (const record of h.execution.records(item.routerRunId)) h.engine.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('multica-execution', record.id);
      assert.equal(h.execution.records(item.routerRunId).length, 0); assert.equal(current().canRetry, false);
      const reconciled = await h.execution.reconcile(item.routerRunId, 'supervise'); assert.equal(reconciled.status, 'not_dispatched'); assert.equal(reconciled.cleanupConfirmed, true);
    }
    const records = h.execution.records(item.routerRunId); assert.equal(records.length, 1); assert.equal(records[0].status, 'not_dispatched'); assert.equal(records[0].cleanupConfirmed, true); assert.equal(records[0].stageId, 'decision-1'); assert.equal(records[0].issueId, undefined); assert.equal(records[0].taskId, undefined);
    if (history === 'recorded') {
      for (const patch of [{projectId: 'another-synthetic-project'}, {runId: 'another-synthetic-run'}, {stageId: 'decision-2'}, {issueId: 'unconfirmed-synthetic-issue'}, {taskId: 'unconfirmed-synthetic-task'}, {status: 'unknown'}, {cleanupConfirmed: false}]) {h.engine.store.put('multica-execution', {...records[0], ...patch}); assert.equal(current().canRetry, false, 'Preparation recovery requires one exact owned decision without an assignment reference.');}
      h.engine.store.put('multica-execution', records[0]);
      const referenced = structuredClone(before); referenced.stages[0].attempts[0].ref = {provider: 'multica', issueId: 'unconfirmed-synthetic-issue'}; h.engine.store.put('run', referenced); assert.equal(current().canRetry, false); h.engine.store.put('run', before);
    }
    assert.equal(current().canRetry, true); h.state.failAgentCreation = false;
    await intake.retry(item.id, {model: 'synthetic-model', note: 'The metadata preparation problem is repaired; no assignment had been posted.'}, OWNER);
    await eventually(() => current().status === 'stopped', 'the safely recovered startup');
    assert.equal(h.state.issuePosts, 1); assert.deepEqual(h.engine.run(item.routerRunId), before);
  });
});

test('a lost issue POST is reconciled only by one exact existing task without dispatching again', async t => {
  const h = await fixture(t); h.state.loseIssueResponse = true;
  h.engine.goalPlanner = h.execution.planner; h.engine.agentExecutor = h.execution.agent;
  const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Preserve the uncertain synthetic assignment.', idempotencyKey: 'synthetic-unknown-assignment'}, OWNER), current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
  await eventually(() => current().status === 'failed', 'the lost assignment response');
  const record = h.execution.records(item.routerRunId)[0]; assert.equal(record.status, 'unknown'); assert.equal(record.cleanupConfirmed, false); assert.equal(record.issueId, undefined); assert.equal(record.taskId, undefined); assert.equal(h.state.issuePosts, 1); assert.equal(current().canRetry, false);
  const task = [...h.state.tasks.values()][0][0]; h.state.tasks.set('synthetic-orphan-bucket', [{...task, id: 'synthetic-orphan-task', issue_id: ''}]);
  const before = structuredClone(h.engine.run(item.routerRunId)), reconciled = await h.execution.reconcile(item.routerRunId, 'supervise');
  assert.equal(reconciled.issueId, task.issue_id); assert.equal(reconciled.taskId, task.id); assert.equal(reconciled.cleanupConfirmed, true); assert.equal(current().canRetry, true);
  const saved = h.engine.run(item.routerRunId), attempt = saved.stages[0].attempts[0]; assert.equal(saved.status, before.status); assert.equal(attempt.output, undefined); assert.equal(attempt.error, before.stages[0].attempts[0].error);
  assert.deepEqual(attempt.ref, {provider: 'multica', issueId: task.issue_id, externalId: task.id, agentId: task.agent_id, runtimeId: task.runtime_id}); assert.deepEqual(attempt.usage, {input: 420, cachedInput: 300, output: 20, total: 440});
  assert.equal(h.state.requests.some(request => request.path === '/api/agents/' + task.agent_id + '/tasks'), true); assert.equal(current().supervisorRunIds?.length, 1); assert.equal(h.state.issuePosts, 1);
});

test('zero, unrelated and ambiguous discovery candidates preserve unknown assignment audit without another POST', async t => {
  for (const mode of ['zero', 'wrong-marker', 'wrong-project', 'multiple'] as const) await t.test(mode, async sub => {
    const h = await fixture(sub); h.state.loseIssueResponse = true; h.engine.goalPlanner = h.execution.planner; h.engine.agentExecutor = h.execution.agent;
    const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Do not guess a synthetic assignment identity.', idempotencyKey: 'synthetic-unknown-discovery'}, OWNER), current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
    await eventually(() => current().status === 'failed', 'the unknown discovery input');
    const record = h.execution.records(item.routerRunId)[0], issue = [...h.state.issues.values()][0], task = h.state.tasks.get(issue.id)![0];
    if (mode === 'zero') {h.state.tasks.clear(); delete record.rejection; h.engine.store.put('multica-execution', record);}
    if (mode === 'wrong-marker') issue.description = issue.description!.replace('GWI execution identity: ' + record.id, 'GWI execution identity: another-synthetic-attempt');
    if (mode === 'wrong-project') issue.project_id = 'another-synthetic-provider-project';
    if (mode === 'multiple') {const second = {...issue, id: 'synthetic-ambiguous-issue'}; h.state.issues.set(second.id, second); h.state.tasks.set(second.id, [{...task, id: 'synthetic-ambiguous-task', issue_id: second.id}]);}
    await assert.rejects(h.execution.reconcile(item.routerRunId, 'supervise'), code('EXTERNAL_CREATION_UNCERTAIN'));
    await assert.rejects(intake.retry(item.id, {model: 'synthetic-model', note: 'No unique exact assignment was found.'}, OWNER), code('RECOVERY_NOT_READY'));
    const after = h.execution.records(item.routerRunId)[0]; assert.equal(after.status, 'unknown'); assert.equal(after.cleanupConfirmed, false); assert.equal(after.issueId, undefined); assert.equal(after.taskId, undefined); assert.equal(h.engine.run(item.routerRunId).stages[0].attempts[0].ref, undefined); assert.equal(h.state.issuePosts, 1);
    if (mode === 'zero') assert.equal(after.rejection, undefined, 'An old missing receipt must not be invented as a known rejection.');
  });
});

test('only an explicit active duplicate rejection is recorded as not dispatched', async t => {
  for (const rejection of ['active_duplicate_issue', 'another_conflict'] as const) await t.test(rejection, async sub => {
    const h = await fixture(sub); h.state.issueRejection = {code: rejection, status: 409}; h.engine.goalPlanner = h.execution.planner; h.engine.agentExecutor = h.execution.agent;
    const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Retain the exact synthetic rejection receipt.', idempotencyKey: 'synthetic-duplicate-rejection'}, OWNER), current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
    await eventually(() => current().status === 'failed', 'the provider rejection receipt');
    const record = h.execution.records(item.routerRunId)[0], safe = rejection === 'active_duplicate_issue'; assert.deepEqual(record.rejection, {code: rejection, status: 409}); assert.equal(record.status, safe ? 'not_dispatched' : 'unknown'); assert.equal(record.cleanupConfirmed, safe); assert.equal(current().canRetry, safe); assert.equal(record.issueId, undefined); assert.equal(record.taskId, undefined);
    const attempt = h.engine.run(item.routerRunId).stages[0].attempts[0]; assert.equal(attempt.ref, undefined); assert.equal(attempt.output, undefined); assert.equal(attempt.usage, undefined); assert.equal(h.state.issuePosts, 1); assert.equal(h.state.tasks.size, 0);
  });
});

test('an unknown assignment response is durable and cannot trigger a second issue POST for the same owned stage', async t => {
  const h = await fixture(t); h.state.loseIssueResponse = true;
  await assert.rejects(h.execution.agent.start(h.input()), /Could not reach Multica/);
  const record = h.execution.records('synthetic-run')[0]; assert.equal(record.status, 'unknown'); assert.equal(record.cleanupConfirmed, false); assert.equal(h.state.issuePosts, 1);
  await assert.rejects(h.execution.agent.start(h.input({attemptId: 'synthetic-retry-attempt'})), code('EXTERNAL_RECONCILIATION_REQUIRED'));
  assert.equal(h.state.issuePosts, 1);
});

test('each explicit attempt uses a unique issue title and the provider duplicate override', async t => {
  const h = await fixture(t);
  for (const attemptId of ['11111111-synthetic-attempt', '22222222-synthetic-attempt']) {const started = await h.execution.agent.start(h.input({attemptId})); assert.deepEqual((await started.completion).output, OUTPUT);}
  const posts = h.state.requests.filter(request => request.method === 'POST' && request.path === '/api/issues');
  assert.equal(posts.length, 2); assert.equal(new Set(posts.map(request => request.body.title)).size, 2);
  for (const [index, post] of posts.entries()) {const id = index ? '22222222-synthetic-attempt' : '11111111-synthetic-attempt'; assert.equal(post.body.allow_duplicate, true); assert.ok(String(post.body.title).includes(id.slice(0, 8))); assert.ok(String(post.body.description).includes('\nGWI execution identity: ' + id + '\n'));}
  assert.ok(h.execution.records('synthetic-run').every(record => record.cleanupConfirmed && record.issueState === 'done'));
});

test('confirmed provider task results synchronize only their validated issue disposition', async t => {
  for (const mode of ['done', 'no_change', 'blocked', 'revise', 'invalid-json', 'failed', 'cancelled'] as const) await t.test(mode, async sub => {
    const h = await fixture(sub), expected = mode === 'done' || mode === 'no_change' ? 'done' : 'cancelled';
    h.state.taskStatus = mode === 'failed' || mode === 'cancelled' ? mode : 'completed';
    h.state.taskResult = () => mode === 'invalid-json' ? 'This is not the required final JSON.' : JSON.stringify({...OUTPUT, outcome: ['done', 'no_change', 'blocked', 'revise'].includes(mode) ? mode : 'done'});
    const started = await h.execution.agent.start(h.input());
    if (mode === 'invalid-json' || mode === 'failed' || mode === 'cancelled') await assert.rejects(started.completion, error => error instanceof AppError);
    else assert.equal((await started.completion).output.outcome, mode);
    const record = h.execution.records('synthetic-run')[0]; assert.equal(record.cleanupConfirmed, true); assert.equal(record.issueState, expected); assert.equal(h.state.issues.get(record.issueId!)?.status, expected); assert.equal(record.issueSyncError, undefined);
    const puts = h.state.requests.filter(request => request.method === 'PUT' && request.path === '/api/issues/' + record.issueId); assert.equal(puts.length, 1); assert.equal(puts[0].body.status, expected); assert.equal(h.state.issuePosts, 1);
  });
});

test('issue metadata failures preserve execution results and reconciliation retries the recorded desired state only', async t => {
  for (const mode of ['done', 'invalid-json', 'failed'] as const) await t.test(mode, async sub => {
    const h = await fixture(sub); h.state.issuePutError = true; h.state.taskStatus = mode === 'failed' ? 'failed' : 'completed'; h.state.taskResult = () => mode === 'invalid-json' ? 'Invalid final JSON.' : JSON.stringify(OUTPUT); h.engine.agentExecutor = h.execution.agent;
    const draft = h.engine.createPipeline({projectId: h.project.id, roleId: 'development', name: 'Synthetic issue metadata recovery'}, OWNER), flow = h.engine.updatePipeline(draft.id, draft.revision, {...draft, stages: [{id: 'work', name: 'One bounded synthetic action', executor: 'codex', roleId: 'development', prompt: 'Return only the synthetic evidence.', review: false, dependsOn: []}]}, OWNER);
    const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Keep execution outcome separate from issue metadata.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-issue-metadata'}, OWNER), desired = mode === 'done' ? 'done' : 'cancelled';
    await eventually(() => h.engine.run(run.id).status === (mode === 'done' ? 'completed' : 'failed'), 'the authoritative execution outcome despite metadata failure');
    const before = structuredClone(h.engine.run(run.id)), record = h.execution.records(run.id)[0]; assert.equal(record.cleanupConfirmed, true); assert.ok(record.issueSyncError); assert.equal(record.issueDesiredState, desired); assert.equal(record.issueState, undefined); assert.equal(h.state.issues.get(record.issueId!)?.status, 'todo');
    assert.equal(h.engine.store.events({runId: run.id}).some(event => event.type.endsWith('multica.issue_sync_pending')), true); assert.deepEqual(before.stages[0].attempts[0].usage, {input: 420, cachedInput: 300, output: 20, total: 440}); assert.equal(h.state.issuePosts, 1);
    h.state.issuePutError = false; const reconciled = await h.execution.reconcile(run.id, 'work'); assert.equal(reconciled.issueState, desired); assert.equal(reconciled.issueSyncError, undefined); assert.equal(h.state.issues.get(record.issueId!)?.status, desired);
    const after = h.engine.run(run.id); assert.equal(after.status, before.status); assert.deepEqual(after.snapshot, before.snapshot); assert.deepEqual(after.stages, before.stages); assert.equal(h.state.issuePosts, 1); assert.equal(h.state.tasks.size, 1);
  });
});

test('reconciliation repairs historical and current issue metadata without overwriting their separate dispositions', async t => {
  for (const latest of ['completed', 'active_duplicate_issue'] as const) await t.test(latest, async sub => {
    const h = await fixture(sub); h.state.issuePutError = true; h.state.taskStatus = 'failed'; h.engine.agentExecutor = h.execution.agent;
    const draft = h.engine.createPipeline({projectId: h.project.id, roleId: 'development', name: 'Synthetic historical metadata'}, OWNER), flow = h.engine.updatePipeline(draft.id, draft.revision, {...draft, stages: [{id: 'work', name: 'Keep separate attempt dispositions', executor: 'codex', roleId: 'development', prompt: 'Return actual synthetic evidence.', review: false, dependsOn: []}]}, OWNER);
    const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Retain both synthetic attempt histories.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-history-sync'}, OWNER);
    await eventually(() => h.engine.run(run.id).status === 'failed', 'the confirmed failed first attempt'); const old = h.execution.records(run.id)[0]; assert.equal(old.issueDesiredState, 'cancelled'); assert.ok(old.issueSyncError);
    h.state.taskStatus = 'completed'; if (latest === 'active_duplicate_issue') h.state.issueRejection = {code: latest, status: 409}; h.engine.retry(run.id, 'work', 'The earlier worker ended; retry only its failed action.', OWNER);
    await eventually(() => h.engine.run(run.id).status === (latest === 'completed' ? 'completed' : 'failed'), 'the explicit retry outcome'); const before = structuredClone(h.engine.run(run.id)), records = h.execution.records(run.id); assert.equal(records.length, 2);
    if (latest === 'completed') {assert.equal(records[1].issueDesiredState, 'done'); assert.ok(records[1].issueSyncError);} else {assert.equal(records[1].status, 'not_dispatched'); assert.equal(records[1].cleanupConfirmed, true);}
    h.state.issuePutError = false; await h.execution.reconcile(run.id, 'work');
    const after = h.execution.records(run.id); assert.deepEqual(after.map(record => record.issueState), ['cancelled', latest === 'completed' ? 'done' : undefined]); assert.ok(after.every(record => record.issueSyncError === undefined)); assert.equal(h.state.issues.get(old.issueId!)?.status, 'cancelled'); if (latest === 'completed') assert.equal(h.state.issues.get(after[1].issueId!)?.status, 'done'); assert.deepEqual(h.engine.run(run.id).stages, before.stages); assert.equal(h.state.issuePosts, 2); assert.equal(h.state.tasks.size, latest === 'completed' ? 2 : 1);
  });
});

test('read-only reconciliation rejects mismatched task identity and never dispatches a replacement operation', async t => {
  const h = await fixture(t); h.state.taskMessageError = true;
  h.engine.agentExecutor = h.execution.agent;
  const initial = h.engine.createPipeline({projectId: h.project.id, roleId: 'development', name: 'Synthetic scoped observation'}, OWNER), flow = h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [{id: 'work', name: 'Observe a synthetic provider result', executor: 'codex', roleId: 'development', prompt: 'Perform only the synthetic check.', review: false, dependsOn: []}]}, OWNER);
  const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Preserve scoped synthetic execution facts.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-scoped-observation'}, OWNER);
  await eventually(() => h.engine.run(run.id).status === 'failed', 'the scoped task observation failure');
  assert.deepEqual(h.engine.run(run.id).stages[0].attempts[0].usage, {input: 420, output: 20, cachedInput: 300, total: 440}, 'Known task usage survives failure to read optional message details.');
  const before = h.execution.records(run.id)[0], original = structuredClone(h.state.tasks.get(before.issueId!)![0]);
  assert.equal(before.cleanupConfirmed, false); assert.equal(before.taskId, original.id);
  for (const mismatch of [{issue_id: 'another-synthetic-issue'}, {agent_id: 'another-synthetic-agent'}, {runtime_id: 'another-synthetic-runtime'}]) {
    h.state.tasks.set(before.issueId!, [{...original, ...mismatch}]);
    await assert.rejects(h.execution.reconcile(run.id, 'work'), error => error instanceof AppError);
    assert.equal(h.execution.records(run.id)[0].cleanupConfirmed, false);
  }
  h.state.tasks.set(before.issueId!, [original]); const reconciled = await h.execution.reconcile(run.id, 'work');
  assert.equal(reconciled.cleanupConfirmed, true); assert.equal(reconciled.taskId, original.id); assert.equal(h.state.issuePosts, 1);
});

test('a completed row without terminal result or verified idle daemon cannot authorize another task', async t => {
  const h = await fixture(t); h.state.taskResult = () => null;
  const started = await h.execution.agent.start(h.input()); await assert.rejects(started.completion, error => error instanceof AppError);
  assert.equal(h.execution.records('synthetic-run')[0].cleanupConfirmed, false);
  assert.equal(h.state.requests.some(request => request.method === 'PUT' && request.path.startsWith('/api/issues/')), false);
  await assert.rejects(h.execution.agent.start(h.input({attemptId: 'synthetic-null-result-retry'})), code('EXTERNAL_RECONCILIATION_REQUIRED'));
  assert.equal(h.state.issuePosts, 1);
});

test('reconciled issue-only planner usage remains in the cumulative allowance for explicit recovery', async t => {
  const h = await fixture(t); h.state.taskListError = true;
  h.state.taskResult = () => JSON.stringify({action: 'stop', rationale: 'The synthetic check should stop here.', expectedGain: 'No further useful work.', tasks: []});
  const allowances: number[] = [];
  h.engine.goalPlanner = {start(input) {allowances.push(input.remaining.tokens); return h.execution.planner.start(input);}}; h.engine.agentExecutor = h.execution.agent;
  const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Check the synthetic reconciliation boundary.', idempotencyKey: 'synthetic-reconcile-usage', policy: {maxTotalTokens: 10000, maxElapsedSeconds: 300}}, OWNER);
  const current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
  await eventually(() => current().status === 'failed', 'the unknown initial task observation');
  const first = h.engine.run(item.routerRunId).stages[0].attempts[0]; assert.ok(first.ref?.issueId); assert.equal(first.ref?.externalId, undefined); assert.equal(first.output, undefined); assert.equal(current().canRetry, false);
  h.state.taskListError = false; await h.execution.reconcile(item.routerRunId, 'decision-1');
  assert.equal(current().canRetry, true); assert.deepEqual(h.engine.run(item.routerRunId).stages[0].attempts[0].usage, {input: 420, output: 20, cachedInput: 300, total: 440});
  await intake.retry(item.id, {model: 'synthetic-model', note: 'The exact earlier task is reconciled; retain its actual consumption.'}, OWNER);
  assert.deepEqual(allowances, [10000, 9860]); await eventually(() => current().status === 'stopped', 'the explicit recovered decision');
  assert.equal(h.engine.run(item.routerRunId).stages[0].attempts[0].output, undefined); assert.equal(h.state.issuePosts, 2);
});

test('an issued MCP capability expires after authoritative task completion and never appears in team responses', async t => {
  const h = await fixture(t), gate = h.taskGate; h.state.taskListGate = gate.promise;
  const external = {type: 'http', url: 'https://example.invalid/synthetic-tools', headers: {Authorization: 'SYNTHETIC_EXTERNAL_AUTH'}, default_tools_approval_mode: 'prompt'};
  const template: MulticaAgent = {id: 'synthetic-external-template', workspace_id: WORKSPACE, name: 'Synthetic template', runtime_id: 'synthetic-runtime', status: 'active', mcp_config: {mcpServers: {external}}}; h.state.agents.set(template.id, structuredClone(template));
  const input = h.input(), reported: unknown[] = [], started = await h.execution.agent.start({...input, role: {...input.role, sandbox: 'read-only', multica: {agentId: template.id, runtimeId: template.runtime_id}}, onEvent: event => {if (event.usage) reported.push(event.usage);}});
  assert.equal(started.ref.provider, 'multica'); assert.ok(started.ref.issueId); assert.equal(started.ref.externalId, undefined);
  const worker = [...h.state.agents.values()].find(agent => agent.description?.includes('Execution synthetic-attempt'))!;
  const config = worker.mcp_config as {mcpServers: {external: unknown; gwi: {url: string; headers: {Authorization: string}; default_tools_approval_mode: string}}}, authorization = config.mcpServers.gwi.headers.Authorization;
  assert.equal(config.mcpServers.gwi.default_tools_approval_mode, 'approve'); assert.deepEqual(config.mcpServers.external, external); assert.deepEqual(h.state.agents.get(template.id), template);
  assert.match(worker.instructions!, /GWI owns coordination and result delivery/); assert.match(worker.instructions!, /final JSON directly/); assert.match(worker.instructions!, /Do not create Multica comments, reporting files/); assert.ok(worker.custom_args?.includes('default_permissions="gwi-readonly"'));
  const rpc = async () => fetch(config.mcpServers.gwi.url, {method: 'POST', headers: {authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
  const live = await rpc(); assert.equal(live.status, 200); const listed = await live.json() as {result: {tools: {name: string}[]}}; assert.deepEqual(listed.result.tools.map(tool => tool.name), ['gwi_context_read']);
  assert.equal(JSON.stringify(await h.platform.team(h.project.id, OWNER)).includes(authorization.slice('Bearer '.length)), false);
  const task = h.state.tasks.get(started.ref.issueId!)![0]; task.status = 'running'; gate.resolve(); await eventually(() => reported.length > 0, 'the first authoritative usage report');
  task.status = 'completed'; task.usage = [{model: 'synthetic-model', input_tokens: 1, output_tokens: 1}];
  const result = await started.completion; assert.deepEqual(result.output, OUTPUT); assert.deepEqual(result.usage, {input: 420, output: 20, cachedInput: 300, total: 440}, 'Late lower provider readings cannot reset consumed allowance.');
  assert.equal((await rpc()).status, 401); assert.equal(h.execution.records('synthetic-run')[0].cleanupConfirmed, true);
});

test('planner context carries continuation and role sandboxes while bounding knowledge without losing provenance', async t => {
  const h = await fixture(t), project = structuredClone(h.project);
  project.roles.push({...project.roles[0], id: 'synthetic-retired-role', name: 'Retired synthetic role', retired: true});
  const knowledge: KnowledgeEntry[] = Array.from({length: 6}, (_, index): KnowledgeEntry => {const content = (`Synthetic planner knowledge ${index}. `).repeat(180); return {id: `synthetic-knowledge-${index}`, projectId: project.id, sourceId: 'synthetic-source', kind: 'document', title: `Synthetic knowledge ${index}`, content, hash: createHash('sha256').update(content).digest('hex'), revision: index + 1, roles: index % 2 ? ['lead'] : [], status: 'current', syncedAt: '2026-01-01T00:00:00.000Z'};});
  knowledge.push({...knowledge[0], id: 'synthetic-qa-private', title: 'QA private context', content: 'SYNTHETIC_QA_ONLY_CONTEXT', roles: ['qa']});
  const originalProject = structuredClone(project), originalKnowledge = structuredClone(knowledge), continuation = {note: 'The task-scoped MCP approval configuration is repaired; verify the failed action again.', reason: 'The previous action could not receive its authorized MCP tools.'};
  h.state.taskResult = () => JSON.stringify({action: 'stop', rationale: 'The synthetic context check is complete.', expectedGain: 'No extra work.', tasks: []});
  const started = await h.execution.planner.start({project, pipelines: [], knowledge, request: 'Inspect the bounded synthetic continuation.', baseline: 'Synthetic committed input.', continuation, rounds: [], observations: [], remaining: {tokens: 5000, seconds: 10, rounds: 3}, signal: new AbortController().signal, onEvent() {}, executionId: 'synthetic-planner-context'});
  await started.completion;
  const prompt = String(h.state.requests.find(request => request.method === 'POST' && request.path === '/api/issues')!.body.description), line = prompt.split('\n').find(value => value.startsWith('{"request":'))!;
  const brief = JSON.parse(line) as {continuation: {note: string; reason: string}; roles: {id: string; sandbox: string}[]; knowledge: {id: string; revision: number; hash: string; excerpt: string}[]};
  assert.deepEqual(brief.continuation, continuation); assert.equal(brief.roles.find(role => role.id === 'lead')?.sandbox, 'read-only'); assert.equal(brief.roles.find(role => role.id === 'development')?.sandbox, 'workspace-write'); assert.equal(brief.roles.some(role => role.id === 'synthetic-retired-role'), false);
  assert.equal(brief.knowledge.length, 4); assert.equal(line.includes('SYNTHETIC_QA_ONLY_CONTEXT'), false);
  for (const [index, entry] of brief.knowledge.entries()) assert.deepEqual(entry, {id: knowledge[index].id, title: knowledge[index].title, revision: knowledge[index].revision, hash: knowledge[index].hash, excerpt: knowledge[index].content.slice(0, 1500)});
  assert.deepEqual(project, originalProject); assert.deepEqual(knowledge, originalKnowledge);
  assert.equal(h.execution.records('synthetic-planner-context')[0].issueState, 'done');
});

test('real HTTP planner references advance only after authoritative completion and human acceptance without paid waiting', async t => {
  const h = await fixture(t), gate = h.taskGate; h.state.taskListGate = gate.promise;
  const initial = h.engine.createPipeline({projectId: h.project.id, roleId: 'development', name: 'Synthetic human delivery'}, OWNER);
  const flow = h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [{id: 'deliver', name: 'Inspect the synthetic delivery', roleId: 'development', executor: 'manual', dependsOn: [], prompt: 'Record actual synthetic acceptance.', review: false}]}, OWNER);
  h.state.taskResult = issue => JSON.stringify(issue === 'synthetic-issue-1' ? {action: 'dispatch', rationale: 'A human must inspect the concrete synthetic delivery.', expectedGain: 'Accepted evidence.', tasks: [{pipelineId: flow.id, goal: 'Inspect this bounded synthetic artifact.'}]} : {action: 'complete', rationale: 'The actual delegated delivery was accepted.', expectedGain: 'Verified outcome.', tasks: []});
  h.engine.goalPlanner = h.execution.planner; h.engine.agentExecutor = h.execution.agent; const intake = new IntakeService(h.engine);
  const item = intake.create(h.project.id, {request: 'Verify one synthetic delivery.', idempotencyKey: 'synthetic-http-goal', policy: {maxTotalTokens: 10000, maxElapsedSeconds: 300}}, OWNER);
  const current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
  await eventually(() => Boolean(h.engine.run(item.routerRunId).stages[0].attempts[0]?.ref?.issueId), 'the initial issue-only planner reference');
  assert.equal(current().status, 'routing'); assert.equal(h.engine.run(item.routerRunId).stages[0].attempts[0].ref?.externalId, undefined);
  gate.resolve(); await eventually(() => current().status === 'dispatched', 'the authoritative first decision');
  await h.engine.tick(); const target = current().targetRunIds[0]; assert.equal(h.engine.run(target).status, 'waiting');
  for (let count = 0; count < 5; count++) {await h.engine.tick(); await delay(10);} assert.equal(h.state.issuePosts, 1);
  h.engine.completeManual(target, 'deliver', OUTPUT, OWNER); await h.engine.tick();
  await eventually(() => current().status === 'completed', 'the accepted next decision');
  assert.equal(h.state.issuePosts, 2); assert.equal(current().supervisorRunIds?.length, 2);
  for (const id of current().supervisorRunIds!) {const attempt = h.engine.run(id).stages[0].attempts[0]; assert.equal(attempt.provider, 'multica'); assert.ok(attempt.ref?.externalId); assert.equal(attempt.nativeGoal, undefined); assert.equal(h.execution.records(id)[0].cleanupConfirmed, true);}
});

test('new projects include the focused implement, independent QA and manual delivery path', async t => {
  const h = await fixture(t), flow = h.engine.detail(h.project.id, OWNER).pipelines.find(pipeline => pipeline.name === 'Focused change'); assert.ok(flow);
  assert.deepEqual(flow.stages.map(stage => ({id: stage.id, role: stage.roleId, executor: stage.executor, dependsOn: stage.dependsOn})), [{id: 'implement', role: 'development', executor: 'codex', dependsOn: []}, {id: 'verify', role: 'qa', executor: 'codex', dependsOn: ['implement']}, {id: 'delivery', role: 'development', executor: 'manual', dependsOn: ['verify']}]);
  assert.equal(flow.stages[1].reworkTo, 'implement'); assert.equal(flow.stages[2].reworkTo, 'implement'); assert.equal(flow.policy.maxIterations, 1);
  h.engine.agentExecutor = h.execution.agent;
  const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Prepare one synthetic change with independent evidence.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-focused-default'}, OWNER);
  await eventually(() => h.engine.run(run.id).stages[2].status === 'waiting', 'the focused manual delivery gate');
  const before = h.engine.run(run.id); assert.equal(before.status, 'waiting'); assert.deepEqual(before.stages.map(stage => stage.status), ['completed', 'completed', 'waiting']); assert.equal(h.state.issuePosts, 2);
  const agents = [...h.state.issues.values()].map(issue => h.state.agents.get(issue.assignee_id!)!); assert.ok(agents[0].custom_args?.includes('default_permissions="gwi-workspace"')); assert.ok(agents[1].custom_args?.includes('default_permissions="gwi-readonly"'));
  for (let count = 0; count < 3; count++) {await h.engine.tick(); await delay(10);} assert.equal(h.state.issuePosts, 2);
  h.engine.completeManual(run.id, 'delivery', {...OUTPUT, summary: 'The owner inspected the synthetic change and independent checks.'}, OWNER); assert.equal(h.engine.run(run.id).status, 'completed'); assert.equal(h.state.issuePosts, 2); assert.ok([...h.state.issues.values()].every(issue => issue.status === 'done'));
});
