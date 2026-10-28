import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';
import type {AccountAllowanceObservation} from '../src/account-allowance-types.ts';
import type {Actor,Intake,Project,ResolveRunInput,Run,TaskOutput,Usage} from '../src/contracts.ts';
import {defaultRoles} from '../src/defaults.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import type {CodexAdapter,GithubAdapter} from '../src/adapters/types.ts';

const OWNER:Actor={name:'Synthetic resolution owner',kind:'human'};
const AT='2026-10-28T00:00:00.000Z';
const code=(value:string)=>(error:unknown)=>error instanceof AppError&&error.code===value;
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t:TestContext,options:{dispatch?:boolean}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-run-resolution-')),store=new Store(directory);
  const codex={close:async()=>{},start:async()=>{throw new Error('A resolution fixture must not call a model.');}} as unknown as CodexAdapter;
  const engine=new Engine(store,codex,{} as GithubAdapter);if(!options.dispatch)t.mock.method(engine,'tick',async()=>{});
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  const project:Project={id:'synthetic-project',revision:1,name:'Synthetic resolution project',description:'Independently authored local recovery fixtures.',workspace:directory,repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:AT,updatedAt:AT};store.put('project',project);
  const pipeline={id:'synthetic-flow',projectId:project.id,revision:1,name:'Bounded synthetic work',description:'Retain upstream acceptance.',roleId:'development',policy:{concurrency:1,maxAttempts:3,maxIterations:1,timeoutSeconds:300,tokenBudget:10000},updatedAt:AT,stages:[{id:'prepare',name:'Prepare input',roleId:'development',executor:'codex' as const,dependsOn:[],prompt:'Prepare synthetic input.',review:false},{id:'work',name:'Inspect input',roleId:'development',executor:'codex' as const,dependsOn:['prepare'],prompt:'Inspect the retained synthetic input.',review:false}]};
  const run:Run={id:'synthetic-run',projectId:project.id,pipelineId:pipeline.id,goal:'Inspect synthetic input.',baseline:'Existing synthetic state.',trigger:{kind:'human',actor:OWNER.name},status:'failed',iteration:1,mode:'once',createdAt:AT,updatedAt:AT,endedAt:AT,dependsOnRunIds:[],idempotencyKey:'synthetic-original-work',inputHash:'synthetic-original-work',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'prepare',status:'completed',attempts:[{id:'accepted-upstream',number:1,iteration:1,status:'completed',startedAt:AT,endedAt:AT,usage:{input:10,output:5,total:15},output:{outcome:'done',summary:'Accepted input remains available.',artifacts:[{label:'Synthetic retained input',path:'prepared.txt'}],observations:[]}}]},{stageId:'work',status:'failed',attempts:[{id:'failed-worker',number:1,iteration:1,status:'failed',startedAt:AT,endedAt:AT,error:'Synthetic recoverable failure.',usage:{input:10,output:5,total:15}}]}]};store.put('run',run);
  const input=(key='synthetic-resolve'):ResolveRunInput=>({stageId:'work',attemptId:'failed-worker',controlRevision:0,idempotencyKey:key,note:'Inspect the retained input before retrying.'});
  const external=()=>store.put('multica-execution',{id:'failed-worker',runId:run.id,stageId:'work',status:'unknown',cleanupConfirmed:false,usage:{input:10,output:5,total:15}});
  const confirm=()=>store.put('multica-execution',{id:'failed-worker',runId:run.id,stageId:'work',status:'cancelled',cleanupConfirmed:true,usage:{input:10,output:5,total:15}});
  const accountState={now:Date.parse(AT),used:20,available:true,reads:0};
  const account=()=>{const reader={async readAccountAllowance():Promise<AccountAllowanceObservation>{accountState.reads++;return normalizeAccountObservation(accountState.available?{status:'available',source:'local-codex',accountKey:createHash('sha256').update('independent-synthetic-account').digest('hex'),observedAt:new Date(accountState.now).toISOString(),expiresAt:new Date(accountState.now+60000).toISOString(),windows:[{bucketId:'synthetic-window',slot:'primary',usedPercent:accountState.used,windowDurationMins:300,resetsAt:accountState.now/1000+86400}],exhausted:accountState.used>=100}:{status:'unavailable',reason:'Synthetic observation is unavailable.'},accountState.now);}};const service=new AccountAllowanceService(store,reader,{now:()=>accountState.now});engine.accountAllowances=service;engine.accountModelResolver=async()=> 'synthetic-resolved-model';const current=engine.run(run.id);current.resourceMode='account';store.put('run',current);return service;};
  return{directory,store,engine,codex,run,input,external,confirm,account,accountState};
}

