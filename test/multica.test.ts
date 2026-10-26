import assert from 'node:assert/strict';
import test from 'node:test';
import {createMulticaClient, isMulticaTaskTerminal, MulticaApiError} from '../src/adapters/multica.ts';

const connection = {baseUrl: 'http://127.0.0.1:19234', token: 'synthetic-private-token', workspaceId: 'ws-synthetic'};
const project = {id: 'project-synthetic', workspace_id: connection.workspaceId, title: 'Synthetic project', status: 'planned'};
const agent = {id: 'agent-synthetic', workspace_id: connection.workspaceId, name: 'Synthetic reviewer',
  runtime_id: 'runtime-synthetic', status: 'idle', model: 'synthetic-model', thinking_level: 'low', service_tier: 'default'};
const task = {id: 'task-synthetic', workspace_id: connection.workspaceId, issue_id: 'issue-synthetic',
  agent_id: agent.id, runtime_id: agent.runtime_id, status: 'queued', result: null, error: null};
const issue = {id: task.issue_id, workspace_id: connection.workspaceId, title: 'Synthetic task', status: 'todo'};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
function fixture(responses: Response[]) {
  const calls: {url: string; init: RequestInit}[] = [];
  const client = createMulticaClient(connection, {fetch: async (url, init) => {
    calls.push({url: String(url), init: init ?? {}});
    const response = responses.shift(); assert.ok(response, 'unexpected request'); return response;
  }});
  return {client, calls};
}

