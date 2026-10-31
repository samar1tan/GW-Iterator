import {MULTICA_SOURCE_REVISION,SUPERVISED_EXECUTION_POLICY,MULTICA_EXECUTION_PATCH_SHA256} from '../src/runtime-execution-policy.ts';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile,readFile,lstat,chmod,realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Actor, Intake, KnowledgeEntry, RoleProfile, TaskOutput,Project,Run} from '../src/contracts.ts';
import type {AllowanceExecution,AllowanceFinish,AllowanceAssessment} from '../src/account-allowance-types.ts';
import type {AgentExecutionInput, CodexAdapter} from '../src/adapters/types.ts';
import {MulticaClient} from '../src/adapters/multica.ts';
import type {MulticaAgent, MulticaIssue, MulticaProject, MulticaTask} from '../src/adapters/multica.ts';
import {ControlMcp} from '../src/control-mcp.ts';
import type {BrowserRuntime,BrowserScope,BrowserObservation} from '../src/browser-runtime.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Platform,probeVerificationScope,type VerificationProbeInput} from '../src/platform.ts';
import {PlatformExecution} from '../src/platform-execution.ts';
import {Store} from '../src/store.ts';
import {Workspaces} from '../src/workspaces.ts';
import {defaultRoles} from '../src/defaults.ts';
import {AppError} from '../src/validation.ts';
import {DeliveryReviewService} from '../src/delivery-review.ts';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';

const OWNER: Actor = {name: 'Synthetic platform owner', kind: 'human'};
const WORKSPACE = 'synthetic-provider-workspace', PROVIDER_TOKEN = 'SYNTHETIC_PROVIDER_AUTH_VALUE';
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Synthetic provider result.', artifacts: [], observations: []};
const execute = promisify(execFile);
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};}
async function eventually(condition: () => boolean, label: string) {for (let index = 0; index < 300; index++) {if (condition()) return; await delay(10);} assert.fail(`Synthetic platform did not reach ${label}.`);}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

async function fixture(t: TestContext, fixtureOptions?:BrowserRuntime|boolean|'project') {
  const browsers=typeof fixtureOptions==='object'?fixtureOptions:undefined,protectedInputState=fixtureOptions===true||fixtureOptions==='project'?fixtureOptions:false;
  const privateTests=path.join(process.cwd(),'.local','attachment-tests');if(protectedInputState)await mkdir(privateTests,{recursive:true,mode:0o700});
  const directory = await mkdtemp(path.join(protectedInputState?privateTests:tmpdir(), 'gwi-platform-test-')), workspace = path.join(directory, 'source'),stateDirectory=protectedInputState==='project'?path.join(workspace,'.local','state'):path.join(directory,'state');
  await mkdir(workspace);
  await execute('git', ['-C', workspace, 'init', '--template=']);
  await writeFile(path.join(workspace, 'tracked.txt'), 'Committed synthetic workspace.\n');
  await execute('git', ['-C', workspace, 'add', '--', 'tracked.txt']);
  if(protectedInputState==='project'){await writeFile(path.join(workspace,'.gitignore'),'.local/\n');await execute('git',['-C',workspace,'add','--','.gitignore']);}
  await execute('git', ['-C', workspace, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Create synthetic execution input']);
  const state = {
    agents: new Map<string, MulticaAgent>(), projects: new Map<string, MulticaProject>(), issues: new Map<string, MulticaIssue>(), tasks: new Map<string, MulticaTask[]>(),
    requests: [] as {method: string; path: string; body: Record<string, unknown>}[], issuePosts: 0, loseIssueResponse: false, failAgentCreation: false, taskListGate: undefined as Promise<void> | undefined,
    taskResult: (_issue: string): unknown => JSON.stringify(OUTPUT), taskStatus: 'completed', taskMessageError: false, taskListError: false, issuePutError: false, issueRejection: undefined as {code: string; status: number} | undefined,
    runtimeHealth:{} as Record<string,unknown>,scopeProbes:[] as VerificationProbeInput[],scopeProbeError:undefined as AppError|undefined,
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
    if(route==='/health'){json({status:'running',pid:process.pid,profile:'synthetic-profile',daemon_id:'synthetic-daemon',cli_commit:MULTICA_SOURCE_REVISION,gwi_supervised_execution:true,gwi_execution_patch_sha:MULTICA_EXECUTION_PATCH_SHA256,gwi_agent_timeout_disabled:true,gwi_idle_watchdog_disabled:true,gwi_tool_watchdog_disabled:true,active_task_count:8,...state.runtimeHealth});return;}
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
  const guardBinary=path.join(directory,'synthetic-native-guard');await writeFile(guardBinary,'#!/bin/sh\nexit 1\n',{mode:0o700});await chmod(guardBinary,0o700);
  const client = new MulticaClient(connection), platform = new Platform(engine, connection, stateDirectory, 'synthetic-model', {runtimeId: 'synthetic-runtime', daemonId: 'synthetic-daemon', permissionEvidence: 'Synthetic permission fixture.', verified: true, executionPolicy:SUPERVISED_EXECUTION_POLICY,executionPatchSha256:MULTICA_EXECUTION_PATCH_SHA256,daemon:{healthUrl:connection.baseUrl+'/health',pid:process.pid,profile:'synthetic-profile',daemonId:'synthetic-daemon',cliCommit:MULTICA_SOURCE_REVISION,startedAt:'2026-01-01T00:00:00.000Z'}, permissions: {readOnly: {name: 'gwi-readonly', verified: true}, workspaceWrite: {name: 'gwi-workspace', verified: true,network:'enabled'}}, authorizedRootsFile: rootsFile,guardBinary,scratchHome:path.join(directory,'synthetic-codex-home')}, client,async input=>{state.scopeProbes.push(input);if(state.scopeProbeError)throw state.scopeProbeError;return{checkedAt:new Date().toISOString(),profile:'gwi-workspace',copyWrite:true,executionWriteDenied:true,projectWriteDenied:true,siblingWriteDenied:true,approvalPolicy:'never',modelTurnStarted:false,readIsolation:false,network:input.network,networkDomainRestriction:false};});
  const execution = new PlatformExecution(platform, controls,browsers), project = await engine.createProject({name: 'Synthetic platform project', workspace}, OWNER);
  const input = (extra: Partial<AgentExecutionInput> = {}): AgentExecutionInput => ({project: structuredClone(project), workspace, role: {...project.roles.find(role => role.id === 'development')!, model: 'synthetic-model', tools: ['context.read']}, runId: 'synthetic-run', stageId: 'work', attemptId: 'synthetic-attempt', prompt: 'Perform only the synthetic check.', timeoutSeconds: 5, tokenBudget: 1000, signal: new AbortController().signal, onEvent() {}, onTool: async () => ({projectId: project.id}), ...extra});
  t.after(async () => {taskGate.resolve(); state.taskListGate = undefined; await execution.close(); await engine.close(); controls!.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, {recursive: true, force: true});});
  return {directory, state, connection, controls, client, engine, platform, execution, project, input, taskGate};
}

type Fixture=Awaited<ReturnType<typeof fixture>>;

async function reviewMaterialParent(h:Fixture){
  h.engine.agentExecutor=h.execution.agent;const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'lead',name:'Synthetic retained delivery'},OWNER),flow=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'delivery',name:'Review retained source',roleId:'lead',executor:'manual',ownerGate:true,dependsOn:[],prompt:'Inspect the actual retained input.',review:false}]},OWNER);
  const run=h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Prepare material without changing the retained source.',baseline:'Synthetic committed input.',idempotencyKey:'synthetic-material-parent'},OWNER),checkout=await h.platform.workspaces.ensure(run.snapshot.project,run.id);await writeFile(path.join(checkout.path,'synthetic-new.txt'),'Retained untracked candidate.\n');
  const service=new DeliveryReviewService(h.engine,{changes:id=>h.platform.workspaces.changes(id)}),bundle=await service.bundle(run.id,'delivery',OWNER);
  const input={idempotencyKey:'synthetic-material-request',bundleKey:bundle.key,attemptId:h.engine.run(run.id).stages[0].attempts[0].id,controlRevision:0};
  return{run:h.engine.run(run.id),checkout,service,input};
}

test('review support uses the original prepared candidate and drops inherited write bindings',async t=>{
  const h=await fixture(t);h.state.agents.set('synthetic-shared-review',{id:'synthetic-shared-review',workspace_id:WORKSPACE,runtime_id:'synthetic-runtime',name:'Synthetic review template',status:'active',updated_at:'2026-01-01T00:00:00Z',description:'Synthetic inherited write bindings.',instructions:'Inspect the assigned evidence.',model:'synthetic-model',thinking_level:'max',mcp_config:{mcpServers:{syntheticWrite:{command:'synthetic-write-command'}}},skills:[{id:'synthetic-write-skill',name:'Synthetic write skill'}]} as MulticaAgent);
  const current=h.engine.project(h.project.id);await h.engine.updateProject(current.id,current.revision,{...current,roles:current.roles.map(role=>role.id==='lead'?{...role,multica:{agentId:'synthetic-shared-review'},tools:[...role.tools,'run.start','knowledge.write']}:role)},OWNER);
  const p=await reviewMaterialParent(h),snapshot=structuredClone(h.engine.run(p.run.id)),child=await p.service.prepare(p.run.id,'delivery',p.input,OWNER);await eventually(()=>['completed','failed'].includes(h.engine.run(child.id).status),'one material preparation');assert.equal(h.engine.run(child.id).status,'completed',JSON.stringify(h.engine.run(child.id).stages));
  const record=h.execution.records(child.id)[0],worker=h.state.agents.get(record.agentId!)!;
  assert.equal(h.state.issuePosts,1);assert.equal(h.state.scopeProbes.length,1);assert.equal(path.dirname(h.state.scopeProbes[0].executionFile),await realpath(p.checkout.path));assert.equal(h.engine.store.get<{manifest:{entries:{path:string}[]}}>('verification-workspace',record.id)?.manifest.entries.some(entry=>entry.path==='synthetic-new.txt'),true);
  assert.deepEqual(worker.skills,[]);assert.deepEqual(Object.keys((worker.mcp_config as {mcpServers:Record<string,unknown>}).mcpServers),['gwi']);assert.ok(worker.custom_args?.includes('default_permissions="gwi-workspace"'));assert.deepEqual(h.engine.run(p.run.id),snapshot);assert.throws(()=>h.platform.workspaces.get(child.id),code('EXECUTION_WORKSPACE_UNAVAILABLE'));assert.equal(await readFile(path.join(p.checkout.path,'synthetic-new.txt'),'utf8'),'Retained untracked candidate.\n');
});

