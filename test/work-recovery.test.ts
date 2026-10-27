import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {Engine} from '../src/engine.ts';
import {Store} from '../src/store.ts';
import {defaultRoles} from '../src/defaults.ts';
import {WorkRecovery,currentWorkRecovery} from '../src/work-recovery.ts';
import type {Intake,Project,Run} from '../src/contracts.ts';
import type {CodexAdapter,GithubAdapter} from '../src/adapters/types.ts';
import type {AccountAllowanceService} from '../src/account-allowance.ts';

const at='2026-01-01T00:00:00.000Z';
async function fixture(t:TestContext){
  t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});
  const dir=await mkdtemp(path.join(tmpdir(),'gwi-work-recovery-')),store=new Store(dir);
  const codex={info:async()=>({available:true,connected:true,authenticated:true,models:[]}),close:async()=>{}} as unknown as CodexAdapter;
  const engine=new Engine(store,codex,{} as GithubAdapter);t.mock.method(engine,'tick',async()=>{});
  t.after(async()=>{await engine.close();await rm(dir,{recursive:true,force:true});});
  const project:Project={id:'synthetic-recovery-project',name:'Recovery fixture',description:'Independent bounded recovery test.',workspace:dir,repository:'',revision:1,createdAt:at,updatedAt:at,roles:defaultRoles(),knowledgeSources:[]};store.put('project',project);
  const flow={id:'synthetic-flow',projectId:project.id,name:'Independent correction',description:'Synthetic stages.',revision:1,roleId:'development',updatedAt:at,policy:{concurrency:1,maxAttempts:3,maxIterations:1,timeoutSeconds:300,tokenBudget:10000},stages:[{id:'prepare',name:'Prepare input',executor:'codex' as const,roleId:'development',dependsOn:[],review:false,prompt:'Prepare the synthetic input.'},{id:'work',name:'Inspect links',executor:'codex' as const,roleId:'development',dependsOn:['prepare'],review:false,prompt:'Inspect the prepared links.'}]};
  const run:Run={id:'synthetic-failed-run',projectId:project.id,pipelineId:flow.id,status:'failed',goal:'Inspect the synthetic links.',baseline:'Synthetic source basis.',trigger:{kind:'human',actor:'Synthetic operator'},createdAt:at,updatedAt:at,endedAt:at,iteration:1,mode:'once',idempotencyKey:'synthetic-run',inputHash:'synthetic-input',dependsOnRunIds:[],snapshot:{project,pipeline:flow,pipelines:[flow],knowledge:[]},stages:[{stageId:'prepare',status:'completed',attempts:[{id:'synthetic-prepared',number:1,iteration:1,status:'completed',startedAt:at,endedAt:at,output:{outcome:'done',summary:'Prepared input retained.',artifacts:[],observations:[]}}]},{stageId:'work',status:'failed',attempts:[{id:'synthetic-timeout',number:1,iteration:1,status:'failed',failureCode:'STAGE_TIMEOUT',error:'Stage time limit reached.',startedAt:at,endedAt:at}]}]};store.put('run',run);
  const goal:Intake={id:'synthetic-recovery-goal',projectId:project.id,request:run.goal,baseline:run.baseline,status:'dispatched',createdAt:at,updatedAt:at,routerRunId:'synthetic-coordinator',targetRunIds:[run.id],rounds:[],idempotencyKey:'synthetic-goal',policy:{maxRounds:4,maxParallel:2,maxElapsedSeconds:3600,maxTotalTokens:100000,smartRetry:true}};store.put('intake',goal);
  for(const stage of run.stages)for(const attempt of stage.attempts)attempt.usage={input:10,output:5,total:15};store.put('run',run);
  let active=true,remaining=3600,resumptions=0;
  const context={engine,get:(id:string)=>store.get<Intake>('intake',id)!,all:()=>store.list<Intake>('intake'),family:()=>[engine.run(run.id)],save:(value:Intake)=>store.put('intake',value),active:()=>active,pause:(value:Intake)=>{value.status='failed';store.put('intake',value);active=false;},resume:async()=>{resumptions++;},remaining:()=>({seconds:remaining,tokens:100000}),confirmed:()=>true};
  const work=new WorkRecovery(context),get=()=>context.get(goal.id);
  const drain=async()=>{work.tick();for(let n=0;n<6;n++)await immediate();};
  return{store,engine,work,context,get,run,goal,drain,setActive:(value:boolean)=>{active=value;},setRemaining:(value:number)=>{remaining=value;},resumptions:()=>resumptions};
}