test('connection health proves backend and native auth without exposing account or credentials', async () => {
  const h = fixture([json({status: 'ok', checks: {db: 'ok', migrations: 'ok'}}),
    json({server_version: 'synthetic-build'}), json({id: 'user-synthetic', email: 'private@example.invalid', token: connection.token})]);
  assert.deepEqual(await h.client.info(), {available: true, authenticated: true, workspaceId: connection.workspaceId,
    checks: {db: 'ok', migrations: 'ok'}, serverVersion: 'synthetic-build'});
  assert.equal(new Headers(h.calls[0]!.init.headers).has('Authorization'), false);
  const headers = new Headers(h.calls[2]!.init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer ' + connection.token);
  assert.equal(headers.get('X-Workspace-ID'), connection.workspaceId);
  assert.equal(h.calls[2]!.init.redirect, 'error');
  assert.equal(JSON.stringify(h.client), '{}');
  assert.equal(JSON.stringify(await fixture([json({status: 'ok'}), json({}), json({error: 'expired'}, 401)]).client.info()).includes('expired'), true);
});

test('project, agent, skill and runtime methods retain actual metadata and use upstream wire bodies', async () => {
  const skill = {id: 'skill-synthetic', workspace_id: connection.workspaceId, name: 'Review evidence', description: 'Inspect evidence'};
  const runtime = {id: agent.runtime_id, daemon_id: 'different-daemon-synthetic', workspace_id: connection.workspaceId, name: 'Synthetic runtime', provider: 'codex', status: 'offline'};
  const h = fixture([json(project, 201), json(project), json({projects: [project], total: 1}), new Response(null, {status: 204}),
    json(agent, 201), json({...agent, instructions: 'Bounded review'}), json([agent]), json([skill]), json({...skill, content: '# Evidence'}),
    json([skill]), json([runtime]), json({id: 'request', runtime_id: runtime.id, status: 'pending'}),
    json({id: 'request', runtime_id: runtime.id, status: 'completed', supported: true,
      models: [{id: 'synthetic-model', label: 'Synthetic model', default: false, service_tiers: ['default']}]})]);
  await h.client.createProject({title: project.title});
  await h.client.updateProject(project.id, {description: 'Updated'});
  assert.equal((await h.client.listProjects())[0]!.id, project.id);
  await h.client.deleteProject(project.id);
  const created = await h.client.createAgent({...agent, skill_ids: [skill.id]});
  assert.equal(created.service_tier, 'default');
  await h.client.updateAgent(agent.id, {instructions: 'Bounded review'});
  assert.equal((await h.client.listAgents())[0]!.runtime_id, runtime.id);
  assert.equal((await h.client.listSkills()).length, 1);
  assert.equal((await h.client.getSkill(skill.id)).content, '# Evidence');
  assert.equal((await h.client.setAgentSkills(agent.id, [skill.id]))[0]!.id, skill.id);
  const runtimes = await h.client.listRuntimes();
  assert.equal(runtimes[0]!.status, 'offline');
  assert.equal(runtimes[0]!.daemon_id, 'different-daemon-synthetic');
  assert.notEqual(runtimes[0]!.daemon_id, runtimes[0]!.id);
  assert.equal((await h.client.requestModels(runtime.id, true)).status, 'pending');
  assert.equal((await h.client.getModelRequest(runtime.id, 'request')).models![0]!.id, 'synthetic-model');
  assert.deepEqual(JSON.parse(h.calls[1]!.init.body as string), {description: 'Updated'});
  assert.deepEqual(JSON.parse(h.calls[9]!.init.body as string), {skill_ids: [skill.id]});
});

test('task lifecycle returns authoritative IDs and preserves unknown versus actual zero usage', async () => {
  const done = {...task, status: 'completed', result: {output: 'Actual synthetic result', session_id: 'reported-session'},
    usage: [{provider: 'codex', model: 'synthetic-model', input_tokens: 120, output_tokens: 30,
      cache_read_tokens: 800, cache_write_tokens: 0, cost_usd_ticks: 0}], auth_token: 'must-not-escape'};
  const h = fixture([json(issue, 201), json([task]), json(done, 202), json({...task, status: 'cancelled'}),
    json([{task_id: task.id, issue_id: issue.id, seq: 7, type: 'text', content: 'Actual result', output_truncated: null}]),
    json([done]), json([task])]);
  await h.client.createIssue({title: issue.title, assignee_type: 'agent', assignee_id: agent.id, status: 'todo'});
  const queued = (await h.client.listTaskRuns(issue.id))[0]!;
  assert.equal(queued.usage, undefined);
  assert.equal(isMulticaTaskTerminal(queued), false);
  const result = await h.client.rerunIssue(issue.id, task.id);
  assert.equal(result.id, task.id);
  assert.equal(isMulticaTaskTerminal(result), true);
  assert.deepEqual(result.usage, done.usage);
  assert.equal('auth_token' in result, false);
  assert.equal((result.result as {session_id: string}).session_id, 'reported-session');
  assert.equal((await h.client.cancelTask(issue.id, task.id)).status, 'cancelled');
  assert.equal((await h.client.listTaskMessages(task.id, 6))[0]!.output_truncated, null);
  assert.equal(h.calls[4]!.url.endsWith('/messages?since=6'), true);
  assert.equal((await h.client.getTask(issue.id, task.id)).id, task.id);
  await assert.rejects(h.client.getTask(issue.id, 'missing-task'), {code: 'TASK_NOT_FOUND'});
  assert.equal(isMulticaTaskTerminal({status: 'new-provider-state'}), false);
});

test('managed MCP configuration is write-only and binding mutations return the actual library', async () => {
  const server = {id: 'mcp-synthetic', workspace_id: connection.workspaceId, name: 'Synthetic integration',
    transport: 'http', enabled: true, config: {headers: {Authorization: 'must-not-escape'}}};
  const h = fixture([json(server, 201), json([server]), json([{...server, enabled: false}]), json([]),
    json({id: 'profile', workspace_id: connection.workspaceId, display_name: 'Synthetic Codex', protocol_family: 'codex',
      command_name: 'synthetic-codex', fixed_args: ['-c', 'sandbox_mode="workspace-write"'], enabled: false})]);
  assert.equal('config' in await h.client.createMcpServer({name: server.name, config: {url: 'http://127.0.0.1:19235'}}), false);
  assert.equal((await h.client.addAgentMcpServer(agent.id, server.id))[0]!.enabled, true);
  assert.equal((await h.client.setAgentMcpServerEnabled(agent.id, server.id, false))[0]!.enabled, false);
  assert.deepEqual(await h.client.removeAgentMcpServer(agent.id, server.id), []);
  assert.equal((await h.client.createRuntimeProfile({display_name: 'Synthetic Codex', protocol_family: 'codex',
    command_name: 'synthetic-codex', enabled: false})).enabled, false);
});

test('active task instructions use the exact supplement API and preserve pending versus delivered receipts', async () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  const h = fixture([json([{...task, status: 'running', can_supplement: true, supplement_capability: 'task_supplement_v1'}]),
    json({id: 'comment-synthetic', issue_id: issue.id, content: 'Use the accepted evidence.',
      supplements: [{task_id: task.id, status: 'pending'}]}, 201),
    json({code: 'task_supplement_turn_ended', error: 'this run has ended'}, 409)]);
  assert.equal((await h.client.listTaskRuns(issue.id))[0]!.can_supplement, true);
  const pending = await h.client.appendTaskInstruction(issue.id, task.id, 'Use the accepted evidence.', requestId);
  assert.equal(pending.supplements[0]!.status, 'pending');
  assert.equal(pending.supplements[0]!.delivered_at, undefined);
  assert.equal(h.calls[1]!.url.endsWith('/issues/' + issue.id + '/tasks/' + task.id + '/supplements'), true);
  assert.deepEqual(JSON.parse(h.calls[1]!.init.body as string), {content: 'Use the accepted evidence.', client_request_id: requestId});
  await assert.rejects(h.client.appendTaskInstruction(issue.id, task.id, 'Late instruction', requestId), {code: 'task_supplement_turn_ended', status: 409});
  assert.equal(h.calls.length, 3);
});