test('one action continues only the failed step and records its note and durable receipt',async t=>{
  const h=await fixture(t),upstream=structuredClone(h.run.stages[0]),snapshot=structuredClone(h.run.snapshot);
  const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,'continued');
  const current=h.engine.run(h.run.id);assert.equal(current.status,'queued');assert.equal(current.stages[1].status,'queued');assert.deepEqual(current.stages[0],upstream);assert.deepEqual(current.snapshot,snapshot);assert.equal(current.limitRevisions,undefined);assert.equal(current.stages[1].attempts[0].review?.note,h.input().note);
  assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.retry').length,1);
  assert.equal(h.store.events({runId:h.run.id}).find(event=>event.type==='run.resolution_requested')?.message,h.input().note);
  assert.deepEqual(await h.engine.resolveWaiting(h.run.id,h.input(),OWNER),result);
  assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.retry').length,1);
  await assert.rejects(h.engine.resolveWaiting(h.run.id,{...h.input(),note:'Different work under the same request identity.'},OWNER),code('IDEMPOTENCY_CONFLICT'));
  await h.engine.close();const restored=new Engine(new Store(h.directory),h.codex,{} as GithubAdapter);try{assert.deepEqual(await restored.resolveWaiting(h.run.id,h.input(),OWNER),result);}finally{await restored.close();}
});

test('exact external termination is checked and cancelled before one focused continuation',async t=>{
  const h=await fixture(t);h.external();let checks=0;
  h.engine.reconcileExternal=async(runId,stageId,options)=>{assert.equal(runId,h.run.id);assert.equal(stageId,'work');assert.equal(options.cancelIfRunning,true);assert.equal(options.signal.aborted,false);checks++;h.confirm();return{status:'cancelled',cleanupConfirmed:true};};
  assert.equal((await h.engine.resolveWaiting(h.run.id,h.input(),OWNER)).status,'continued');assert.equal(checks,1);assert.equal(h.engine.run(h.run.id).stages[0].status,'completed');
});

test('unconfirmed external termination returns the current decision without replacement work',async t=>{
  const h=await fixture(t);h.external();h.engine.reconcileExternal=async()=>({status:'running',cleanupConfirmed:false});
  const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,'needs_input');if(result.status==='needs_input'){assert.equal(result.recovery.action,'reconcile');assert.equal(result.recovery.code,'EXTERNAL_RECONCILIATION_REQUIRED');}
  assert.deepEqual(h.engine.run(h.run.id),h.run);assert.equal(h.store.list('run-resolution').length,0);
});

test('a never-settling external check has a finite cancellable deadline',async t=>{
  const h=await fixture(t);h.external();const deadlines=new Map<number,AbortController[]>();
  t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{const controller=new AbortController();deadlines.set(milliseconds,[...(deadlines.get(milliseconds)??[]),controller]);return controller.signal;});
  const started=deferred<AbortSignal>();h.engine.reconcileExternal=async(_runId,_stageId,options)=>{started.resolve(options.signal);return new Promise(()=>{});};
  const pending=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),signal=await started.promise;deadlines.get(5000)![0].abort(new Error('Synthetic check deadline.'));
  const result=await pending;assert.equal(signal.aborted,true);assert.equal(result.status,'needs_input');assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.store.list('run-resolution').length,0);
});

test('concurrent repeats share one check and cannot dispatch twice under another key',async t=>{
  const h=await fixture(t);h.external();const gate=deferred<{status:string;cleanupConfirmed:boolean}>(),started=deferred<void>();let checks=0;
  h.engine.reconcileExternal=async()=>{checks++;started.resolve();return gate.promise;};
  const left=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),right=h.engine.resolveWaiting(h.run.id,h.input(),OWNER);await started.promise;
  await assert.rejects(h.engine.resolveWaiting(h.run.id,h.input('different-click'),OWNER),code('RECOVERY_IN_PROGRESS'));h.confirm();gate.resolve({status:'cancelled',cleanupConfirmed:true});
  assert.deepEqual(await left,await right);assert.equal(checks,1);assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.retry').length,1);
});