test('manual recovery deduplicates, confirms exact cleanup and retries only the failed step',async t=>{
  const h=await fixture(t),upstream=structuredClone(h.run.stages[0]);let checks=0;
  h.store.put('multica-execution',{id:'synthetic-external',runId:h.run.id,stageId:'work',cleanupConfirmed:false});
  h.engine.reconcileExternal=async(runId,stageId)=>{assert.equal(runId,h.run.id);assert.equal(stageId,'work');checks++;h.store.put('multica-execution',{id:'synthetic-external',runId,stageId,cleanupConfirmed:true});return{status:'cancelled',cleanupConfirmed:true};};
  const first=h.work.begin(h.goal.id,'manual');assert.equal(currentWorkRecovery(h.work.begin(h.goal.id,'manual'))?.id,currentWorkRecovery(first)?.id);
  await h.drain();assert.equal(currentWorkRecovery(h.get())?.phase,'backoff');assert.equal(checks,1);
  await h.drain();assert.equal(currentWorkRecovery(h.get())?.phase,'retrying');
  const retried=h.engine.run(h.run.id);assert.deepEqual(retried.stages[0],upstream);assert.equal(retried.stages[1].status,'queued');assert.equal(retried.stages[1].attempts[0].failureCode,'STAGE_TIMEOUT');assert.equal(retried.snapshot.pipeline.policy.timeoutSeconds,300);
  const row=h.store.get<any>('multica-execution','synthetic-external');assert.equal(row.cleanupConfirmed,true);
});

test('unconfirmed termination reaches its persisted deadline across a supervisor restart',async t=>{
  const h=await fixture(t);h.store.put('multica-execution',{id:'synthetic-unknown',runId:h.run.id,stageId:'work',cleanupConfirmed:false});
  h.engine.reconcileExternal=async()=>({status:'running',cleanupConfirmed:false});
  h.work.begin(h.goal.id,'manual');await h.drain();const deadline=currentWorkRecovery(h.get())!.deadlineAt;
  h.work.close();const restarted=new WorkRecovery(h.context);t.mock.timers.tick(60001);restarted.tick();await immediate();
  assert.equal(currentWorkRecovery(h.get())?.deadlineAt,deadline);assert.equal(currentWorkRecovery(h.get())?.code,'TERMINATION_UNCONFIRMED');assert.equal(currentWorkRecovery(h.get())?.phase,'needs_input');assert.equal(h.engine.run(h.run.id).status,'failed');assert.equal(h.store.get<any>('multica-execution','synthetic-unknown').cleanupConfirmed,false);
});

test('Stop during a delayed provider observation cannot dispatch replacement work',async t=>{
  const h=await fixture(t);h.store.put('multica-execution',{id:'synthetic-pending',runId:h.run.id,stageId:'work',cleanupConfirmed:false});
  let release!:(value:{status:string;cleanupConfirmed:boolean})=>void;h.engine.reconcileExternal=()=>new Promise(resolve=>{release=resolve;});
  h.work.begin(h.goal.id,'manual');h.work.tick();await immediate();
  const stopped=h.get();stopped.controlRevision=1;stopped.status='stopped';h.work.cancel(stopped);h.store.put('intake',stopped);release({status:'cancelled',cleanupConfirmed:true});await h.drain();
  assert.equal(currentWorkRecovery(h.get())?.phase,'cancelled');assert.equal(h.engine.run(h.run.id).status,'failed');
});

