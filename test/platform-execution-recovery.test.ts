import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Intake,Project,Run,TaskOutput} from '../src/contracts.ts';
import type {AgentExecutionInput} from '../src/adapters/types.ts';
import {MulticaClient} from '../src/adapters/multica.ts';
import type {MulticaTask} from '../src/adapters/multica.ts';
import type {Platform,DaemonIdentity} from '../src/platform.ts';
import {PlatformExecution} from '../src/platform-execution.ts';
import type {ExecutionRecord} from '../src/platform-execution.ts';
import {Store} from '../src/store.ts';
import {defaultRoles} from '../src/defaults.ts';

const at='2026-01-01T00:00:00Z',workspaceId='synthetic-provider-workspace';
const output:TaskOutput={outcome:'done',summary:'Synthetic authoritative task output.',artifacts:[],observations:[]};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return{promise,resolve};}
type Gate=ReturnType<typeof deferred>;
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected;
async function until(condition:()=>boolean){for(let count=0;count<100;count++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Synthetic observation did not reach the requested state.');}
function waitFor(gate:Gate,signal?:AbortSignal|null):Promise<void>{
  return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Synthetic request aborted.','AbortError'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});gate.promise.then(()=>{signal?.removeEventListener('abort',abort);resolve();});});
}

async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-reconciliation-test-')),store=new Store(directory);
  const project:Project={id:'synthetic-project',revision:1,name:'Synthetic recovery project',description:'Independently authored protocol fixture.',workspace:'/synthetic/source',repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:at,updatedAt:at};
  const pipeline={id:'synthetic-pipeline',projectId:project.id,revision:1,name:'Synthetic bounded task',description:'',roleId:'development',stages:[{id:'work',name:'Synthetic work',roleId:'development',executor:'codex' as const,dependsOn:[],prompt:'Use synthetic input.',review:false}],policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:5,tokenBudget:1000},updatedAt:at};
  const run:Run={id:'synthetic-run',projectId:project.id,pipelineId:pipeline.id,goal:'Observe only one synthetic assignment.',baseline:'Synthetic source.',trigger:{kind:'human',actor:'Synthetic owner'},status:'failed',iteration:1,mode:'once',createdAt:at,updatedAt:at,endedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-run',inputHash:'synthetic-input',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'work',status:'failed',attempts:[{id:'synthetic-attempt',number:1,iteration:1,status:'failed',startedAt:at,endedAt:at,failureCode:'STAGE_TIMEOUT',provider:'multica',ref:{provider:'multica',issueId:'synthetic-issue',externalId:'synthetic-task'}}]}]};store.put('run',run);
  const daemon:DaemonIdentity={healthUrl:'http://127.0.0.1:1/health',pid:1,profile:'synthetic-profile',daemonId:'synthetic-daemon',cliCommit:'synthetic-build',startedAt:at};
  const record:ExecutionRecord={id:'synthetic-attempt',projectId:project.id,runId:run.id,stageId:'work',issueId:'synthetic-issue',taskId:'synthetic-task',agentId:'synthetic-agent',runtimeId:'synthetic-runtime',status:'timeout',cleanupConfirmed:false,createdAt:at,updatedAt:at,daemon,allowanceExecutionId:'synthetic-observation'};store.put('multica-execution',record);
  const task:MulticaTask={id:'synthetic-task',workspace_id:workspaceId,issue_id:'synthetic-issue',agent_id:'synthetic-agent',runtime_id:'synthetic-runtime',status:'running',started_at:at};
  const state={tasks:[task],agentTasks:[task],requests:[] as {method:string;path:string;signal?:AbortSignal|null}[],gates:new Map<string,Gate>(),messageError:false,cancelError:false,cancelReply:undefined as Partial<MulticaTask>|undefined,cancelEffect:undefined as (()=>void)|undefined,idle:false,idleGate:undefined as Gate|undefined,accountGate:undefined as Gate|undefined,finishes:0,events:[] as string[]};
  const client=new MulticaClient({baseUrl:'http://127.0.0.1:1',workspaceId,token:'SYNTHETIC_PROVIDER_TOKEN'},{fetch:async(input,init)=>{
    const route=new URL(String(input)).pathname,method=init?.method??'GET',signal=init?.signal;state.requests.push({method,path:route,signal});
    const gate=state.gates.get(route);if(gate)await waitFor(gate,signal);
    const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    if(method==='GET'&&route.endsWith('/task-runs'))return json(state.tasks);
    if(method==='GET'&&route==='/api/agents/synthetic-agent/tasks')return json(state.agentTasks);
    if(method==='GET'&&route==='/api/tasks/synthetic-task/messages')return state.messageError?json({code:'SYNTHETIC_MESSAGE_FAILURE',error:'Synthetic optional messages unavailable.'},503):json([]);
    if(method==='POST'&&route==='/api/issues/synthetic-issue/tasks/synthetic-task/cancel'){state.cancelEffect?.();if(state.cancelError)throw new TypeError('Synthetic cancellation response lost.');return json({...task,status:'cancelled',result:{receipt:'Cancellation acknowledgement is not a termination proof.'},...state.cancelReply});}
    if(route==='/api/issues/synthetic-issue'&&(method==='GET'||method==='PUT'))return json({id:'synthetic-issue',workspace_id:workspaceId,title:'Synthetic issue',status:'todo',project_id:'synthetic-remote-project',description:'Synthetic scope\nGWI execution identity: synthetic-attempt\n'});
    assert.fail('Unexpected synthetic provider operation: '+method+' '+route);
  }});
  const platform={engine:{store,run:(id:string)=>{const item=store.get<Run>('run',id);assert.ok(item);return item;},finishAccountExecution:async()=>{state.finishes++;if(state.accountGate)await state.accountGate.promise;}},client,confirmDaemonIdle:async(identity:DaemonIdentity|undefined)=>{if(state.idleGate)await state.idleGate.promise;return JSON.stringify(identity)===JSON.stringify(daemon)&&state.idle;},workspaces:{}} as unknown as Platform;
  const execution=new PlatformExecution(platform);
  const observe=(execution as unknown as {observe:(record:ExecutionRecord,input:AgentExecutionInput,ref:{provider:'multica';issueId:string;externalId:string})=>Promise<{text:string}>}).observe.bind(execution);
  const input:AgentExecutionInput={project,workspace:project.workspace,role:project.roles.find(role=>role.id==='development')!,runId:run.id,stageId:'work',attemptId:record.id,prompt:'No model execution; observe synthetic task data only.',timeoutSeconds:5,tokenBudget:1000,signal:new AbortController().signal,onEvent:event=>state.events.push(event.type),onTool:async()=>{assert.fail('No model tool may be invoked.');}};
  const current=()=>store.get<ExecutionRecord>('multica-execution',record.id)!;
  const cancellations=()=>state.requests.filter(request=>request.method==='POST');
  t.after(async()=>{for(const gate of state.gates.values())gate.resolve();state.idleGate?.resolve();state.accountGate?.resolve();await execution.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{store,execution,state,task,record,run,input,current,cancellations,observe};
}

test('terminal task output and cleanup survive an optional message-read failure',async t=>{
  const h=await fixture(t);h.task.status='completed';h.task.result=JSON.stringify(output);h.state.messageError=true;
  const result=await h.observe(h.record,h.input,{provider:'multica',issueId:h.record.issueId!,externalId:h.task.id});
  assert.deepEqual(JSON.parse(result.text),output);assert.equal(h.current().cleanupConfirmed,true);assert.equal(h.state.finishes,1);assert.ok(h.state.events.includes('multica.messages_unavailable'));
  assert.ok(h.state.requests.every(request=>request.signal instanceof AbortSignal));assert.deepEqual(h.cancellations(),[]);
});

test('terminal-looking tasks still require exact daemon or result proof',async t=>{
  const h=await fixture(t);h.task.status='timeout';h.state.messageError=true;
  await assert.rejects(h.observe(h.record,h.input,{provider:'multica',issueId:h.record.issueId!,externalId:h.task.id}),code('EXTERNAL_RECONCILIATION_REQUIRED'));
  assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.state.finishes,0);assert.equal(h.state.requests.some(request=>request.path.includes('/messages')),false);
  const wrong=h.current();wrong.daemon={...wrong.daemon!,pid:2};h.store.put('multica-execution',wrong);h.state.idle=true;
  assert.equal((await h.execution.reconcile(h.run.id,'work')).cleanupConfirmed,false);
  h.store.put('multica-execution',h.record);assert.equal((await h.execution.reconcile(h.run.id,'work')).cleanupConfirmed,true);assert.equal(h.state.finishes,1);
});

test('cancellation is opt-in for one exact owned task and its acknowledgement is not cleanup proof',async t=>{
  const h=await fixture(t);assert.equal((await h.execution.reconcile(h.run.id,'work')).canRetry,false);assert.equal(h.cancellations().length,0);
  const pending=await h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true});assert.equal(pending.status,'cancel_requested');assert.equal(pending.cleanupConfirmed,false);assert.equal(pending.canRetry,false);assert.equal(h.state.finishes,0);assert.equal(h.cancellations().length,1);
  assert.ok(pending.cancelAcknowledgedAt);assert.equal((await h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true})).cleanupConfirmed,false);assert.equal(h.cancellations().length,1,'An acknowledged cancellation is observed rather than repeatedly submitted.');
  h.task.status='cancelled';h.task.result={receipt:'A later authoritative terminal result.'};
  const ended=await h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true});assert.equal(ended.cleanupConfirmed,true);assert.equal(h.state.finishes,1);assert.equal(h.cancellations().length,1);
  await h.execution.reconcile(h.run.id,'work');assert.equal(h.state.finishes,1);
});