test('a changed prepared source blocks material dispatch before any paid assignment',async t=>{
  const h=await fixture(t),p=await reviewMaterialParent(h),prepare=h.platform.workspaces.prepareVerification.bind(h.platform.workspaces);
  t.mock.method(h.platform.workspaces,'prepareVerification',async(project:Project,runId:string,attemptId:string)=>{await writeFile(path.join(p.checkout.path,'synthetic-new.txt'),'Changed before protected capture.\n');return prepare(project,runId,attemptId);});
  const child=await p.service.prepare(p.run.id,'delivery',p.input,OWNER);await eventually(()=>h.engine.run(child.id).status==='failed','changed preparation input');assert.equal(h.state.issuePosts,0);assert.equal(h.execution.records(child.id)[0].cleanupConfirmed,true);assert.equal(h.engine.run(child.id).stages[0].attempts[0].failureCode,'REVIEW_INPUT_CHANGED');assert.equal(h.engine.run(p.run.id).stages[0].status,'waiting');
});

test('material preparation retains real account approval before one scoped provider assignment',async t=>{
  const h=await fixture(t),p=await reviewMaterialParent(h),now=Date.now();h.engine.accountModelResolver=async()=> 'synthetic-model';h.engine.accountAllowances=new AccountAllowanceService(h.engine.store,{readAccountAllowance:async()=>normalizeAccountObservation({status:'available',source:'local-codex',accountKey:'d'.repeat(64),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),windows:[{bucketId:'synthetic-window',slot:'primary',usedPercent:98,windowDurationMins:300,resetsAt:Math.floor(now/1000)+86400}],exhausted:false},now)},{now:()=>now});
  const child=await p.service.prepare(p.run.id,'delivery',p.input,OWNER);await eventually(()=>!!h.engine.run(child.id).stages[0].allowanceHold,'actual account hold');assert.equal(h.state.issuePosts,0);assert.equal(h.engine.run(p.run.id).stages[0].status,'waiting');
  const recovery=await h.engine.recoveryWithAccount(child.id,'prepare-review',OWNER);assert.equal(recovery.action,'approve');await h.engine.resolveWaiting(child.id,{stageId:'prepare-review',attemptId:h.engine.run(child.id).stages[0].attempts.at(-1)!.id,controlRevision:0,idempotencyKey:'synthetic-material-approval',recoveryKey:recovery.recoveryKey,approveAccountStep:true,accountAssessmentKey:recovery.account!.key},OWNER);
  await eventually(()=>['completed','failed'].includes(h.engine.run(child.id).status),'approved material preparation');assert.equal(h.engine.run(child.id).status,'completed',JSON.stringify(h.engine.run(child.id).stages));assert.equal(h.state.issuePosts,1);assert.equal(h.engine.run(p.run.id).stages[0].status,'waiting');assert.equal(h.engine.run(child.id).accountApprovals?.[0].used,true);
});

test('hosted browser forwarding uses the frozen role and isolated execution workspace, and revokes on stop',async t=>{
  const scopes:BrowserScope[]=[],calls:unknown[]=[],leases:{closed:boolean}[]=[];
  let observeSession:((value:BrowserObservation)=>void)|undefined,latest:BrowserObservation|undefined;
  const runtime={prepare:async(scope:BrowserScope,signal:AbortSignal,observe:(value:BrowserObservation)=>void)=>{
    scopes.push(structuredClone(scope));const state={closed:false};leases.push(state);
    const record:BrowserObservation={id:scope.attemptId,...scope,status:'ready',cleanupConfirmed:false,operations:0,blockedRequests:0,updatedAt:new Date().toISOString()};observeSession=observe;latest=record;observe(record);
    const close=async()=>{state.closed=true;observe({...record,status:'closed',cleanupConfirmed:true});};signal.addEventListener('abort',()=>void close(),{once:true});
    return{invoke:async(args:unknown)=>{assert.equal(state.closed,false);calls.push(args);return{content:[{type:'text',text:'{"observed":"synthetic-page"}'}]};},close,observation:()=>record};
  },close:async()=>{for(const lease of leases)lease.closed=true;}} as unknown as BrowserRuntime;
  const h=await fixture(t,runtime);h.state.taskListGate=h.taskGate.promise;
  const events:unknown[]=[],controller=new AbortController(),input=h.input({signal:controller.signal,onEvent:event=>events.push(event)}),role:RoleProfile={...input.role,sandbox:'read-only',tools:['context.read','browser.use'],browser:{origins:['http://127.0.0.1:45678']}};
  const started=await h.execution.agent.start({...input,role});
  const recorded=events.length;observeSession!({...latest!,blockedRequests:1});observeSession!({...latest!,blockedRequests:2});assert.equal(events.length,recorded,'Background request counters must not narrate another completed action.');
  assert.equal(scopes.length,1);assert.deepEqual(scopes[0].origins,role.browser!.origins);assert.notEqual(scopes[0].workspace,input.workspace);assert.equal(scopes[0].attemptId,input.attemptId);
  const worker=h.state.agents.get(started.ref.agentId!)!;assert.ok(worker.custom_args?.includes('default_permissions="gwi-readonly"'));assert.match(worker.instructions!,/gwi_browser_use/);
  role.browser!.origins[0]='http://127.0.0.1:45679';assert.deepEqual(scopes[0].origins,['http://127.0.0.1:45678']);
  const config=(worker.mcp_config as {mcpServers:{gwi:{url:string;headers:Record<string,string>}}}).mcpServers.gwi;
  const rpc=()=>fetch(config.url,{method:'POST',headers:{...config.headers,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'gwi_browser_use',arguments:{action:'snapshot'}}})});
  assert.equal((await rpc()).status,200);assert.deepEqual(calls,[{action:'snapshot'}]);
  controller.abort();assert.equal(leases[0].closed,true);assert.equal((await rpc()).status,401);
  h.taskGate.resolve();await started.completion.catch(()=>{});assert.equal(h.execution.records(input.runId)[0].browser?.cleanupConfirmed,true);
});

test('browser tools without a hosted runtime fail before paid assignment; bindings change immutable role identity',async t=>{
  const h=await fixture(t),input=h.input();
  await assert.rejects(h.execution.agent.start({...input,role:{...input.role,tools:['browser.use'],browser:{origins:['http://127.0.0.1:45678']}}}),code('BROWSER_RUNTIME_REQUIRED'));assert.equal(h.state.issuePosts,0);
  const role={...input.role,browser:{origins:['http://127.0.0.1:45678']}},first=await h.platform.agent(h.project,role,false),second=await h.platform.agent(h.project,{...role,browser:{origins:['http://127.0.0.1:45679']}},false);
  assert.notEqual(first.id,second.id);assert.deepEqual(h.project.roles.find(item=>item.id===role.id)?.browser,undefined);
});

test('private attachments reach the actual worker and independent review workspace without entering prepared source',async t=>{
  for(const review of [false,true])await t.test(review?'independent review':'worker',async sub=>{
    const h=await fixture(sub,true);
    const bytes=Buffer.from('Independent private attachment for protocol verification.'),item=await h.engine.attachments.upload(h.project.id,{key:'synthetic-input-upload',draft:'synthetic-draft',name:'private-note.txt',bytes},OWNER);
    h.state.taskListGate=h.taskGate.promise;const started=await h.execution.agent.start(h.input({attachments:[item],...(review?{executionPurpose:'review' as const}:{})}));
    const request=h.state.requests.find(request=>request.method==='POST'&&request.path==='/api/issues')!,description=String(request.body.description),manifest=JSON.parse(description.split('Attached input manifest:\n')[1].split('\n\nGWI execution identity:')[0]);
    const workspace=review?h.platform.workspaces.verification('synthetic-attempt').path:h.platform.workspaces.get('synthetic-run').path;
    assert.ok(manifest[0].path.startsWith(path.join(await realpath(h.engine.store.directory),'attachment-inputs',h.project.id)+path.sep));assert.ok(!manifest[0].path.startsWith(workspace+path.sep));assert.equal(manifest[0].sha256,item.sha256);assert.deepEqual(await readFile(manifest[0].path),bytes);assert.match(description,/untrusted task data/);
    assert.equal(await lstat(path.join(h.project.workspace,'.local')).catch(()=>null),null);assert.equal(await lstat(path.join(workspace,'.local')).catch(()=>null),null);if(review)assert.ok(!h.platform.workspaces.verification('synthetic-attempt').manifest.entries.some(entry=>entry.path.includes('attachment-inputs')));
    await assert.rejects(h.platform.workspaces.artifact('synthetic-run',path.relative(workspace,manifest[0].path)),code('INVALID_ARTIFACT_PATH'));
    h.taskGate.resolve();assert.deepEqual((await started.completion).output,OUTPUT);
  });
});

test('worker-writable temporary application state rejects attachment assignment before any paid task',async t=>{
  const h=await fixture(t),item=await h.engine.attachments.upload(h.project.id,{key:'synthetic-blocked-input',draft:'synthetic-draft',name:'note.txt',bytes:Buffer.from('Authored blocked input.')},OWNER);
  await assert.rejects(h.execution.agent.start(h.input({attachments:[item]})),code('ATTACHMENT_HANDOFF_UNAVAILABLE'));assert.equal(h.state.issuePosts,0);assert.equal(h.execution.records('synthetic-run')[0].status,'not_dispatched');assert.equal(h.execution.records('synthetic-run')[0].cleanupConfirmed,true);
});