test('a persisted unowned coordinator resumption becomes actionable after restart',async t=>{
  const h=await fixture(t);h.work.begin(h.goal.id,'manual');const goal=h.get(),record=currentWorkRecovery(goal)!;record.phase='resuming';h.store.put('intake',goal);
  h.work.close();const restarted=new WorkRecovery(h.context);restarted.tick();await immediate();
  assert.equal(currentWorkRecovery(h.get())?.phase,'needs_input');assert.equal(currentWorkRecovery(h.get())?.code,'RECOVERY_INTERRUPTED');assert.equal(h.resumptions(),0);
});

test('automatic retry backs off and hands a repeated timeout to the owner',async t=>{
  const h=await fixture(t);await h.drain();assert.equal(currentWorkRecovery(h.get())?.phase,'backoff');
  await h.drain();assert.equal(h.engine.run(h.run.id).status,'failed');t.mock.timers.tick(30001);await h.drain();assert.equal(currentWorkRecovery(h.get())?.phase,'retrying');
  const run=h.engine.run(h.run.id);run.status='failed';run.stages[1].status='failed';run.stages[1].attempts.push({...run.stages[1].attempts[0],id:'synthetic-timeout-again',number:2});h.store.put('run',run);
  await h.drain();assert.equal(currentWorkRecovery(h.get())?.code,'REPEATED_TIMEOUT');await h.drain();assert.equal(h.get().workRecoveryHistory?.length,1);assert.equal(h.engine.run(h.run.id).stages[1].attempts.length,2);
});

test('legacy/manual policy and non-transient failures never start automatic recovery',async t=>{
  const h=await fixture(t),legacy=h.get();delete legacy.policy.smartRetry;h.store.put('intake',legacy);await h.drain();assert.equal(h.get().workRecoveryHistory,undefined);
  legacy.policy.smartRetry=true;h.store.put('intake',legacy);const run=h.engine.run(h.run.id);delete run.stages[1].attempts[0].failureCode;run.stages[1].attempts[0].error='Source permission denied.';h.store.put('run',run);await h.drain();assert.equal(h.get().workRecoveryHistory,undefined);
});

test('a target already stopped by its owner is not classified as an automatic timeout retry',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.status='cancelled';run.cancelRequested=true;run.controlRevision=1;h.store.put('run',run);await h.drain();assert.equal(h.get().workRecoveryHistory,undefined);assert.equal(h.engine.run(h.run.id).cancelRequested,true);
});

test('a timed-out GitHub dispatch requires external review instead of another workflow dispatch',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.snapshot.pipeline.stages[1].executor='github';run.snapshot.pipeline.stages[1].options={mode:'dispatch',workflow:'synthetic-ci.yml'};run.stages[1].attempts[0].ref={externalId:'synthetic-running-ci'};h.store.put('run',run);
  await h.drain();assert.equal(h.get().workRecoveryHistory,undefined);
  h.work.begin(h.goal.id,'manual');await h.drain();assert.equal(currentWorkRecovery(h.get())?.code,'EXTERNAL_REVIEW_REQUIRED');assert.equal(h.engine.run(h.run.id).status,'failed');
});