test('a lost cancellation response remains recheckable without creating a replacement',async t=>{
  const h=await fixture(t);h.state.cancelError=true;h.state.cancelEffect=()=>{h.task.status='cancelled';h.task.result={receipt:'Synthetic late termination proof.'};};
  await assert.rejects(h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true}));assert.equal(h.current().status,'cancel_requested');assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.state.finishes,0);
  const ended=await h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true});assert.equal(ended.taskId,h.task.id);assert.equal(ended.cleanupConfirmed,true);assert.equal(h.cancellations().length,1);assert.equal(h.state.finishes,1);
});

test('early Stop bounds an hour-long observation to the first cancellation window',async t=>{
  const h=await fixture(t),stop=new AbortController(),first=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',first);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse(at)});const started=Date.now();let settled=false;
  const pending=h.observe(h.record,{...h.input,timeoutSeconds:3600,signal:stop.signal},{provider:'multica',issueId:h.record.issueId!,externalId:h.task.id});
  void pending.finally(()=>{settled=true;}).catch(()=>{});const rejected=assert.rejects(pending,error=>code('ABORTED')(error)||code('EXECUTION_CHECK_ABORTED')(error));
  await new Promise(resolve=>setImmediate(resolve));stop.abort();first.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.cancellations().length,1);assert.equal(h.current().cleanupConfirmed,false);
  const later=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',later);t.mock.timers.tick(19000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.ok(h.state.requests.filter(request=>request.path.endsWith('/task-runs')).length>=2);
  t.mock.timers.tick(1000);await rejected;assert.equal(Date.now()-started,20000);assert.equal(settled,true);
  assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.current().issueId,'synthetic-issue');assert.equal(h.current().taskId,'synthetic-task');assert.equal(h.cancellations().length,1);later.resolve();
});