test('Intake connected coordination hands off project-local state to its actual isolated read-only worker',async t=>{
  const h=await fixture(t,'project'),bytes=Buffer.from('Synthetic connected Intake attachment.'),item=await h.engine.attachments.upload(h.project.id,{key:'synthetic-intake-input',draft:'synthetic-draft',name:'intake.txt',bytes},OWNER);
  h.engine.goalPlanner=h.execution.planner;h.state.taskResult=()=>JSON.stringify({action:'answer',response:'Model-free connected coordination result.',rationale:'Synthetic Intake path check.',expectedGain:'Verify frozen input delivery.',tasks:[]});
  const intakes=new IntakeService(h.engine),input={request:'Inspect the synthetic attachment.',attachmentIds:[item.id],idempotencyKey:'synthetic-connected-intake'},created=await intakes.createWithAccount(h.project.id,input,OWNER);
  await eventually(()=>h.engine.store.get<Intake>('intake',created.id)?.status==='completed','connected Intake completion');
  const record=h.platform.workspaces.get(created.routerRunId),request=h.state.requests.find(row=>row.method==='POST'&&row.path==='/api/issues')!,manifest=JSON.parse(String(request.body.description).split('Attached input manifest:\n')[1].split('\n\nGWI execution identity:')[0]);
  assert.ok((await realpath(h.engine.store.directory)).startsWith(await realpath(h.project.workspace)+path.sep));
  assert.ok(!manifest[0].path.startsWith(record.path+path.sep));assert.deepEqual(await readFile(manifest[0].path),bytes);
  assert.ok(h.state.agents.get(String(request.body.assignee_id))!.custom_args?.includes('default_permissions="gwi-readonly"'));
  assert.deepEqual(h.engine.run(created.routerRunId).snapshot.attachments,[item]);assert.equal(intakes.create(h.project.id,input,OWNER).id,created.id);assert.equal(h.state.issuePosts,1);
});

