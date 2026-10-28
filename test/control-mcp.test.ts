import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {ControlTool} from '../src/contracts.ts';
import {ControlMcp} from '../src/control-mcp.ts';
import {AppError} from '../src/validation.ts';

type ToolHints = {readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean};

async function fixture(t: TestContext) {
  const controls = new ControlMcp('http://127.0.0.1:1');
  const server = createServer((request, response) => {void controls.handle(request, response).catch(error => {response.writeHead(error instanceof AppError ? error.status : 500, {'content-type': 'application/json'}); response.end(JSON.stringify({error: {code: error instanceof AppError ? error.code : 'TEST_FAILURE'}}));});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {controls.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
  const rpc = async (authorization: string | undefined, method: string, params: unknown = {}) => {
    const response = await fetch(origin + '/mcp/control', {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(authorization ? {authorization} : {})}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
    return {status: response.status, body: await response.json() as {result?: {tools?: {name: string; annotations?: ToolHints}[]; isError?: boolean; content?: {text: string}[]}; error?: {code: string}}};
  };
  return {controls, rpc};
}

test('HTTP MCP advertises only frozen authorized tools and rejects calls after revocation or expiry', async t => {
  const h = await fixture(t), tools: ControlTool[] = ['context.read', 'knowledge.search', 'context.read'];
  const invoked: {tool: ControlTool; args: unknown}[] = [];
  const lease = h.controls.issue(tools, async (tool, args) => {invoked.push({tool, args}); return {projectId: 'synthetic-project', accepted: true};}, 60);
  const authorization = lease.config.mcpServers.gwi.headers.Authorization;
  assert.equal(lease.config.mcpServers.gwi.default_tools_approval_mode, 'approve');
  assert.deepEqual(Object.keys(lease.config.mcpServers), ['gwi']); assert.equal('tools' in lease.config.mcpServers.gwi, false);
  tools.push('run.start');
  const listed = await h.rpc(authorization, 'tools/list');
  assert.equal(listed.status, 200); assert.deepEqual(listed.body.result?.tools?.map(tool => tool.name).sort(), ['gwi_context_read', 'gwi_knowledge_search']);
  assert.equal(JSON.stringify(listed.body).includes(authorization.slice('Bearer '.length)), false);
  const denied = await h.rpc(authorization, 'tools/call', {name: 'gwi_run_start', arguments: {projectId: 'another-synthetic-project'}});
  assert.equal(denied.body.result?.isError, true); assert.equal(JSON.parse(denied.body.result!.content![0].text).code, 'TOOL_NOT_ALLOWED'); assert.equal(invoked.length, 0);
  const accepted = await h.rpc(authorization, 'tools/call', {name: 'gwi_context_read', arguments: {}});
  assert.equal(accepted.status, 200); assert.deepEqual(invoked, [{tool: 'context.read', args: {}}]);
  lease.revoke(); assert.equal((await h.rpc(authorization, 'tools/list')).status, 401);
  assert.equal((await h.rpc(undefined, 'tools/list')).status, 401); assert.equal((await h.rpc('Bearer synthetic-invalid-capability', 'tools/list')).status, 401);
  assert.throws(()=>h.controls.issue(['context.read'],async()=>({accepted:false}),-1),error=>error instanceof AppError&&error.code==='INVALID_CAPABILITY_LIFETIME');
  const expired = h.controls.issue(['context.read'], async () => ({accepted: false}), 1);
  const observed=Date.now();t.mock.method(Date,'now',()=>observed+2000);
  assert.equal((await h.rpc(expired.config.mcpServers.gwi.headers.Authorization, 'tools/call', {name: 'gwi_context_read', arguments: {}})).status, 401);
});

test('execution-scoped MCP stays authorized across long work and revocation remains authoritative',async t=>{
  const h=await fixture(t),lease=h.controls.issue(['context.read'],async()=>({projectId:'synthetic-project'}));
  const authorization=lease.config.mcpServers.gwi.headers.Authorization,observed=Date.now();
  t.mock.method(Date,'now',()=>observed+30*24*60*60*1000);
  const accepted=await h.rpc(authorization,'tools/call',{name:'gwi_context_read',arguments:{}});
  assert.equal(accepted.status,200);assert.notEqual(accepted.body.result?.isError,true);
  assert.deepEqual(JSON.parse(accepted.body.result!.content![0].text),{projectId:'synthetic-project'});
  lease.revoke();assert.equal((await h.rpc(authorization,'tools/list')).status,401);
});

test('MCP annotations describe actual read, mutation, external dispatch and idempotency behavior', async t => {
  const h = await fixture(t), lease = h.controls.issue(['context.read', 'knowledge.search', 'pipeline.read', 'run.read', 'knowledge.write', 'pipeline.write', 'run.start', 'intake.route'], async () => ({}), 60);
  const listed = await h.rpc(lease.config.mcpServers.gwi.headers.Authorization, 'tools/list'), tools = new Map(listed.body.result!.tools!.map(tool => [tool.name, tool.annotations]));
  for (const name of ['gwi_context_read', 'gwi_knowledge_search', 'gwi_pipeline_read', 'gwi_run_read']) assert.deepEqual(tools.get(name), {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false});
  assert.deepEqual(tools.get('gwi_knowledge_write'), {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false});
  assert.deepEqual(tools.get('gwi_run_start'), {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true});
  assert.equal(tools.get('gwi_pipeline_write')?.readOnlyHint, false); assert.equal(tools.get('gwi_pipeline_write')?.destructiveHint, true);
  assert.deepEqual(tools.get('gwi_intake_route'), {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true});
});