test('legacy execution deadlines do not shorten an explicit cancellation confirmation window',async t=>{
  const h=await fixture(t),stop=new AbortController(),first=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',first);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse(at)});const started=Date.now();
  const pending=h.observe(h.record,{...h.input,timeoutSeconds:1,signal:stop.signal},{provider:'multica',issueId:h.record.issueId!,externalId:h.task.id});const rejected=assert.rejects(pending);
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(19000);stop.abort();first.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.cancellations().length,1);t.mock.timers.tick(2000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.current().cleanupConfirmed,false);t.mock.timers.tick(18000);await rejected;
  assert.equal(Date.now()-started,39000);assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.current().taskId,'synthetic-task');
});

test('early Stop also bounds a pending daemon proof and rejects its late response',async t=>{
  const h=await fixture(t),stop=new AbortController();h.task.status='timeout';h.state.idle=true;h.state.idleGate=deferred();
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse(at)});let settled=false;
  const pending=h.observe(h.record,{...h.input,timeoutSeconds:3600,signal:stop.signal},{provider:'multica',issueId:h.record.issueId!,externalId:h.task.id});void pending.finally(()=>{settled=true;}).catch(()=>{});const rejected=assert.rejects(pending,code('EXECUTION_CHECK_ABORTED'));
  await new Promise(resolve=>setImmediate(resolve));stop.abort();t.mock.timers.tick(19999);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  t.mock.timers.tick(1);await rejected;assert.equal(h.current().cleanupConfirmed,false);h.state.idleGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.current().taskId,'synthetic-task');
});