test('connected coordinator sends the shared frozen context and a genuine read-only knowledge lease that revokes after completion',async t=>{
  const h=await fixture(t);h.engine.goalPlanner=h.execution.planner;h.state.taskListGate=h.taskGate.promise;h.state.taskResult=()=>JSON.stringify({action:'answer',rationale:'The synthetic source was inspected.',expectedGain:'A bounded informational answer.',tasks:[],response:'The ACK_RECEIPT source remains available.'});
  const content=Array.from({length:220},()=> 'Unrelated horticultural notes.').join('\n')+'\n## Receipt evidence\nACK_RECEIPT persists after refresh failure.';
  const entry:KnowledgeEntry={id:'synthetic-deep-context',projectId:h.project.id,sourceId:'synthetic-source',kind:'document',roles:[],title:'Receipt maintenance',content,hash:createHash('sha256').update(content).digest('hex'),revision:1,syncedAt:'2026-01-01T00:00:00Z',status:'current'};h.engine.store.put('knowledge',entry);
  const intake=new IntakeService(h.engine),goal=intake.create(h.project.id,{request:'Explain ACK_RECEIPT persistence from the synthetic evidence.',idempotencyKey:'synthetic-knowledge-lease'},OWNER);
  await eventually(()=>h.execution.records(goal.routerRunId).some(row=>row.issueId),'the scoped coordinator assignment');
  const assigned=h.state.requests.find(request=>request.method==='POST'&&request.path==='/api/issues')!,agent=h.state.agents.get(String(assigned.body.assignee_id))!,config=(agent.mcp_config as {mcpServers:{gwi:{url:string;headers:Record<string,string>}}}).mcpServers.gwi;
  assert.ok(config?.url);const record=h.engine.contextRecord(goal.routerRunId,'supervise')!;assert.ok(record.plan.evidence.some(item=>item.content.includes('ACK_RECEIPT')));assert.ok(String(assigned.body.description).includes(record.plan.context));
  let sequence=0;const rpc=async(method:string,params:unknown)=>{const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});assert.equal(response.status,200);return response.json();};
  const tools=await rpc('tools/list',{});assert.deepEqual(tools.result.tools.map((tool:{name:string})=>tool.name).sort(),['gwi_context_read','gwi_knowledge_search']);
  const searched=await rpc('tools/call',{name:'gwi_knowledge_search',arguments:{query:'ACK_RECEIPT',format:'v2'}}),page=JSON.parse(searched.result.content[0].text);assert.ok(page.matches[0].content.includes('ACK_RECEIPT'));assert.ok(page.matches[0].locator.startLine>200);
  const read=await rpc('tools/call',{name:'gwi_knowledge_search',arguments:{read:page.matches[0].locator}});assert.ok(JSON.parse(read.result.content[0].text).passage.content.includes('ACK_RECEIPT'));assert.equal(h.engine.contextRecord(goal.routerRunId,'supervise')?.reads.length,2);
  const refused=await rpc('tools/call',{name:'gwi_intake_route',arguments:{action:'complete'}});assert.equal(refused.result.isError,true,'The connected coordinator has no second routing authority.');
  h.taskGate.resolve();await eventually(()=>intake.list(h.project.id)[0].status==='completed','the acknowledged informational answer');
  const expired=await fetch(config.url,{method:'POST',headers:{...config.headers,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/list',params:{}})});assert.equal(expired.status,401);
});

function accountLifecycle(h:Fixture){
  const begins:{runId:string;stageId:string;model:string|null;issuePosts:number}[]=[],finishes:{id:string;value:AllowanceFinish}[]=[];
  const control={beginError:undefined as AppError|undefined,beginGate:undefined as Promise<void>|undefined,finishErrors:0};
  h.engine.beginAccountExecution=async(runId,stageId,model)=>{begins.push({runId,stageId,model:model??null,issuePosts:h.state.issuePosts});await control.beginGate;if(control.beginError)throw control.beginError;const execution:AllowanceExecution={id:'synthetic-allowance-execution-'+begins.length,target:{projectId:h.project.id,pipelineId:'synthetic-pipeline',stageId,roleId:'development',model:model??null,effort:'max',kind:stageId==='supervise'?'planner':'stage',runId},before:{id:'SYNTHETIC_PRIVATE_OBSERVATION',status:'available',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),source:'local-codex',windows:[],exhausted:false,accountKey:'SYNTHETIC_PRIVATE_ACCOUNT_KEY'},startedAt:new Date().toISOString()};return execution;};
  h.engine.finishAccountExecution=async(id,value)=>{finishes.push({id,value:structuredClone(value)});if(control.finishErrors-->0)throw new Error('SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD');};
  return{begins,finishes,control};
}
function storedAdapterRun(h:Fixture){
  const input=h.input(),at=new Date().toISOString(),pipeline=structuredClone(h.engine.detail(h.project.id,OWNER).pipelines[0]);pipeline.stages=[{id:input.stageId,name:'Synthetic external worker',roleId:input.role.id,executor:'codex',dependsOn:[],prompt:'Use only synthetic input.',review:false}];
  const run:Run={id:input.runId,projectId:h.project.id,pipelineId:pipeline.id,goal:'Synthetic external execution scope.',baseline:'Synthetic committed input.',trigger:{kind:'human',actor:OWNER.name},status:'failed',iteration:1,mode:'once',createdAt:at,updatedAt:at,endedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-adapter-scope',inputHash:'synthetic-adapter-hash',snapshot:{project:structuredClone(h.project),pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:input.stageId,status:'failed',attempts:[{id:input.attemptId,number:1,iteration:1,status:'failed',provider:'multica',startedAt:at,endedAt:at,error:'Synthetic external observation needs reconciliation.'}]}]};h.engine.store.put('run',run);return run;
}

test('account observation brackets paid assignment with the resolved model and persists no private snapshot',async t=>{
  const h=await fixture(t),account=accountLifecycle(h);storedAdapterRun(h);h.state.taskListGate=h.taskGate.promise;
  const input=h.input(),started=await h.execution.agent.start({...input,role:{...input.role,model:null}});
  assert.deepEqual(account.begins,[{runId:input.runId,stageId:input.stageId,model:'synthetic-model',issuePosts:0}]);assert.equal(account.finishes.length,0);
  const active=h.execution.records(input.runId)[0];assert.equal(active.allowanceExecutionId,'synthetic-allowance-execution-1');assert.equal(active.cleanupConfirmed,false);assert.equal(active.allowanceFinishedAt,undefined);
  for(const secret of ['SYNTHETIC_PRIVATE_OBSERVATION','SYNTHETIC_PRIVATE_ACCOUNT_KEY'])assert.equal(JSON.stringify(active).includes(secret),false);
  h.taskGate.resolve();assert.deepEqual((await started.completion).output,OUTPUT);assert.deepEqual(account.finishes,[{id:'synthetic-allowance-execution-1',value:{status:'completed',dispatched:true,usage:{input:420,output:20,cachedInput:300,total:440}}}]);
  const ended=h.execution.records(input.runId)[0];assert.ok(ended.allowanceFinishedAt);assert.equal(ended.allowanceFinishError,undefined);await h.execution.reconcile(input.runId,input.stageId);assert.equal(account.finishes.length,1);assert.equal(h.execution.records(input.runId)[0].allowanceFinishedAt,ended.allowanceFinishedAt);
});

test('account exhaustion or a changed observation rejects assignment without creating an execution sample',async t=>{
  for(const failure of ['ACCOUNT_ALLOWANCE_EXHAUSTED','ACCOUNT_ALLOWANCE_CONFLICT'])await t.test(failure,async sub=>{
    const h=await fixture(sub),account=accountLifecycle(h);account.control.beginError=new AppError(failure,'Synthetic account admission rejected.',409);
    await assert.rejects(h.execution.agent.start(h.input()),code(failure));assert.equal(h.state.issuePosts,0);assert.equal(h.state.tasks.size,0);assert.equal(account.finishes.length,0);
    const record=h.execution.records('synthetic-run')[0];assert.equal(record.status,'not_dispatched');assert.equal(record.cleanupConfirmed,true);assert.equal(record.allowanceExecutionId,undefined);
  });
});

test('Stop while the fresh account check is pending releases only a confirmed unassigned observation',async t=>{
  const h=await fixture(t),account=accountLifecycle(h),gate=deferred<void>(),controller=new AbortController();account.control.beginGate=gate.promise;
  const starting=h.execution.agent.start(h.input({signal:controller.signal})),rejected=assert.rejects(starting,code('EXECUTION_CANCELLED'));await eventually(()=>account.begins.length===1,'the account check before assignment');controller.abort();gate.resolve();await rejected;
  assert.equal(h.state.issuePosts,0);assert.deepEqual(account.finishes,[{id:'synthetic-allowance-execution-1',value:{status:'not_dispatched',dispatched:false}}]);const record=h.execution.records('synthetic-run')[0];assert.equal(record.status,'not_dispatched');assert.equal(record.cleanupConfirmed,true);assert.ok(record.allowanceFinishedAt);
});

test('a known rejected assignment finishes as unassigned while uncertain responses retain their active account observation',async t=>{
  for(const response of ['active_duplicate_issue','another_conflict','lost-response'] as const)await t.test(response,async sub=>{
    const h=await fixture(sub),account=accountLifecycle(h);storedAdapterRun(h);
    if(response==='lost-response')h.state.loseIssueResponse=true;else h.state.issueRejection={code:response,status:409};await assert.rejects(h.execution.agent.start(h.input()));
    const before=h.execution.records('synthetic-run')[0];assert.equal(before.allowanceExecutionId,'synthetic-allowance-execution-1');assert.equal(account.finishes.length,response==='active_duplicate_issue'?1:0);
    if(response==='active_duplicate_issue'){assert.deepEqual(account.finishes[0].value,{status:'not_dispatched',dispatched:false});await h.execution.reconcile('synthetic-run','work');assert.equal(account.finishes.length,1);}
    else{assert.equal(before.cleanupConfirmed,false);assert.equal(before.allowanceFinishedAt,undefined);}
    if(response==='lost-response'){const reconciled=await h.execution.reconcile('synthetic-run','work');assert.equal(reconciled.cleanupConfirmed,true);assert.ok(reconciled.allowanceFinishedAt);assert.equal(account.finishes.length,1);assert.equal(account.finishes[0].value.dispatched,true);assert.equal(h.state.issuePosts,1);await h.execution.reconcile('synthetic-run','work');assert.equal(account.finishes.length,1);}
  });
});

test('terminal-looking execution without cleanup proof retains account observation until exact reconciliation',async t=>{
  const h=await fixture(t),account=accountLifecycle(h);storedAdapterRun(h);h.state.taskStatus='failed';h.state.taskResult=()=>undefined;
  const started=await h.execution.agent.start(h.input());await assert.rejects(started.completion,code('EXTERNAL_RECONCILIATION_REQUIRED'));assert.equal(account.finishes.length,0);assert.equal(h.execution.records('synthetic-run')[0].cleanupConfirmed,false);
  h.state.tasks.get(started.ref.issueId!)![0].result={receipt:'Synthetic terminal failure receipt.'};const reconciled=await h.execution.reconcile('synthetic-run','work');assert.equal(reconciled.cleanupConfirmed,true);assert.equal(account.finishes.length,1);assert.equal(account.finishes[0].value.status,'failed');assert.equal(account.finishes[0].value.dispatched,true);
});

test('failed ending account observations retain a sanitized retry marker without replacing the actual task result',async t=>{
  const h=await fixture(t),account=accountLifecycle(h);storedAdapterRun(h);account.control.finishErrors=1;
  const started=await h.execution.agent.start(h.input());assert.deepEqual((await started.completion).output,OUTPUT);
  const pending=h.execution.records('synthetic-run')[0];assert.equal(pending.cleanupConfirmed,true);assert.equal(pending.allowanceFinishedAt,undefined);assert.equal(pending.allowanceFinishError,'ACCOUNT_OBSERVATION_PENDING');assert.equal(JSON.stringify(pending).includes('SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD'),false);
  const reconciled=await h.execution.reconcile('synthetic-run','work');assert.ok(reconciled.allowanceFinishedAt);assert.equal(reconciled.allowanceFinishError,undefined);assert.equal(account.finishes.length,2);assert.equal(h.state.issuePosts,1);await h.execution.reconcile('synthetic-run','work');assert.equal(account.finishes.length,2);
});

test('planner account observations use the canonical supervise stage and resolved inherited model',async t=>{
  const h=await fixture(t),account=accountLifecycle(h);h.state.taskResult=()=>JSON.stringify({action:'stop',rationale:'Synthetic bounded decision ended.',expectedGain:'No new paid work.',tasks:[]});
  const started=await h.execution.planner.start({project:h.project,pipelines:[],knowledge:[],request:'Make one synthetic coordination decision.',baseline:'Synthetic source.',rounds:[],observations:[],remaining:{tokens:1000,seconds:5,rounds:1},signal:new AbortController().signal,onEvent(){},executionId:'synthetic-planner-allowance'});await started.completion;
  assert.deepEqual(account.begins,[{runId:'synthetic-planner-allowance',stageId:'supervise',model:'synthetic-model',issuePosts:0}]);assert.equal(h.execution.records('synthetic-planner-allowance')[0].stageId,'decision-1');assert.equal(account.finishes.length,1);assert.equal(account.finishes[0].value.dispatched,true);
});

test('account-mode planner context uses shared allowance evidence and keeps technical token safeguards out of its allowance',async t=>{
  const h=await fixture(t);accountLifecycle(h);h.state.taskResult=()=>JSON.stringify({action:'stop',rationale:'Synthetic observation reviewed.',expectedGain:'No further synthetic action.',tasks:[]});
  const at=new Date().toISOString(),account:AllowanceAssessment={key:'SYNTHETIC_OWNER_APPROVAL_KEY',status:'learning',code:'ACCOUNT_ALLOWANCE_LEARNING',action:'continue',activeExecutions:0,account:{id:'SYNTHETIC_PRIVATE_OBSERVATION_ID',status:'available',source:'local-codex',observedAt:at,expiresAt:new Date(Date.now()+60000).toISOString(),exhausted:false,windows:[{bucketId:'synthetic-codex',slot:'primary',usedPercent:30,remainingPercent:70,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}]},trend:{sampleCount:2,comparableCount:2,direction:'unknown',windows:[],attribution:'shared-account-observation',reasons:['INSUFFICIENT_SAMPLES','SHARED_ACCOUNT_ACTIVITY']}};
  const started=await h.execution.planner.start({project:h.project,pipelines:[],knowledge:[],request:'Inspect synthetic allowance context.',baseline:'Synthetic source.',rounds:[],observations:[],resourceMode:'account',account,remaining:{tokens:1000000,seconds:5,rounds:2},signal:new AbortController().signal,onEvent(){},executionId:'synthetic-planner-account-context'});await started.completion;
  const description=String(h.state.requests.find(request=>request.method==='POST'&&request.path==='/api/issues')!.body.description),brief=JSON.parse(description.split('\n').find(line=>line.startsWith('{"request":'))!) as {resourceMode:string;remaining:{tokens?:number;seconds:number;rounds:number};account:{windows:unknown[];trend:unknown}};
  assert.equal(brief.resourceMode,'account');assert.equal(Object.hasOwn(brief,'remaining'),false);assert.deepEqual(brief.account.windows,account.account.windows);assert.deepEqual(brief.account.trend,account.trend);assert.match(description,/Do not convert token diagnostics/);
  for(const privateValue of ['SYNTHETIC_OWNER_APPROVAL_KEY','SYNTHETIC_PRIVATE_OBSERVATION_ID'])assert.equal(description.includes(privateValue),false);
});

test('configured runtime policy alone does not claim an observed native execution limit',async t=>{
  const h=await fixture(t);assert.equal(h.platform.executionLimits().nativeTaskLimit,'unknown');
  assert.equal(h.platform.executionLimits().configuredExecutionPolicy,SUPERVISED_EXECUTION_POLICY);
  h.state.runtimeHealth.gwi_supervised_execution=false;
  await assert.rejects(h.platform.runtime(undefined,true),code('RUNTIME_EXECUTION_POLICY_REQUIRED'));
  assert.equal(h.platform.executionLimits().nativeTaskLimit,'unknown');
});

test('dispatch checks the actual serving execution policy without requiring an idle daemon',async t=>{
  for(const [field,value] of [['gwi_supervised_execution',false],['gwi_execution_patch_sha','synthetic-old-patch'],['gwi_agent_timeout_disabled',false],['gwi_idle_watchdog_disabled',false],['gwi_tool_watchdog_disabled',false],['pid',1],['profile','another-profile'],['daemon_id','another-daemon'],['cli_commit','another-source']])await t.test(String(field),async sub=>{
    const h=await fixture(sub);h.state.runtimeHealth[String(field)]=value;
    await assert.rejects(h.execution.agent.start(h.input()),code('RUNTIME_EXECUTION_POLICY_REQUIRED'));
    assert.equal(h.state.issuePosts,0);assert.equal(h.state.agents.size,0);
  });
  const h=await fixture(t);h.state.runtimeHealth.active_task_count=12;
  const started=await h.execution.agent.start(h.input());await started.completion;assert.equal(h.state.issuePosts,1);
});

test('a previously verified runtime with an old execution policy cannot reintroduce hidden quotas', async t => {
  const h=await fixture(t),old=new Platform(h.engine,h.connection,h.platform.dataDirectory,'synthetic-model',{runtimeId:'synthetic-runtime',daemonId:'synthetic-daemon',verified:true,permissionEvidence:'Synthetic previously verified permissions.',permissions:{readOnly:{name:'gwi-readonly',verified:true},workspaceWrite:{name:'gwi-workspace',verified:true}}},h.client);
  const executor=new PlatformExecution(old);await assert.rejects(executor.agent.start(h.input()),code('RUNTIME_EXECUTION_POLICY_REQUIRED'));
  assert.equal(h.state.issuePosts,0);assert.equal(h.state.agents.size,0);
});

test('permission profile names alone never authorize execution without verified effective protections', async t => {
  const h = await fixture(t);
  const unverified = new Platform(h.engine, h.connection, h.platform.dataDirectory, 'synthetic-model', {runtimeId: 'synthetic-runtime', daemonId: 'synthetic-daemon', permissionEvidence: 'A name list is not permission verification.', permissionProfiles: ['gwi-readonly', 'gwi-workspace'], authorizedRootsFile: path.join(h.directory, 'synthetic-runtime-roots.json')}, h.client);
  const execution = new PlatformExecution(unverified);
  await assert.rejects(execution.agent.start(h.input()), code('RUNTIME_VERIFICATION_REQUIRED'));
  assert.equal(h.state.issuePosts, 0); assert.equal(h.state.agents.size, 0);
});

test('review uses actual prepared bytes in an independent task-scoped writable copy while leaving the role and originals unchanged',async t=>{
  const h=await fixture(t),checkout=await h.platform.workspaces.ensure(h.project,'synthetic-run');
  await writeFile(path.join(checkout.path,'tracked.txt'),'Actual prepared review bytes.\n');await writeFile(path.join(checkout.path,'new-source.ts'),'export const reviewInput = true;\n');
  const qa={...h.project.roles.find(role=>role.id==='qa')!,model:'synthetic-model'},beforeRole=structuredClone(qa),events:{type:string;data?:unknown}[]=[];
  h.state.taskListGate=h.taskGate.promise;
  const started=await h.execution.agent.start(h.input({role:qa,executionPurpose:'review',onEvent:event=>events.push(event)}));
  const record=h.execution.records('synthetic-run')[0],copy=h.platform.workspaces.verification('synthetic-attempt');
  assert.equal(record.verification?.manifestHash,copy.manifest.sha256);assert.equal(record.verification?.scope.modelTurnStarted,false);assert.equal(record.verification?.scope.readIsolation,false);
  assert.equal(await readFile(path.join(copy.path,'tracked.txt'),'utf8'),'Actual prepared review bytes.\n');assert.equal(await readFile(path.join(copy.path,'new-source.ts'),'utf8'),'export const reviewInput = true;\n');
  assert.notEqual(copy.path,checkout.path);assert.notEqual(copy.path,h.project.workspace);assert.deepEqual(qa,beforeRole);assert.equal(h.engine.project(h.project.id).roles.find(role=>role.id==='qa')?.sandbox,'read-only');
  const worker=h.state.agents.get(started.ref.agentId!)!;assert.ok(worker.custom_args?.includes('default_permissions="gwi-workspace"'));assert.match(worker.instructions!,/\.gwi-verification\//);
  const basis=[...h.state.agents.values()].find(agent=>agent.id!==worker.id&&agent.custom_args?.includes('default_permissions="gwi-readonly"'));assert.ok(basis);
  assert.equal(h.state.scopeProbes.length,1);assert.equal(h.state.scopeProbes[0].workspace,copy.path);assert.equal(path.dirname(h.state.scopeProbes[0].executionFile),await realpath(checkout.path));assert.equal(path.dirname(h.state.scopeProbes[0].projectFile),await realpath(h.project.workspace));
  await mkdir(path.join(copy.path,'.gwi-verification'));await writeFile(path.join(copy.path,'.gwi-verification','scratch.txt'),'Synthetic build scratch.');
  h.taskGate.resolve();assert.deepEqual((await started.completion).output,OUTPUT);
  assert.equal(await lstat(copy.path).catch(()=>null),null);assert.equal(h.execution.records('synthetic-run')[0].verification?.check?.unchanged,true);assert.deepEqual(events.filter(event=>event.type.startsWith('verification.')).map(event=>event.type),['verification.prepared','verification.checked']);
  assert.equal(await readFile(path.join(checkout.path,'tracked.txt'),'utf8'),'Actual prepared review bytes.\n');assert.equal(await readFile(path.join(h.project.workspace,'tracked.txt'),'utf8'),'Committed synthetic workspace.\n');
  const capability=(await h.platform.team(h.project.id,OWNER)).capabilities.verification;assert.equal(capability.available,true);assert.equal(capability.requiresProbe,true);assert.equal(capability.sourceProtection,'probe-required');assert.equal(capability.readIsolation,false);assert.equal(capability.networkDomainRestriction,false);
});

test('review capability and failed scope probes stop before agent assignment without broader permission fallback',async t=>{
  for(const variant of ['missing-capability','unsafe-scope'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub),input=h.input({executionPurpose:'review',role:{...h.project.roles.find(role=>role.id==='qa')!,model:'synthetic-model'}});
    const execution=variant==='missing-capability'?new PlatformExecution(new Platform(h.engine,h.connection,h.platform.dataDirectory,'synthetic-model',{runtimeId:'synthetic-runtime',daemonId:'synthetic-daemon',verified:true,executionPolicy:SUPERVISED_EXECUTION_POLICY,executionPatchSha256:MULTICA_EXECUTION_PATCH_SHA256,daemon:h.platform.executionIdentity(),permissionEvidence:'Synthetic existing setup.',permissions:{readOnly:{name:'gwi-readonly',verified:true},workspaceWrite:{name:'gwi-workspace',verified:true}}},h.client)):h.execution;
    if(variant==='unsafe-scope')h.state.scopeProbeError=new AppError('VERIFICATION_SCOPE_UNSAFE','Synthetic probe did not deny an original source write.',409);
    await assert.rejects(execution.agent.start(input),code(variant==='missing-capability'?'VERIFICATION_CAPABILITY_UNAVAILABLE':'VERIFICATION_SCOPE_UNSAFE'));
    assert.equal(h.state.issuePosts,0);assert.equal(h.state.agents.size,0);assert.equal(execution.records(input.runId)[0].status,'not_dispatched');assert.equal(execution.records(input.runId)[0].cleanupConfirmed,true);
    if(variant==='unsafe-scope'){const copy=h.platform.workspaces.verification(input.attemptId);assert.ok(copy.disposedAt);assert.equal(await lstat(copy.path).catch(()=>null),null);}
    assert.equal(h.engine.project(h.project.id).roles.find(role=>role.id==='qa')?.sandbox,'read-only');
  });
});

test('mutating prepared source in a verification task rejects its otherwise successful result and retains integrity evidence',async t=>{
  const h=await fixture(t);h.state.taskListGate=h.taskGate.promise;
  const started=await h.execution.agent.start(h.input({executionPurpose:'review'})),copy=h.platform.workspaces.verification('synthetic-attempt');
  await writeFile(path.join(copy.path,'tracked.txt'),'Reviewer changed prepared source.\n');h.taskGate.resolve();
  await assert.rejects(started.completion,code('VERIFICATION_SOURCE_MUTATED'));
  const record=h.execution.records('synthetic-run')[0];assert.equal(record.cleanupConfirmed,true);assert.equal(record.issueState,'cancelled');assert.equal(record.verification?.check?.unchanged,false);assert.deepEqual(record.verification?.check?.changed,['tracked.txt']);assert.equal(await lstat(copy.path).catch(()=>null),null);
  assert.equal(await readFile(path.join(copy.executionPath,'tracked.txt'),'utf8'),'Committed synthetic workspace.\n');assert.equal(await readFile(path.join(h.project.workspace,'tracked.txt'),'utf8'),'Committed synthetic workspace.\n');
});

test('private verification scratch may contain a nested repository without becoming prepared source',async t=>{
  const h=await fixture(t);h.state.taskListGate=h.taskGate.promise;
  const started=await h.execution.agent.start(h.input({executionPurpose:'review'})),copy=h.platform.workspaces.verification('synthetic-attempt');
  const nested=path.join(copy.path,'.gwi-verification','synthetic-repository');await mkdir(nested,{recursive:true});await execute('git',['init','--quiet','--template=',nested]);await writeFile(path.join(nested,'private.txt'),'Synthetic scratch, never source evidence.');
  h.taskGate.resolve();assert.deepEqual((await started.completion).output,OUTPUT);
  const check=h.execution.records('synthetic-run')[0].verification!.check!;assert.equal(check.unchanged,true);assert.deepEqual(check.changed,[]);assert.equal(await lstat(copy.path).catch(()=>null),null);
});

test('provider failure remains primary when independent source observation fails or finds changes',async t=>{
  for(const variant of ['unchanged','changed','unavailable','observation-error'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub);h.state.taskListGate=h.taskGate.promise;h.state.taskStatus='failed';h.state.taskResult=()=>({receipt:'Synthetic authoritative terminal receipt.'});
    const events:{type:string;message:string}[]=[],started=await h.execution.agent.start(h.input({executionPurpose:'review',onEvent:event=>events.push(event)})),copy=h.platform.workspaces.verification('synthetic-attempt');
    const failure='Synthetic provider declined this execution.';h.state.tasks.get(started.ref.issueId!)![0].error=failure;
    if(variant==='changed')await writeFile(path.join(copy.path,'tracked.txt'),'Synthetic changed source.');
    if(variant==='unavailable')h.platform.workspaces.checkVerification=async()=>({unchanged:false,manifestHash:copy.manifest.sha256,changed:[],errorCode:'SYNTHETIC_INTEGRITY_UNAVAILABLE'});
    if(variant==='observation-error')h.platform.workspaces.checkVerification=async()=>{throw new Error('Synthetic observation unavailable.');};
    h.taskGate.resolve();await assert.rejects(started.completion,error=>error instanceof AppError&&error.code==='MULTICA_TASK_FAILED'&&error.message===failure);
    const record=h.execution.records('synthetic-run')[0];assert.equal(record.cleanupConfirmed,true);assert.equal(record.error,failure);assert.equal(record.issueState,'cancelled');assert.equal(h.state.issuePosts,1);
    if(variant==='observation-error'){assert.equal(record.verification!.observationError,'VERIFICATION_OBSERVATION_FAILED');assert.ok(events.some(event=>event.type==='verification.unavailable'));await h.platform.workspaces.disposeVerification(copy.id);}
    else{assert.equal(await lstat(copy.path).catch(()=>null),null);assert.equal(record.verification!.check!.unchanged,variant==='unchanged');if(variant==='unavailable'){assert.equal(record.verification!.check!.errorCode,'SYNTHETIC_INTEGRITY_UNAVAILABLE');assert.ok(events.some(event=>event.type==='verification.checked'&&event.message.includes('could not be established')));assert.equal(events.some(event=>event.message.includes('Verification changed')),false);}}
  });
});