test('Stop aborts a pending exact task check and late completion cannot revive it',async t=>{
  const h=await fixture(t);h.external();const gate=deferred<{status:string;cleanupConfirmed:boolean}>(),started=deferred<AbortSignal>();
  h.engine.reconcileExternal=async(_run,_stage,options)=>{started.resolve(options.signal);return gate.promise;};
  const pending=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),rejected=assert.rejects(pending,code('RECOVERY_CANCELLED')),signal=await started.promise;
  const stopped=await h.engine.cancel(h.run.id,'Stop the requested continuation.',OWNER);assert.equal(signal.aborted,true);await rejected;h.confirm();gate.resolve({status:'cancelled',cleanupConfirmed:true});await immediate();
  assert.equal(stopped.status,'cancelled');assert.equal(h.engine.run(h.run.id).cancelRequested,true);assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.store.list('run-resolution').length,0);
});

test('changed attempts or finite limits invalidate an in-flight continuation',async t=>{
  for(const change of ['attempt','limits'] as const){
    const h=await fixture(t);h.external();const gate=deferred<{status:string;cleanupConfirmed:boolean}>(),started=deferred<void>();h.engine.reconcileExternal=async()=>{started.resolve();return gate.promise;};
    const pending=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),rejected=assert.rejects(pending,code('RECOVERY_CONFLICT'));await started.promise;
    const run=h.engine.run(h.run.id);if(change==='attempt')run.stages[1].attempts.push({...run.stages[1].attempts[0],id:'newer-attempt',number:2});else run.approvedPolicy={...run.snapshot.pipeline.policy,maxAttempts:4};h.store.put('run',run);h.confirm();gate.resolve({status:'cancelled',cleanupConfirmed:true});await rejected;
    assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.store.list('run-resolution').length,0);
  }
});

test('real attempt and time boundaries require the displayed exact owner decision',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.approvedPolicy={...run.snapshot.pipeline.policy,maxAttempts:1};run.stages[1].attempts[0].failureCode='STAGE_TIMEOUT';h.store.put('run',run);
  const pending=await h.engine.resolveWaiting(run.id,h.input(),OWNER);assert.equal(pending.status,'needs_input');if(pending.status!=='needs_input')return;
  assert.equal(pending.recovery.action,'approve');assert.equal(pending.recovery.recommendation?.limits.maxAttempts,2);assert.equal(pending.recovery.recommendation?.limits.timeoutSeconds,600);assert.equal(h.engine.run(run.id).limitRevisions,undefined);
  const stale=await h.engine.resolveWaiting(run.id,{...h.input('stale-approval'),approveRecommendation:true,recoveryKey:'forged-key'},OWNER);assert.equal(stale.status,'needs_input');if(stale.status==='needs_input')assert.equal(stale.recovery.recoveryKey,pending.recovery.recoveryKey);assert.equal(h.engine.run(run.id).limitRevisions,undefined);
  const result=await h.engine.resolveWaiting(run.id,{...h.input('approved-finite-step'),approveRecommendation:true,recoveryKey:pending.recovery.recoveryKey},OWNER);assert.equal(result.status,'continued');assert.equal(h.engine.run(run.id).limitRevisions?.length,1);assert.equal(h.engine.run(run.id).stages[0].status,'completed');
});

test('healthy account readings and missing comparison samples do not invent an approval',async t=>{
  const h=await fixture(t);h.account();const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);
  assert.equal(result.status,'continued');assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);assert.equal(h.engine.run(h.run.id).limitRevisions,undefined);assert.equal(h.accountState.reads,1);assert.equal(h.store.list('account-allowance-execution').length,0);
});

test('unknown, near-limit and exhausted account states remain actual decisions',async t=>{
  for(const state of ['unknown','caution','exhausted'] as const){
    const h=await fixture(t);h.accountState.available=state!=='unknown';h.accountState.used=state==='exhausted'?100:state==='caution'?98:20;h.account();
    const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,'needs_input');if(result.status==='needs_input'){assert.equal(result.recovery.account?.status,state==='unknown'?'unavailable':state);assert.equal(result.recovery.action,state==='exhausted'?'blocked':'approve');}
    assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);
  }
});