test('a cancellation transport failure during live observation preserves its newly discovered exact reference',async t=>{
  const h=await fixture(t),stop=new AbortController(),ref={provider:'multica' as const,issueId:'synthetic-issue',externalId:''};delete h.record.taskId;h.store.put('multica-execution',h.record);h.state.cancelError=true;stop.abort();
  await assert.rejects(h.observe(h.record,{...h.input,timeoutSeconds:3600,signal:stop.signal},ref),code('TRANSPORT_ERROR'));
  assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.current().issueId,ref.issueId);assert.equal(h.current().taskId,'synthetic-task');assert.equal(ref.externalId,'synthetic-task');assert.equal(h.current().cancelAcknowledgedAt,undefined);assert.equal(h.state.finishes,0);
});

test('a cancellation response for a different identity is not acknowledged as this task',async t=>{
  const h=await fixture(t);h.state.cancelReply={id:'another-task'};
  await assert.rejects(h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true}),code('EXTERNAL_TASK_SCOPE'));
  assert.equal(h.current().cancelAcknowledgedAt,undefined);assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.state.finishes,0);
});

test('mismatched or ambiguous task identities cannot be cancelled or release cleanup',async t=>{
  for(const variant of ['task','agent','runtime','issue','project','ambiguous'] as const)await t.test(variant,async child=>{
    const h=await fixture(child);
    if(variant==='project'){const record=h.current();record.projectId='another-project';h.store.put('multica-execution',record);}
    else if(variant==='ambiguous'){const record=h.current();delete record.taskId;h.store.put('multica-execution',record);h.state.tasks.push({...h.task,id:'another-task'});}
    else Object.assign(h.task,{[variant==='task'?'id':variant+'_id']:'another-identity'});
    await assert.rejects(h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true}));assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.cancellations().length,0);assert.equal(h.state.finishes,0);
  });
});

test('concurrent manual and background checks share one observation and cancellation',async t=>{
  const h=await fixture(t),gate=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',gate);
  const manual=h.execution.reconcile(h.run.id,'work');await until(()=>h.state.requests.length===1);
  const automatic=h.execution.reconcile(h.run.id,'work',{cancelIfRunning:true});gate.resolve();
  const results=await Promise.all([manual,automatic]);assert.equal(h.state.requests.filter(request=>request.path.endsWith('/task-runs')).length,1);assert.equal(h.cancellations().length,1);assert.ok(results.every(result=>!result.cleanupConfirmed));
});

test('coordinator supervise and exact decision aliases share the same flight',async t=>{
  const h=await fixture(t),run={...h.run,executionKind:'agent-goal' as const};h.store.put('run',run);h.store.put('multica-execution',{...h.record,stageId:'decision-1'});
  const intake:Intake={id:'synthetic-intake',projectId:run.projectId,routerRunId:run.id,rounds:[],request:'Synthetic coordinator scope.',baseline:'Synthetic source.',status:'failed',createdAt:at,updatedAt:at,idempotencyKey:'synthetic-intake',targetRunIds:[],policy:{maxRounds:1,maxParallel:1,maxElapsedSeconds:30,maxTotalTokens:1000}};h.store.put('intake',intake);
  const gate=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',gate);
  const first=h.execution.reconcile(run.id,'supervise');await until(()=>h.state.requests.length===1);const second=h.execution.reconcile(run.id,'decision-1',{cancelIfRunning:true});gate.resolve();await Promise.all([first,second]);
  assert.equal(h.state.requests.filter(request=>request.path.endsWith('/task-runs')).length,1);assert.equal(h.cancellations().length,1);
});

test('an aborted task observation cannot confirm cleanup or cancel and can be checked again',async t=>{
  const h=await fixture(t),gate=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',gate);const controller=new AbortController();
  const pending=h.execution.reconcile(h.run.id,'work',{signal:controller.signal,cancelIfRunning:true});await until(()=>h.state.requests.length===1);controller.abort();await assert.rejects(pending,code('EXECUTION_CHECK_ABORTED'));
  assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.cancellations().length,0);assert.equal(h.state.requests[0].signal?.aborted,true);gate.resolve();await new Promise(resolve=>setImmediate(resolve));
  h.task.status='failed';h.task.result={receipt:'Synthetic exact terminal result.'};assert.equal((await h.execution.reconcile(h.run.id,'work')).cleanupConfirmed,true);
});