test('an otherwise completed verifier with unavailable integrity is unverified rather than called a source mutation',async t=>{
  const h=await fixture(t);h.state.taskListGate=h.taskGate.promise;
  const started=await h.execution.agent.start(h.input({executionPurpose:'review'})),copy=h.platform.workspaces.verification('synthetic-attempt');
  h.platform.workspaces.checkVerification=async()=>({unchanged:false,manifestHash:copy.manifest.sha256,changed:[],errorCode:'SYNTHETIC_UNAVAILABLE'});
  h.taskGate.resolve();await assert.rejects(started.completion,code('VERIFICATION_INTEGRITY_UNAVAILABLE'));
  assert.equal(h.execution.records('synthetic-run')[0].verification!.check!.errorCode,'SYNTHETIC_UNAVAILABLE');assert.equal(await lstat(copy.path).catch(()=>null),null);
});

test('an uncertain external review keeps its copy until authoritative reconciliation',async t=>{
  const h=await fixture(t);h.state.taskListError=true;h.engine.agentExecutor=h.execution.agent;
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic uncertain review'},OWNER),flow=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'work',name:'Review prepared source',roleId:'qa',executor:'codex',executionPurpose:'review',dependsOn:[],prompt:'Perform the bounded source review.',review:false}]},OWNER);
  const run=h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Inspect prepared source.',baseline:'Synthetic committed source.',idempotencyKey:'synthetic-uncertain-review'},OWNER);
  await eventually(()=>h.engine.run(run.id).status==='failed','the uncertain external review');
  const record=h.execution.records(run.id)[0],copy=h.platform.workspaces.verification(record.id);assert.ok(await lstat(copy.path));assert.equal(record.cleanupConfirmed,false);
  h.state.taskListError=false;const reconciled=await h.execution.reconcile(run.id,'work');assert.equal(reconciled.cleanupConfirmed,true);assert.equal(reconciled.verification?.check?.unchanged,true);assert.equal(await lstat(copy.path).catch(()=>null),null);
});