test('a disconnected observer cannot authorize an account-mode continuation',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.resourceMode='account';h.store.put('run',run);
  const result=await h.engine.resolveWaiting(run.id,h.input(),OWNER);assert.equal(result.status,'needs_input');if(result.status==='needs_input')assert.equal(result.recovery.code,'ACCOUNT_UNAVAILABLE');assert.equal(h.engine.run(run.id).stages[1].status,'failed');
});

test('an exact unused owner permit is reused, but used or revoked permits do not authorize work',async t=>{
  for(const permitState of ['unused','used','revoked'] as const){
    const h=await fixture(t);h.accountState.used=98;h.account();const target=await h.engine.resolvedAllowanceTarget(h.engine.run(h.run.id),'work'),assessment=await h.engine.accountAllowances!.assess(target),permit=await h.engine.approveAccountStep(target,assessment.key,OWNER),run=h.engine.run(h.run.id);run.accountApprovals=[{...permit,...(permitState==='used'?{used:true}:permitState==='revoked'?{revoked:true}:{})}];h.store.put('run',run);
    const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,permitState==='unused'?'continued':'needs_input');assert.equal(h.engine.run(h.run.id).accountApprovals?.length,1);assert.equal(h.engine.run(h.run.id).accountApprovals?.[0].used,permitState==='used'?true:undefined);
  }
});

test('stale initial attempt and Stop identities fail before external or account work',async t=>{
  const h=await fixture(t);h.external();let checks=0;h.engine.reconcileExternal=async()=>{checks++;return{status:'cancelled',cleanupConfirmed:true};};
  await assert.rejects(h.engine.resolveWaiting(h.run.id,{...h.input(),attemptId:'outdated-attempt'},OWNER),code('RECOVERY_CONFLICT'));
  await assert.rejects(h.engine.resolveWaiting(h.run.id,{...h.input(),controlRevision:3},OWNER),code('RECOVERY_CONFLICT'));assert.equal(checks,0);
  const run=h.engine.run(h.run.id);run.cancelRequested=true;run.status='cancelled';h.store.put('run',run);
  await assert.rejects(h.engine.resolveWaiting(h.run.id,h.input(),OWNER),code('RECOVERY_CANCELLED'));assert.equal(checks,0);
});

test('a displayed account decision needs its exact owner approval and never grants new limits',async t=>{
  const h=await fixture(t);h.accountState.used=98;h.account();const current=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(current.status,'needs_input');if(current.status!=='needs_input')return;
  const approval={...h.input('approve-one-step'),recoveryKey:current.recovery.recoveryKey,approveAccountStep:true,accountAssessmentKey:current.recovery.account!.key};
  await assert.rejects(h.engine.resolveWaiting(h.run.id,{...approval,idempotencyKey:'forged-account-step',accountAssessmentKey:'forged-key'},OWNER),code('ACCOUNT_ALLOWANCE_CHANGED'));
  assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);assert.equal((await h.engine.resolveWaiting(h.run.id,approval,OWNER)).status,'continued');assert.equal(h.engine.run(h.run.id).accountApprovals?.length,1);assert.equal(h.engine.run(h.run.id).limitRevisions,undefined);
});

test('account evidence changing before approval preserves the failed step for a new decision',async t=>{
  const h=await fixture(t);h.accountState.used=98;const service=h.account(),current=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);if(current.status!=='needs_input')assert.fail('A caution reading needs the exact owner decision.');
  h.accountState.now+=1000;h.accountState.used=100;await service.assess(await h.engine.resolvedAllowanceTarget(h.engine.run(h.run.id),'work'),{refresh:true});
  const latest=await h.engine.resolveWaiting(h.run.id,{...h.input('outdated-account-approval'),recoveryKey:current.recovery.recoveryKey,approveAccountStep:true,accountAssessmentKey:current.recovery.account!.key},OWNER);assert.equal(latest.status,'needs_input');if(latest.status==='needs_input'){assert.equal(latest.recovery.account?.status,'exhausted');assert.equal(latest.recovery.code,'ACCOUNT_EXHAUSTED');assert.notEqual(latest.recovery.recoveryKey,current.recovery.recoveryKey);}
  assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');
});