test('a delayed daemon proof cannot mutate cleanup after the caller deadline',async t=>{
  const h=await fixture(t);h.task.status='timeout';h.state.idle=true;h.state.idleGate=deferred();const controller=new AbortController();
  const pending=h.execution.reconcile(h.run.id,'work',{signal:controller.signal});await until(()=>h.state.requests.length===1);await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,code('EXECUTION_CHECK_ABORTED'));
  assert.equal(h.current().cleanupConfirmed,false);h.state.idleGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.current().cleanupConfirmed,false);
  assert.equal((await h.execution.reconcile(h.run.id,'work')).cleanupConfirmed,true);
});

test('HTTP discovery, cancellation and metadata requests all honor the same check signal',async t=>{
  for(const operation of ['discovery','issue','cancellation','metadata'] as const)await t.test(operation,async child=>{
    const h=await fixture(child),controller=new AbortController(),gate=deferred();
    let route='/api/issues/synthetic-issue/tasks/synthetic-task/cancel';
    if(operation==='discovery'||operation==='issue'){const record=h.current();delete record.issueId;delete record.taskId;record.status='unknown';h.store.put('multica-execution',record);h.store.put('multica-run-project',{id:h.run.id,providerProjectId:'synthetic-remote-project'});route=operation==='discovery'?'/api/agents/synthetic-agent/tasks':'/api/issues/synthetic-issue';}
    if(operation==='metadata'){h.task.status='failed';h.task.result={receipt:'Synthetic authoritative termination.'};route='/api/issues/synthetic-issue';}
    h.state.gates.set(route,gate);const pending=h.execution.reconcile(h.run.id,'work',{signal:controller.signal,cancelIfRunning:true});await until(()=>h.state.requests.some(request=>request.path===route));controller.abort();await assert.rejects(pending,code('EXECUTION_CHECK_ABORTED'));
    assert.equal(h.state.requests.find(request=>request.path===route)!.signal?.aborted,true);assert.equal(h.current().cleanupConfirmed,operation==='metadata');gate.resolve();
  });
});

test('a caller deadline ends its wait without cancelling an independently owned shared check',async t=>{
  const h=await fixture(t),gate=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',gate);
  const manual=h.execution.reconcile(h.run.id,'work');await until(()=>h.state.requests.length===1);
  await assert.rejects(h.execution.reconcile(h.run.id,'work',{signal:AbortSignal.timeout(10)}),code('EXECUTION_CHECK_ABORTED'));
  assert.equal(h.state.requests[0].signal?.aborted,false);gate.resolve();assert.equal((await manual).cleanupConfirmed,false);assert.equal(h.state.requests.length,1);
});

test('closing cancels a pending reconciliation before storage is released',async t=>{
  const h=await fixture(t),gate=deferred();h.state.gates.set('/api/issues/synthetic-issue/task-runs',gate);
  const pending=h.execution.reconcile(h.run.id,'work');const rejected=assert.rejects(pending);await until(()=>h.state.requests.length===1);await h.execution.close();await rejected;
  assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.state.requests[0].signal?.aborted,true);assert.equal(h.cancellations().length,0);gate.resolve();
});

test('lost creation discovery remains scoped and ambiguity never becomes a cancellation target',async t=>{
  for(const count of [0,2])await t.test(String(count),async child=>{
    const h=await fixture(child),record=h.current();delete record.issueId;delete record.taskId;record.status='unknown';h.store.put('multica-execution',record);h.store.put('multica-run-project',{id:h.run.id,providerProjectId:'synthetic-remote-project'});
    h.state.agentTasks=Array.from({length:count},(_,index)=>({...h.task,id:'synthetic-task-'+index}));
    await assert.rejects(h.execution.reconcile(h.run.id,'work',{signal:AbortSignal.timeout(1000),cancelIfRunning:true}),code('EXTERNAL_CREATION_UNCERTAIN'));
    assert.equal(h.current().cleanupConfirmed,false);assert.equal(h.current().issueId,undefined);assert.equal(h.cancellations().length,0);assert.ok(h.state.requests.every(request=>request.signal instanceof AbortSignal));
  });
});