test('malformed and cross-workspace resources fail closed without converting status or usage', async t => {
  for (const value of [{projects: [{...project, workspace_id: 'foreign-workspace'}], total: 1},
    {projects: [{...project, id: null}], total: 1}, {projects: [project]}, {projects: [project], total: 2}]) {
    await t.test(JSON.stringify(value), async () => {
      const h = fixture([json(value)]);
      await assert.rejects(h.client.listProjects(), MulticaApiError);
    });
  }
  const h = fixture([json([{...task, usage: [{model: 'synthetic-model', input_tokens: -1, output_tokens: 2}]}])]);
  await assert.rejects(h.client.listTaskRuns(issue.id), {code: 'INVALID_RESPONSE'});
  const invalidJson = fixture([new Response('<html>upstream unavailable</html>')]);
  await assert.rejects(invalidJson.client.listProjects(), {code: 'INVALID_RESPONSE'});
});

test('HTTP and transport failures never retry a mutation or leak the private credential', async () => {
  const h = fixture([json({code: 'invocation_not_allowed', error: 'Denied ' + connection.token}, 403)]);
  await assert.rejects(h.client.createIssue({title: 'Synthetic failure'}), error => {
    assert.ok(error instanceof MulticaApiError);
    assert.equal(error.code, 'invocation_not_allowed'); assert.equal(error.status, 403);
    assert.equal(error.message.includes(connection.token), false); return true;
  });
  assert.equal(h.calls.length, 1);
  let attempts = 0;
  const client = createMulticaClient(connection, {fetch: async () => {attempts++; throw new Error(connection.token);}});
  await assert.rejects(client.createIssue({title: 'No implicit retry'}), {code: 'TRANSPORT_ERROR'});
  assert.equal(attempts, 1);
  const info = await client.info(); assert.equal(info.available, false); assert.equal(info.authenticated, false);
  assert.equal(JSON.stringify(info).includes(connection.token), false);
});

test('request bounds, explicit abort and safe URL handling cover stalled or hostile responses', async () => {
  const oversized = createMulticaClient(connection, {maxResponseBytes: 8, fetch: async () => json([project])});
  await assert.rejects(oversized.listProjects(), {code: 'RESPONSE_TOO_LARGE'});
  const stall: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('synthetic timer')), 100);
    const abort = () => {clearTimeout(timer); reject(new Error('synthetic abort'));};
    if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, {once: true});
  });
  await assert.rejects(createMulticaClient(connection, {timeoutMs: 10, fetch: stall}).listProjects(), {code: 'TIMEOUT'});
  const controller = new AbortController();
  const pending = createMulticaClient(connection, {fetch: stall}).listProjects({signal: controller.signal}); controller.abort();
  await assert.rejects(pending, {code: 'ABORTED'});
  assert.throws(() => createMulticaClient({...connection, baseUrl: 'file:///tmp/synthetic'}), {code: 'INVALID_CONNECTION'});
  assert.throws(() => createMulticaClient({...connection, baseUrl: 'https://user:password@example.invalid'}), {code: 'INVALID_CONNECTION'});
  assert.throws(() => createMulticaClient(connection, {timeoutMs: 0}), {code: 'INVALID_CONNECTION'});
  const h = fixture([json(project)]); await h.client.getProject('synthetic/id?query');
  assert.equal(h.calls[0]!.url.endsWith('/synthetic%2Fid%3Fquery'), true);
  await assert.rejects(h.client.getProject(''), {code: 'INVALID_REQUEST'});
});