test('a lost review assignment is discovered only in its exact persisted verification project',async t=>{
  const h=await fixture(t);h.state.loseIssueResponse=true;h.engine.agentExecutor=h.execution.agent;
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic lost review assignment'},OWNER),flow=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'verify',name:'Review prepared source',roleId:'qa',executor:'codex',executionPurpose:'review',dependsOn:[],prompt:'Perform bounded review.',review:false}]},OWNER),run=h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Verify prepared source.',baseline:'Synthetic source.',idempotencyKey:'synthetic-lost-review'},OWNER);
  await eventually(()=>h.engine.run(run.id).status==='failed','the lost review assignment');const before=h.execution.records(run.id)[0],copy=h.platform.workspaces.verification(before.id);assert.equal(before.issueId,undefined);assert.ok(await lstat(copy.path));assert.equal(h.state.issuePosts,1);
  const reconciled=await h.execution.reconcile(run.id,'verify');assert.equal(reconciled.cleanupConfirmed,true);assert.ok(reconciled.issueId);assert.equal(reconciled.verification?.check?.unchanged,true);assert.equal(await lstat(copy.path).catch(()=>null),null);assert.equal(h.state.issuePosts,1);assert.equal(h.engine.run(run.id).stages[0].attempts[0].output,undefined);
});

test('native verification scope protocol uses command-only probes and rejects successful outside write opens',async t=>{
  for(const unsafe of [false,true])await t.test(unsafe?'outside write allowed':'outside writes denied',async sub=>{
    const directory=await mkdtemp(path.join(tmpdir(),'gwi-scope-protocol-')),workspace=path.join(directory,'copy'),calls=path.join(directory,'calls.jsonl'),binary=path.join(directory,'guard'),script=path.join(directory,'guard.mjs');await mkdir(workspace);
    sub.after(()=>rm(directory,{recursive:true,force:true}));
    const original=path.join(directory,'original.txt'),sibling=path.join(directory,'sibling.txt');await writeFile(original,'Synthetic original bytes.\n');await writeFile(sibling,'Synthetic sibling bytes.\n');
    await writeFile(script,`import {createInterface} from 'node:readline';\nimport {appendFileSync} from 'node:fs';\nimport {execFileSync} from 'node:child_process';\nfor await(const line of createInterface({input:process.stdin})){const message=JSON.parse(line);appendFileSync(${JSON.stringify(calls)},JSON.stringify(message)+'\\n');if(message.id===undefined)continue;let result={};if(message.method==='command/exec'){const text=message.params.command[2];if(text.startsWith('printf ')){execFileSync('/bin/sh',['-c',text],{cwd:message.params.cwd});result={exitCode:0};}else result={exitCode:${unsafe?0:1}};}process.stdout.write(JSON.stringify({id:message.id,result})+'\\n');}\n`);
    const shell=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";await writeFile(binary,'#!/bin/sh\nexec '+shell(process.execPath)+' '+shell(script)+' "$@"\n',{mode:0o700});await chmod(binary,0o700);
    const promise=probeVerificationScope({guardBinary:binary,scratchHome:path.join(directory,'synthetic-home'),workspace,executionFile:original,projectFile:original,siblingFile:sibling,network:'enabled'});
    if(unsafe)await assert.rejects(promise,code('VERIFICATION_SCOPE_UNSAFE'));else{const proof=await promise;assert.equal(proof.copyWrite,true);assert.equal(proof.modelTurnStarted,false);assert.equal(proof.executionWriteDenied,true);assert.equal(proof.readIsolation,false);}
    const methods=(await readFile(calls,'utf8')).trim().split('\n').map(line=>(JSON.parse(line) as {method:string}).method);assert.ok(methods.every(method=>['initialize','initialized','command/exec'].includes(method)));assert.equal(methods.includes('turn/start'),false);assert.equal(methods.filter(method=>method==='command/exec').length,unsafe?2:4);
    assert.equal(await readFile(original,'utf8'),'Synthetic original bytes.\n');assert.equal(await readFile(sibling,'utf8'),'Synthetic sibling bytes.\n');
  });
});

test('live protected runtime confines a synthetic verification copy without a model turn',{skip:!process.env.GWI_VERIFICATION_PROFILE},async t=>{
  const profileFile=path.resolve(process.env.GWI_VERIFICATION_PROFILE!),profileBytes=await readFile(profileFile),profile=JSON.parse(profileBytes.toString()) as {verified?:boolean;guardBinary:string;scratchHome:string;authorizedRootsFile:string;permissions?:{workspaceWrite?:{name:string;verified?:boolean;network?:string}}};
  assert.equal(profile.verified,true);assert.equal(profile.permissions?.workspaceWrite?.name,'gwi-workspace');assert.equal(profile.permissions?.workspaceWrite?.verified,true);
  const rootsBytes=await readFile(profile.authorizedRootsFile),roots=JSON.parse(rootsBytes.toString()) as {roots:string[]};assert.ok(Array.isArray(roots.roots)&&roots.roots.length>0);
  const authorizedRoot=await realpath(roots.roots[0]),configFile=path.join(profile.scratchHome,'config.toml'),configBytes=await readFile(configFile);
  const setupModule='../scripts/setup-multica.mjs',setup=await import(setupModule);assert.equal(setup.stripManagedSandbox(configBytes.toString()),configBytes.toString(),'The live probe requires a current seed config that the guard will not rewrite.');
  const directory=await mkdtemp(path.join(authorizedRoot,'gwi-verification-live-')),source=path.join(directory,'source');await mkdir(source);
  const store=new Store(path.join(directory,'state'));t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});assert.deepEqual(await readFile(profileFile),profileBytes);assert.deepEqual(await readFile(profile.authorizedRootsFile),rootsBytes);assert.deepEqual(await readFile(configFile),configBytes);});
  await execute('git',['-C',source,'init','--template=']);await writeFile(path.join(source,'source.ts'),'export const value = 1;\n');await execute('git',['-C',source,'add','--','source.ts']);await execute('git',['-C',source,'-c','core.hooksPath=/dev/null','-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','commit','-m','Create synthetic scope input']);
  const project:Project={id:'synthetic-live-project',revision:1,name:'Synthetic live scope probe',description:'',workspace:source,repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},workspaces=new Workspaces(store,path.join(directory,'executions')),checkout=await workspaces.ensure(project,'synthetic-live-run');
  await writeFile(path.join(checkout.path,'source.ts'),'export const value = 2;\n');await writeFile(path.join(checkout.path,'prepared.ts'),'export const prepared = true;\n');
  const copy=await workspaces.prepareVerification(project,checkout.id,'synthetic-live-attempt'),siblingFile=path.join(directory,'sibling.txt');await writeFile(siblingFile,'Synthetic sibling probe.\n');
  const proof=await probeVerificationScope({guardBinary:profile.guardBinary,scratchHome:profile.scratchHome,workspace:copy.path,executionFile:path.join(checkout.path,'source.ts'),projectFile:path.join(source,'source.ts'),siblingFile,network:profile.permissions?.workspaceWrite?.network==='enabled'?'enabled':'unknown'});
  assert.equal(proof.copyWrite,true);assert.equal(proof.executionWriteDenied,true);assert.equal(proof.projectWriteDenied,true);assert.equal(proof.siblingWriteDenied,true);assert.equal(proof.modelTurnStarted,false);assert.equal(proof.readIsolation,false);assert.equal(proof.networkDomainRestriction,false);
  assert.equal(await readFile(path.join(checkout.path,'source.ts'),'utf8'),'export const value = 2;\n');assert.equal(await readFile(path.join(source,'source.ts'),'utf8'),'export const value = 1;\n');assert.equal((await workspaces.checkVerification(copy.id)).unchanged,true);await workspaces.disposeVerification(copy.id);
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

test('governance metadata alone reuses a prepared agent while a real contract change creates a revision',async t=>{
  const h=await fixture(t),role={...h.project.roles.find(value=>value.id==='development')!,model:'synthetic-model'},first=await h.platform.agent(h.project,role,false),before=structuredClone(h.state.agents.get(first.id)!),count=h.state.agents.size;
  const governed={...role,origin:{kind:'template' as const,template:{id:'synthetic-template',revision:2,hash:'synthetic-hash'}},templateBindingId:'synthetic-project-binding'},same=await h.platform.agent(h.project,governed,false);
  assert.equal(same.id,first.id);assert.equal(h.state.agents.size,count);assert.deepEqual(h.state.agents.get(first.id),before);
  const changed=await h.platform.agent(h.project,{...governed,instructions:'A revised bounded working contract.'},false);assert.notEqual(changed.id,first.id);assert.match(changed.instructions!,/revised bounded working contract/);assert.equal(h.state.issuePosts,0);assert.equal(h.state.tasks.size,0);
});