test('a changed caution reading returns its current exact approval without consuming the previous decision',async t=>{
  const h=await fixture(t);h.accountState.used=98;const service=h.account(),prior=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);if(prior.status!=='needs_input')assert.fail('The initial caution reading needs an owner decision.');
  h.accountState.now+=1000;h.accountState.used=97;await service.assess(await h.engine.resolvedAllowanceTarget(h.engine.run(h.run.id),'work'),{refresh:true});
  const latest=await h.engine.resolveWaiting(h.run.id,{...h.input('changed-caution-approval'),recoveryKey:prior.recovery.recoveryKey,approveAccountStep:true,accountAssessmentKey:prior.recovery.account!.key},OWNER);assert.equal(latest.status,'needs_input');if(latest.status==='needs_input'){assert.equal(latest.recovery.action,'approve');assert.equal(latest.recovery.account?.status,'caution');assert.notEqual(latest.recovery.account?.key,prior.recovery.account!.key);}
  assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);assert.equal(h.store.list('run-resolution').length,0);
});

test('resolve uses current healthy authorization without applying an obsolete approval while legacy continue stays strict',async t=>{
  const h=await fixture(t),service=h.account(),prior=await h.engine.recoveryWithAccount(h.run.id,'work',OWNER);
  h.accountState.now+=1000;h.accountState.used=21;await service.assess(await h.engine.resolvedAllowanceTarget(h.engine.run(h.run.id),'work'),{refresh:true});
  await assert.rejects(h.engine.continueWithAccount(h.run.id,{stageId:'work',recoveryKey:prior.recoveryKey},OWNER),code('RECOVERY_CONFLICT'));assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');
  const latest=await h.engine.resolveWaiting(h.run.id,{...h.input('current-healthy-authorization'),recoveryKey:prior.recoveryKey,approveAccountStep:true,accountAssessmentKey:prior.account!.key},OWNER);assert.equal(latest.status,'continued');assert.equal(h.engine.run(h.run.id).stages[1].status,'queued');assert.equal(h.engine.run(h.run.id).accountApprovals,undefined);assert.equal(h.engine.run(h.run.id).limitRevisions,undefined);
});

test('a bounded decision read cannot write a late continuation after its deadline',async t=>{
  const h=await fixture(t);h.account();const deadlines=new Map<number,AbortController[]>();t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{const controller=new AbortController();deadlines.set(milliseconds,[...(deadlines.get(milliseconds)??[]),controller]);return controller.signal;});
  const model=deferred<string>(),started=deferred<void>();h.engine.accountModelResolver=()=>{started.resolve();return model.promise;};
  const pending=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),rejected=assert.rejects(pending,/Synthetic resolution deadline/);await started.promise;deadlines.get(15000)![0].abort(new Error('Synthetic resolution deadline.'));await rejected;model.resolve('synthetic-resolved-model');await immediate();
  assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');assert.equal(h.store.list('run-resolution').length,0);
});

test('explicitly declining retry preserves failed evidence, revokes permits and cannot revive work',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id),stages=structuredClone(run.stages),snapshot=structuredClone(run.snapshot);run.accountApprovals=[{stageId:'work',assessmentKey:'synthetic-key',accountSnapshotId:'synthetic-snapshot',actor:OWNER.name,at:AT}];h.store.put('run',run);
  await assert.rejects(h.engine.cancel(run.id,'No further retry.',OWNER),code('RUN_FINISHED'));
  const stopped=await h.engine.cancel(run.id,'No further retry.',OWNER,{declineRetry:true});assert.equal(stopped.status,'cancelled');assert.equal(stopped.controlRevision,1);assert.equal(stopped.cancelRequested,true);assert.equal(stopped.accountApprovals?.[0].revoked,true);assert.deepEqual(stopped.stages,stages);assert.deepEqual(stopped.snapshot,snapshot);
  assert.deepEqual(await h.engine.cancel(run.id,'No further retry.',OWNER,{declineRetry:true}),stopped);assert.equal(h.store.events({runId:run.id}).filter(event=>event.type==='run.retry_declined').length,1);
  assert.equal(h.engine.recovery(run.id,'work',OWNER).code,'RUN_CANCELLED');assert.throws(()=>h.engine.retry(run.id,'work','An outdated view must not restart declined work.',OWNER),code('RECOVERY_CANCELLED'));
  await assert.rejects(h.engine.resolveWaiting(run.id,{...h.input('outdated-after-decline'),controlRevision:1},OWNER),code('RECOVERY_CANCELLED'));assert.equal(h.store.list('run-resolution').length,0);
});

