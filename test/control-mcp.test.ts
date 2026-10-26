import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {ControlTool} from '../src/contracts.ts';
import {ControlMcp} from '../src/control-mcp.ts';
import {AppError} from '../src/validation.ts';

async function fixture(t: TestContext) {
  const controls = new ControlMcp('http://127.0.0.1:1');
  const server = createServer((request, response) => {void controls.handle(request, response).catch(error => {response.writeHead(error instanceof AppError ? error.status : 500, {'content-type': 'application/json'}); response.end(JSON.stringify({error: {code: error instanceof AppError ? error.code : 'TEST_FAILURE'}}));});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {controls.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
  const rpc = async (authorization: string | undefined, method: string, params: unknown = {}) => {
    const response = await fetch(origin + '/mcp/control', {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(authorization ? {authorization} : {})}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
    return {status: response.status, body: await response.json() as {result?: {tools?: {name: string}[]; isError?: boolean; content?: {text: string}[]}; error?: {code: string}}};
  };
  return {controls, rpc};
}

test('HTTP MCP advertises only frozen authorized tools and rejects calls after revocation or expiry', async t => {
  const h = await fixture(t), tools: ControlTool[] = ['context.read', 'knowledge.search', 'context.read'];
  const invoked: {tool: ControlTool; args: unknown}[] = [];
  const lease = h.controls.issue(tools, async (tool, args) => {invoked.push({tool, args}); return {projectId: 'synthetic-project', accepted: true};}, 60);
  const authorization = lease.config.mcpServers.gwi.headers.Authorization;
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
  const expired = h.controls.issue(['context.read'], async () => ({accepted: false}), -1);
  assert.equal((await h.rpc(expired.config.mcpServers.gwi.headers.Authorization, 'tools/call', {name: 'gwi_context_read', arguments: {}})).status, 401);
});