test('account refresh respects Stop and exhausted original execution bounds',async t=>{
  const h=await fixture(t);let release!:(value:any)=>void;
  h.engine.accountAllowances={assess:()=>new Promise(resolve=>{release=resolve;})} as unknown as AccountAllowanceService;
  t.mock.method(h.engine,'resolvedAllowanceTarget',async()=>({projectId:h.goal.projectId,pipelineId:'synthetic-flow',stageId:'work',roleId:'development',model:null,effort:'max',kind:'stage'}));
  h.work.begin(h.goal.id,'manual');await h.drain();h.work.tick();await immediate();
  const stopped=h.get();stopped.status='stopped';stopped.controlRevision=1;h.work.cancel(stopped);h.store.put('intake',stopped);release({status:'ready',action:'continue',account:{expiresAt:new Date(Date.now()+60000).toISOString()}});await h.drain();assert.equal(h.engine.run(h.run.id).status,'failed');
  const next=h.get();next.status='failed';h.store.put('intake',next);h.setActive(false);h.setRemaining(0);h.work.begin(h.goal.id,'manual');await h.drain();assert.equal(currentWorkRecovery(h.get())?.code,'GOAL_BOUNDARY');assert.equal(h.engine.run(h.run.id).status,'failed');
});

test('a rejected old account check cannot finish a newer recovery generation',async t=>{
  const h=await fixture(t);let reject!:(error:Error)=>void;
  h.engine.accountAllowances={assess:()=>new Promise((_,fail)=>{reject=fail;})} as unknown as AccountAllowanceService;
  t.mock.method(h.engine,'resolvedAllowanceTarget',async()=>({projectId:h.goal.projectId,pipelineId:'synthetic-flow',stageId:'work',roleId:'development',model:null,effort:'max',kind:'stage'}));
  h.work.begin(h.goal.id,'manual');await h.drain();h.work.tick();await immediate();
  const stopped=h.get();stopped.status='stopped';stopped.controlRevision=1;h.work.cancel(stopped);h.store.put('intake',stopped);h.setActive(false);
  const next=h.work.begin(h.goal.id,'manual'),nextId=currentWorkRecovery(next)!.id;reject(new Error('Old observation failed.'));for(let n=0;n<6;n++)await immediate();
  assert.equal(currentWorkRecovery(h.get())?.id,nextId);assert.equal(currentWorkRecovery(h.get())?.phase,'checking');assert.equal(currentWorkRecovery(h.get())?.error,undefined);
});

test('a target-run Stop during account refresh is never cleared by recovery',async t=>{
  const h=await fixture(t);let release!:(value:any)=>void;
  h.engine.accountAllowances={assess:()=>new Promise(resolve=>{release=resolve;})} as unknown as AccountAllowanceService;
  t.mock.method(h.engine,'resolvedAllowanceTarget',async()=>({projectId:h.goal.projectId,pipelineId:'synthetic-flow',stageId:'work',roleId:'development',model:null,effort:'max',kind:'stage'}));
  h.work.begin(h.goal.id,'manual');await h.drain();h.work.tick();await immediate();
  const cancelled=h.engine.run(h.run.id);cancelled.status='cancelled';cancelled.cancelRequested=true;cancelled.controlRevision=1;h.store.put('run',cancelled);
  release({status:'ready',action:'continue',account:{expiresAt:new Date(Date.now()+60000).toISOString()}});await h.drain();
  assert.equal(currentWorkRecovery(h.get())?.phase,'cancelled');assert.equal(h.engine.run(h.run.id).status,'cancelled');assert.equal(h.engine.run(h.run.id).cancelRequested,true);
});

test('completed delegated work resumes coordination without repeating any step',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.status='completed';run.stages[1].status='completed';h.store.put('run',run);
  const coordinator={...structuredClone(run),id:h.goal.routerRunId,executionKind:'agent-goal' as const,stages:[structuredClone(run.stages[0])]};h.store.put('run',coordinator);
  const goal=h.get();goal.status='failed';h.store.put('intake',goal);h.setActive(false);h.context.family=()=>[h.engine.run(run.id),h.engine.run(coordinator.id)];
  h.work.begin(h.goal.id,'manual');await h.drain();assert.equal(h.resumptions(),1);assert.deepEqual(h.engine.run(run.id),run);assert.equal(currentWorkRecovery(h.get())?.phase,'resuming');h.work.close();
});