test('a scoped agent cannot record an owner retry refusal',async t=>{
  const h=await fixture(t);await assert.rejects(h.engine.cancel(h.run.id,'A worker must not invent owner refusal.',{name:'synthetic-worker',kind:'agent',projectId:h.run.projectId},{declineRetry:true}),code('OWNER_REQUIRED'));assert.deepEqual(h.engine.run(h.run.id),h.run);
});

test('completed work cannot be declined or changed through retry refusal',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.status='completed';run.stages[1].status='completed';h.store.put('run',run);
  await assert.rejects(h.engine.cancel(run.id,'Refusal from an outdated view.',OWNER,{declineRetry:true}),code('RUN_FINISHED'));assert.deepEqual(h.engine.run(run.id),run);assert.equal(h.store.events({runId:run.id}).filter(event=>event.type==='run.retry_declined').length,0);
});

test('declining a pending failed continuation aborts its exact check and records refusal once',async t=>{
  const h=await fixture(t);h.external();const started=deferred<AbortSignal>();h.engine.reconcileExternal=async(_run,_stage,options)=>{started.resolve(options.signal);return new Promise(()=>{});};
  const pending=h.engine.resolveWaiting(h.run.id,h.input(),OWNER),rejected=assert.rejects(pending,code('RECOVERY_CANCELLED')),signal=await started.promise;
  await h.engine.cancel(h.run.id,'Decline this retry.',OWNER,{declineRetry:true});await rejected;assert.equal(signal.aborted,true);assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='run.retry_declined').length,1);assert.equal(h.engine.run(h.run.id).stages[1].status,'failed');
});

test('closed owning goals block historical child resolution and direct retry without erasing evidence',async t=>{
  for(const status of ['completed','stopped'] as const)await t.test(status,async sub=>{
    const h=await fixture(sub);new IntakeService(h.engine);
    const goal:Intake={id:'synthetic-owning-goal',projectId:h.run.projectId,request:h.run.goal,baseline:h.run.baseline,status,createdAt:AT,updatedAt:AT,routerRunId:'synthetic-ended-coordinator',targetRunIds:[h.run.id],rounds:[],idempotencyKey:'synthetic-owning-goal',policy:{maxRounds:4,maxParallel:2,maxElapsedSeconds:3600,maxTotalTokens:100000}};h.store.put('intake',goal);
    const recovery=h.engine.recovery(h.run.id,'work',OWNER);assert.equal(recovery.action,'blocked');assert.equal(recovery.code,'GOAL_CLOSED');assert.equal(recovery.goal?.status,status);assert.deepEqual(recovery.scope,{kind:'goal',id:goal.id});
    const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,'needs_input');if(result.status==='needs_input')assert.equal(result.recovery.code,'GOAL_CLOSED');
    assert.throws(()=>h.engine.retry(h.run.id,'work','A historical view cannot reopen its closed owner.',OWNER),code('GOAL_CLOSED'));assert.deepEqual(h.engine.run(h.run.id),h.run);assert.equal(h.store.list('run-resolution').length,0);
    // Explicit recovery of a stopped goal transitions it before its retained child may continue.
    if(status==='stopped'){h.store.put('intake',{...goal,status:'failed'});assert.equal(h.engine.recovery(h.run.id,'work',OWNER).action,'retry');assert.equal((await h.engine.resolveWaiting(h.run.id,h.input('explicit-owner-recovery'),OWNER)).status,'continued');}
  });
});

test('resuming an interrupted paused run preserves its failure and original limits',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.pausedAt=AT;run.status='interrupted';run.stages[1].status='interrupted';run.stages[1].attempts[0].status='interrupted';h.store.put('run',run);
  assert.equal(h.engine.recovery(run.id,'work',OWNER).code,'RUN_PAUSED');assert.throws(()=>h.engine.retry(run.id,'work','Resume must be explicit.',OWNER),code('RUN_PAUSED'));
  const resumed=h.engine.resume(run.id,OWNER);assert.equal(resumed.status,'interrupted');assert.equal(resumed.pausedAt,undefined);assert.equal(resumed.endedAt,run.endedAt);assert.deepEqual(resumed.stages,run.stages);assert.deepEqual(resumed.snapshot,run.snapshot);assert.equal(resumed.limitRevisions,undefined);assert.equal(h.engine.recovery(run.id,'work',OWNER).action,'retry');
});