test('duplicating a role preserves explicit or inherited capability bindings in a new immutable agent revision',async t=>{
  for(const selection of ['explicit','inherited','empty'] as const)await t.test(selection,async sub=>{
    const h=await fixture(sub),template:MulticaAgent={id:'synthetic-shared-template',workspace_id:WORKSPACE,status:'active',name:'Synthetic shared template',description:'An independently authored reusable template.',model:'synthetic-model',runtime_id:'synthetic-runtime',skills:[{id:'synthetic-inherited-skill',name:'Synthetic inherited skill'}]};
    h.state.agents.set(template.id,structuredClone(template));
    const bindings:NonNullable<RoleProfile['multica']>={agentId:template.id,runtimeId:'synthetic-runtime',...(selection==='explicit'?{skillIds:['synthetic-selected-skill'],mcpServerIds:['synthetic-selected-server']}:selection==='empty'?{skillIds:[],mcpServerIds:[]}:{} )};
    const originalRole={...h.project.roles.find(value=>value.id==='development')!,multica:bindings};
    const source=await h.platform.saveRole(h.project.id,h.project.revision,originalRole,OWNER,originalRole.id),role=source.roles.find(value=>value.id===originalRole.id)!;
    const frozen=structuredClone(source),agent=structuredClone(h.state.agents.get(role.multica!.agentId!)!);
    const copied=await h.platform.duplicateRole(source.id,role.id,source.revision,OWNER),copy=copied.roles.find(value=>!source.roles.some(previous=>previous.id===value.id))!;
    assert.ok(copy);assert.notEqual(copy.id,role.id);assert.equal(copy.name,role.name+' copy');assert.equal(copy.multica?.runtimeId,role.multica?.runtimeId);
    assert.deepEqual(copy.multica?.skillIds,role.multica?.skillIds);assert.deepEqual(copy.multica?.mcpServerIds,role.multica?.mcpServerIds);
    assert.equal(Object.hasOwn(copy.multica!,'skillIds'),selection!=='inherited');assert.equal(Object.hasOwn(copy.multica!,'mcpServerIds'),selection!=='inherited');
    assert.equal(copy.sandbox,role.sandbox);assert.deepEqual(copy.tools,role.tools);assert.deepEqual(copy.skills,role.skills);assert.notEqual(copy.multica?.agentId,role.multica?.agentId);
    const copyAgent=h.state.agents.get(copy.multica!.agentId!)!;
    assert.deepEqual(copyAgent.skills?.map(skill=>skill.id),selection==='explicit'?['synthetic-selected-skill']:selection==='empty'?[]:['synthetic-inherited-skill']);
    const mcpPosts=h.state.requests.filter(request=>request.method==='POST'&&request.path===`/api/agents/${copyAgent.id}/mcp-servers`);
    assert.deepEqual(mcpPosts.map(request=>request.body.server_id),selection==='explicit'?['synthetic-selected-server']:[]);
    assert.deepEqual(h.engine.project(source.id).roles.find(value=>value.id===role.id),role);assert.deepEqual(h.state.agents.get(agent.id),agent);assert.deepEqual(source,frozen);
    await assert.rejects(h.platform.saveAgent(source.id,{instructions:'Synthetic attempt to mutate a frozen role agent.'},OWNER,copyAgent.id),code('ROLE_REVISION_IMMUTABLE'));
    assert.equal(h.state.issuePosts,0);assert.equal(h.state.tasks.size,0,'Role duplication must not start provider work.');
  });
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

test('terminal proof survives message failures and reconciliation rejects mismatched task identity without replacement', async t => {
  const h = await fixture(t); h.state.taskMessageError = true;
  h.engine.agentExecutor = h.execution.agent;
  const initial = h.engine.createPipeline({projectId: h.project.id, roleId: 'development', name: 'Synthetic scoped observation'}, OWNER), flow = h.engine.updatePipeline(initial.id, initial.revision, {...initial, stages: [{id: 'work', name: 'Observe a synthetic provider result', executor: 'codex', roleId: 'development', prompt: 'Perform only the synthetic check.', review: false, dependsOn: []}]}, OWNER);
  const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Preserve scoped synthetic execution facts.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-scoped-observation'}, OWNER);
  await eventually(() => h.engine.run(run.id).status === 'completed', 'the scoped terminal result despite optional message failure');
  assert.deepEqual(h.engine.run(run.id).stages[0].attempts[0].usage, {input: 420, output: 20, cachedInput: 300, total: 440}, 'Known task usage survives failure to read optional message details.');
  const before = h.execution.records(run.id)[0], original = structuredClone(h.state.tasks.get(before.issueId!)![0]);
  assert.equal(before.cleanupConfirmed, true); assert.equal(before.taskId, original.id);
  for (const mismatch of [{issue_id: 'another-synthetic-issue'}, {agent_id: 'another-synthetic-agent'}, {runtime_id: 'another-synthetic-runtime'}]) {
    h.state.tasks.set(before.issueId!, [{...original, ...mismatch}]);
    await assert.rejects(h.execution.reconcile(run.id, 'work'), error => error instanceof AppError);
    assert.equal(h.execution.records(run.id)[0].cleanupConfirmed, true, 'A rejected observation cannot erase the earlier exact terminal proof.');
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
  const allowances: unknown[] = [];
  h.engine.goalPlanner = {start(input) {allowances.push(input.remaining); return h.execution.planner.start(input);}}; h.engine.agentExecutor = h.execution.agent;
  const intake = new IntakeService(h.engine), item = intake.create(h.project.id, {request: 'Check the synthetic reconciliation boundary.', idempotencyKey: 'synthetic-reconcile-usage', policy: {maxTotalTokens: 10000, maxElapsedSeconds: 300}}, OWNER);
  const current = () => intake.list(h.project.id).find(value => value.id === item.id)!;
  await eventually(() => current().status === 'failed', 'the unknown initial task observation');
  const first = h.engine.run(item.routerRunId).stages[0].attempts[0]; assert.ok(first.ref?.issueId); assert.equal(first.ref?.externalId, undefined); assert.equal(first.output, undefined); assert.equal(current().canRetry, false);
  h.state.taskListError = false; await h.execution.reconcile(item.routerRunId, 'decision-1');
  assert.equal(current().canRetry, true); assert.deepEqual(h.engine.run(item.routerRunId).stages[0].attempts[0].usage, {input: 420, output: 20, cachedInput: 300, total: 440});
  await intake.retry(item.id, {model: 'synthetic-model', note: 'The exact earlier task is reconciled; retain its actual consumption.'}, OWNER);
  assert.deepEqual(allowances, [undefined, undefined]); await eventually(() => current().status === 'stopped', 'the explicit recovered decision');
  assert.equal(h.engine.run(item.routerRunId).stages[0].attempts[0].output, undefined); assert.equal(h.state.issuePosts, 2);
});

test('an issued MCP capability lasts through supervised work and is revoked after authoritative task completion and never appears in team responses', async t => {
  const h = await fixture(t), gate = h.taskGate; h.state.taskListGate = gate.promise;
  const external = {type: 'http', url: 'https://example.invalid/synthetic-tools', headers: {Authorization: 'SYNTHETIC_EXTERNAL_AUTH'}, default_tools_approval_mode: 'prompt'};
  const template: MulticaAgent = {id: 'synthetic-external-template', workspace_id: WORKSPACE, name: 'Synthetic template', runtime_id: 'synthetic-runtime', status: 'active', mcp_config: {mcpServers: {external}}}; h.state.agents.set(template.id, structuredClone(template));
  const input = h.input({timeoutSeconds:0.001,tokenBudget:1}), reported: unknown[] = [], started = await h.execution.agent.start({...input, role: {...input.role, sandbox: 'read-only', multica: {agentId: template.id, runtimeId: template.runtime_id}}, onEvent: event => {if (event.usage) reported.push(event.usage);}});
  assert.equal(started.ref.provider, 'multica'); assert.ok(started.ref.issueId); assert.equal(started.ref.externalId, undefined);
  const worker = [...h.state.agents.values()].find(agent => agent.description?.includes('Execution synthetic-attempt'))!;
  const config = worker.mcp_config as {mcpServers: {external: unknown; gwi: {url: string; headers: {Authorization: string}; default_tools_approval_mode: string}}}, authorization = config.mcpServers.gwi.headers.Authorization;
  assert.equal(Object.hasOwn(worker,'max_concurrent_tasks'),false);
  assert.equal(config.mcpServers.gwi.default_tools_approval_mode, 'approve'); assert.deepEqual(config.mcpServers.external, external); assert.deepEqual(h.state.agents.get(template.id), template);
  assert.match(worker.instructions!, /GWI owns coordination and result delivery/); assert.match(worker.instructions!, /final JSON directly/); assert.match(worker.instructions!, /Do not create Multica comments, reporting files/); assert.ok(worker.custom_args?.includes('default_permissions="gwi-readonly"'));
  const rpc = async () => fetch(config.mcpServers.gwi.url, {method: 'POST', headers: {authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
  const observedNow=Date.now();t.mock.method(Date,'now',()=>observedNow+24*60*60*1000);
  const live = await rpc(); assert.equal(live.status, 200); const listed = await live.json() as {result: {tools: {name: string}[]}}; assert.deepEqual(listed.result.tools.map(tool => tool.name), ['gwi_context_read']);
  assert.equal(JSON.stringify(await h.platform.team(h.project.id, OWNER)).includes(authorization.slice('Bearer '.length)), false);
  const task = h.state.tasks.get(started.ref.issueId!)![0]; task.status = 'running'; gate.resolve(); await eventually(() => reported.length > 0, 'the first authoritative usage report');
  task.status = 'completed'; task.usage = [{model: 'synthetic-model', input_tokens: 1, output_tokens: 1}];
  const result = await started.completion; assert.deepEqual(result.output, OUTPUT); assert.deepEqual(result.usage, {input: 420, output: 20, cachedInput: 300, total: 440}, 'Late lower provider readings cannot reset consumed allowance.');
  assert.equal((await rpc()).status, 401); assert.equal(h.execution.records('synthetic-run')[0].cleanupConfirmed, true);
});

test('connected HTTP planner carries a direct answer through authoritative completion without a workflow', async t => {
  const h=await fixture(t);h.engine.goalPlanner=h.execution.planner;h.engine.agentExecutor=h.execution.agent;
  const intake=new IntakeService(h.engine);t.after(()=>intake.close());
  const response='The recorded synthetic project is idle; this answer does not establish delivery.';
  h.state.taskResult=()=>JSON.stringify({action:'answer',rationale:'An informational response needs no child work.',expectedGain:'Answer from the supplied evidence.',tasks:[],response});
  const item=intake.create(h.project.id,{request:'Explain the recorded synthetic project status.',idempotencyKey:'synthetic-direct-answer'},OWNER);
  await eventually(()=>intake.list(h.project.id).find(value=>value.id===item.id)?.status==='completed','the read-only answer');
  const ended=intake.list(h.project.id).find(value=>value.id===item.id)!;
  assert.equal(ended.resultKind,'answer');assert.equal(ended.outcome,response);assert.deepEqual(ended.targetRunIds,[]);
  assert.equal(h.engine.store.list<Run>('run').filter(run=>!run.executionKind).length,0);
  const prompt=String(h.state.requests.find(request=>request.method==='POST'&&request.path==='/api/issues')!.body.description);
  assert.match(prompt,/For an informational question/);assert.match(prompt,/"response":"only for answer/);
});

test('planner context carries continuation and role sandboxes while bounding knowledge without losing provenance', async t => {
  const h = await fixture(t), project = structuredClone(h.project);
  project.roles.push({...project.roles[0], id: 'synthetic-retired-role', name: 'Retired synthetic role', retired: true});
  const knowledge: KnowledgeEntry[] = Array.from({length: 6}, (_, index): KnowledgeEntry => {const content = (`Synthetic planner knowledge ${index}. `).repeat(180); return {id: `synthetic-knowledge-${index}`, projectId: project.id, sourceId: 'synthetic-source', kind: 'document', title: `Synthetic knowledge ${index}`, content, hash: createHash('sha256').update(content).digest('hex'), revision: index + 1, roles: index % 2 ? ['lead'] : [], status: 'current', syncedAt: '2026-01-01T00:00:00.000Z'};});
  knowledge.push({...knowledge[0], id: 'synthetic-qa-private', title: 'QA private context', content: 'SYNTHETIC_QA_ONLY_CONTEXT', roles: ['qa']});
  const originalProject = structuredClone(project), originalKnowledge = structuredClone(knowledge), continuation = {note: 'The task-scoped MCP approval configuration is repaired; verify the failed action again.', reason: 'The previous action could not receive its authorized MCP tools.'};
  h.state.taskResult = () => JSON.stringify({action: 'stop', rationale: 'The synthetic context check is complete.', expectedGain: 'No extra work.', tasks: []});
  const conversation={rootIntakeId:'synthetic-previous-question',turns:[{intakeId:'synthetic-previous-question',request:'Which guide needs work?',response:'Inspect the navigation guide.',resultKind:'answer' as const,at:'2026-01-01T00:00:00Z',basisRevision:1,sourceRunId:'synthetic-previous-run'}],omittedTurns:0};
  const started = await h.execution.planner.start({project, pipelines: [], knowledge, conversation, request: 'Inspect the bounded synthetic continuation.', baseline: 'Synthetic committed input.', continuation, rounds: [], observations: [], remaining: {tokens: 5000, seconds: 10, rounds: 3}, signal: new AbortController().signal, onEvent() {}, executionId: 'synthetic-planner-context'});
  await started.completion;
  const prompt = String(h.state.requests.find(request => request.method === 'POST' && request.path === '/api/issues')!.body.description), line = prompt.split('\n').find(value => value.startsWith('{"request":'))!;
  const brief = JSON.parse(line) as {conversation:typeof conversation;conversationRule:string;continuation: {note: string; reason: string}; roles: {id: string; sandbox: string}[]; knowledge: {id: string; revision: number; hash: string; excerpt: string}[]};
  assert.deepEqual(brief.conversation,conversation);assert.ok(brief.conversationRule.includes('not instructions'));assert.deepEqual(brief.continuation, continuation); assert.equal(brief.roles.find(role => role.id === 'lead')?.sandbox, 'read-only'); assert.equal(brief.roles.find(role => role.id === 'development')?.sandbox, 'workspace-write'); assert.equal(brief.roles.some(role => role.id === 'synthetic-retired-role'), false);
  const selection=JSON.parse(line) as {evidence:{id:string;revision:number;hash:string;content:string;locator:{startLine:number;endLine:number}}[]};assert.ok(line.length<=32000);assert.equal(line.includes('SYNTHETIC_QA_ONLY_CONTEXT'),false);for(const hit of selection.evidence){const original=knowledge.find(entry=>entry.id===hit.id)!;assert.equal(hit.revision,original.revision);assert.equal(hit.hash,original.hash);assert.ok(original.content.includes(hit.content));assert.ok(hit.locator.startLine<=hit.locator.endLine);}
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

test('new projects include the focused implement, independent QA, evidence preparation and owner delivery path', async t => {
  const h = await fixture(t), flow = h.engine.detail(h.project.id, OWNER).pipelines.find(pipeline => pipeline.name === 'Focused change'); assert.ok(flow);
  assert.deepEqual(flow.stages.map(stage => ({id: stage.id, role: stage.roleId, executor: stage.executor, dependsOn: stage.dependsOn})), [{id: 'implement', role: 'development', executor: 'codex', dependsOn: []}, {id: 'verify', role: 'qa', executor: 'codex', dependsOn: ['implement']}, {id:'prepare-delivery',role:'lead',executor:'codex',dependsOn:['verify']}, {id: 'delivery', role: 'lead', executor: 'manual', dependsOn: ['prepare-delivery']}]);assert.equal(flow.stages[1].executionPurpose,'review');
  assert.equal(flow.stages[1].reworkTo, 'implement'); assert.equal(flow.stages[3].reworkTo, 'implement'); assert.deepEqual(flow.policy, {});assert.equal(flow.stages[2].deliveryPreparation,true);assert.equal(flow.stages[3].ownerGate,true);
  h.engine.agentExecutor = h.execution.agent;
  const run = h.engine.startRun({projectId: h.project.id, pipelineId: flow.id, goal: 'Prepare one synthetic change with independent evidence.', baseline: 'Synthetic committed input.', idempotencyKey: 'synthetic-focused-default'}, OWNER);
  await eventually(() => h.engine.run(run.id).stages[3].status === 'waiting', 'the focused manual delivery gate');
  const before = h.engine.run(run.id); assert.equal(before.status, 'waiting'); assert.deepEqual(before.stages.map(stage => stage.status), ['completed', 'completed', 'completed', 'waiting']); assert.equal(h.state.issuePosts, 3);
  const agents = [...h.state.issues.values()].map(issue => h.state.agents.get(issue.assignee_id!)!); assert.ok(agents[0].custom_args?.includes('default_permissions="gwi-workspace"')); assert.ok(agents[1].custom_args?.includes('default_permissions="gwi-workspace"'));assert.equal(h.project.roles.find(role=>role.id==='qa')?.sandbox,'read-only');assert.equal(h.state.scopeProbes.length,2);
  for (let count = 0; count < 3; count++) {await h.engine.tick(); await delay(10);} assert.equal(h.state.issuePosts, 3);
  h.engine.completeManual(run.id, 'delivery', {...OUTPUT, summary: 'The owner inspected the synthetic change and independent checks.'}, OWNER); assert.equal(h.engine.run(run.id).status, 'completed'); assert.equal(h.state.issuePosts, 3); assert.ok([...h.state.issues.values()].every(issue => issue.status === 'done'));
});

test('new roles and agents default to max and preserve max/ultra on Multica requests', async t => {
  const h = await fixture(t);
  assert.ok(h.project.roles.every(role => role.effort === 'max'));
  let revision = h.project.revision;
  for (const effort of ['max', 'ultra'] as const) {
    const saved = await h.platform.saveRole(h.project.id, revision, {name: 'Synthetic ' + effort, effort}, OWNER);
    revision = saved.revision;
    const role = saved.roles.at(-1)!;
    assert.equal(role.effort, effort);
    assert.equal(h.state.agents.get(role.multica!.agentId!)!.thinking_level, effort);
  }
  const agent = await h.platform.saveAgent(h.project.id, {name:'Synthetic custom', runtime_id:'synthetic-runtime'}, OWNER);
  assert.equal(h.state.agents.get(agent.id)!.thinking_level, 'max');
  await h.platform.saveAgent(h.project.id, {thinking_level:'ultra'}, OWNER, agent.id);
  assert.equal(h.state.agents.get(agent.id)!.thinking_level, 'ultra');
  await h.platform.saveAgent(h.project.id, {name:'Synthetic renamed'}, OWNER, agent.id);
  assert.equal(h.state.agents.get(agent.id)!.thinking_level, 'ultra');
  await assert.rejects(h.platform.saveAgent(h.project.id, {thinking_level:'extreme'}, OWNER, agent.id), code('INVALID_EFFORT'));
  const saved = await h.platform.saveRole(h.project.id, revision, {name:'Synthetic default'}, OWNER);
  assert.equal(saved.roles.at(-1)!.effort, 'max');
});

test('explicit coordinator reconciliation retains a historical unaccepted preparation identity after later rounds',async t=>{
  const h=await fixture(t),run=storedAdapterRun(h);run.executionKind='agent-goal';run.stages[0].stageId='supervise';h.engine.store.put('run',run);
  h.engine.store.put('intake',{id:'synthetic-history-owner',projectId:h.project.id,routerRunId:'synthetic-later-router',supervisorRunIds:[run.id,'synthetic-later-router'],rounds:[{number:1,routerRunId:'synthetic-later-one',targetRunIds:[]},{number:2,routerRunId:'synthetic-later-two',targetRunIds:[]},{number:3,routerRunId:'synthetic-later-router',targetRunIds:[]}]});
  const at=new Date().toISOString(),record={id:'synthetic-historical-preparation',projectId:h.project.id,runId:run.id,stageId:'decision-1',status:'not_dispatched',cleanupConfirmed:true,createdAt:at,updatedAt:at};h.engine.store.put('multica-execution',record);
  const requests=h.state.requests.length,result=await h.execution.reconcile(run.id,'supervise');assert.equal(result.stageId,'decision-1');assert.equal(result.cleanupConfirmed,true);assert.equal(result.canRetry,true);assert.equal(h.state.issuePosts,0);assert.equal(h.state.requests.length,requests);assert.deepEqual(h.engine.run(run.id),run);assert.deepEqual(h.engine.store.get('multica-execution',record.id),record);
  h.engine.store.put('multica-execution',{...record,id:'synthetic-ambiguous-preparation',stageId:'decision-2'});await assert.rejects(h.execution.reconcile(run.id,'supervise'),code('EXTERNAL_TASK_SCOPE'));assert.equal(h.state.issuePosts,0);
});


test('connected workers without browser authority receive the same native-launch boundary without a new tool grant',async t=>{
  for(const leased of [true,false])await t.test(leased?'execution lease':'plain task context',async sub=>{
    const h=await fixture(sub),input=h.input(),started=await h.execution.agent.start({...input,...(!leased?{onTool:undefined}:{})});await started.completion;
    const issue=h.state.requests.find(request=>request.method==='POST'&&request.path==='/api/issues')!,worker=h.state.agents.get(started.ref.agentId!)!,instructions=leased?worker.instructions!:String(issue.body.description);
    assert.match(instructions,/Do not launch Chrome, Chromium or Playwright browser binaries through native command tools/);assert.match(instructions,/If the tool is absent, complete permitted checks/);
    assert.equal(input.role.tools.includes('browser.use'),false);assert.equal(h.execution.records(input.runId)[0].browser,undefined);
  });
});