test('real scheduling sees a committed continuation receipt before native or connected adapter startup',async t=>{
  for(const mode of ['legacy-native','account-connected'] as const)await t.test(mode,async sub=>{
    const h=await fixture(sub,{dispatch:true});if(mode==='account-connected')h.account();
    const observer=new Store(h.directory);sub.after(()=>observer.close());const started=deferred<void>(),completion=deferred<{output:TaskOutput;usage:Usage}>();let visibleReceipts=0,starts=0;
    const finished={output:{outcome:'done' as const,summary:'Synthetic committed continuation completed.',artifacts:[],observations:[]},usage:{input:0,output:0,total:0}};
    h.codex.start=async input=>{starts++;visibleReceipts=observer.list('run-resolution').length;started.resolve();input.signal.addEventListener('abort',()=>completion.resolve(finished),{once:true});return{ref:{threadId:'synthetic-committed-thread',turnId:'synthetic-committed-turn'},completion:completion.promise};};
    if(mode==='account-connected')h.engine.agentExecutor={start:input=>h.codex.start(input),steer:async()=>{}};
    const result=await h.engine.resolveWaiting(h.run.id,h.input(),OWNER);assert.equal(result.status,'continued');await started.promise;
    assert.equal(starts,1);assert.equal(visibleReceipts,1,'A separate SQLite connection observes the committed receipt before any adapter starts.');completion.resolve(finished);await immediate();
  });
});

test('a failed receipt write rolls back the retry without invoking either execution adapter',async t=>{
  for(const mode of ['legacy-native','account-connected'] as const)await t.test(mode,async sub=>{
    const h=await fixture(sub,{dispatch:true});if(mode==='account-connected')h.account();const before=h.engine.run(h.run.id);let starts=0;
    h.codex.start=async()=>{starts++;return{ref:{threadId:'synthetic-must-not-start',turnId:'synthetic-must-not-start'},completion:Promise.resolve({output:{outcome:'done',summary:'Unexpected synthetic startup.',artifacts:[],observations:[]},usage:{input:0,output:0,total:0}})};};
    if(mode==='account-connected')h.engine.agentExecutor={start:input=>h.codex.start(input),steer:async()=>{}};
    const put=h.store.put.bind(h.store);sub.mock.method(h.store,'put',<T extends {id:string}>(kind:string,value:T)=>{if(kind==='run-resolution')throw new Error('Synthetic durable receipt write failed.');return put(kind,value);});
    await assert.rejects(h.engine.resolveWaiting(h.run.id,h.input(),OWNER),/Synthetic durable receipt write failed/);await immediate();
    assert.equal(starts,0);assert.deepEqual(h.engine.run(h.run.id),before);assert.equal(h.store.list('run-resolution').length,0);assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.retry').length,0);
  });
});

test('ordinary finite continuation commits its approved limits before actual scheduler dispatch',async t=>{
  const h=await fixture(t,{dispatch:true}),run=h.engine.run(h.run.id);run.approvedPolicy={...run.snapshot.pipeline.policy,maxAttempts:1};h.store.put('run',run);
  const observer=new Store(h.directory);t.after(()=>observer.close());const started=deferred<void>();let observedRevisions=0;
  h.codex.start=async()=>{observedRevisions=observer.get<Run>('run',run.id)?.limitRevisions?.length??0;started.resolve();return{ref:{threadId:'synthetic-approved-thread',turnId:'synthetic-approved-turn'},completion:Promise.resolve({output:{outcome:'done',summary:'Synthetic approved continuation finished.',artifacts:[],observations:[]},usage:{input:0,output:0,total:0}})};};
  const recovery=h.engine.recovery(run.id,'work',OWNER);assert.equal(recovery.action,'approve');h.engine.continueRun(run.id,{stageId:'work',recoveryKey:recovery.recoveryKey,approveRecommendation:true},OWNER);await started.promise;await immediate();assert.equal(observedRevisions,1,'Approved limits are visible to another connection before the adapter starts.');
});
