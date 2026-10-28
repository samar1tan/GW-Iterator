import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Actor,Run} from '../src/contracts.ts';
import type {AllowanceTarget,AccountAllowanceObservation} from '../src/account-allowance-types.ts';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';

const OWNER:Actor={kind:'human',name:'Synthetic account admission reviewer'};
const NOW=Date.UTC(2026,9,27),RESET=NOW/1000+86400;
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;

async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-admission-test-')),workspace=path.join(directory,'source');await mkdir(workspace);
  const store=new Store(path.join(directory,'state')),engine=new Engine(store,{async info(){return{available:true,connected:true,models:[]};},async skills(){return[];},async start(){throw new Error('No paid task may run in this fixture.');},async steer(){},async interrupt(){},async close(){}},{async info(){return{available:true,authenticated:true};},async observe(){throw new Error('No external CI may run in this fixture.');},async dispatch(){throw new Error('No external CI may run in this fixture.');}});
  const project=await engine.createProject({name:'Synthetic account admission',workspace},OWNER),pipeline=structuredClone(engine.detail(project.id,OWNER).pipelines[0]);
  pipeline.stages=[{id:'work',name:'Synthetic bounded worker',roleId:'development',executor:'codex',dependsOn:[],prompt:'Use only independently authored synthetic input.',review:false}];
  const state={now:NOW,used:82,reads:0};
  const reader={async readAccountAllowance():Promise<AccountAllowanceObservation>{state.reads++;return normalizeAccountObservation({status:'available',source:'local-codex',accountKey:createHash('sha256').update('synthetic-account').digest('hex'),observedAt:new Date(state.now).toISOString(),expiresAt:new Date(state.now+60000).toISOString(),windows:[{bucketId:'synthetic-codex',slot:'primary',usedPercent:state.used,windowDurationMins:300,resetsAt:RESET}],exhausted:state.used>=100},state.now);}};
  const service=new AccountAllowanceService(store,reader,{now:()=>state.now});engine.accountAllowances=service;engine.accountModelResolver=async()=> 'synthetic-resolved-model';
  const target:AllowanceTarget={projectId:project.id,pipelineId:pipeline.id,stageId:'work',roleId:'development',model:'synthetic-resolved-model',effort:'max',kind:'stage'};
  const run=(id:string,resourceMode:'account'|'tokens'='account'):Run=>{const at=new Date(state.now).toISOString(),value:Run={id,projectId:project.id,pipelineId:pipeline.id,goal:'Inspect synthetic admission only.',baseline:'Synthetic source.',resourceMode,trigger:{kind:'human',actor:OWNER.name},status:'running',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:id,inputHash:id,approvedPolicy:structuredClone(pipeline.policy),snapshot:{project:structuredClone(project),pipeline:structuredClone(pipeline),pipelines:[structuredClone(pipeline)],knowledge:[]},stages:[{stageId:'work',status:'running',attempts:[{id:id+'-attempt',number:1,iteration:1,status:'running',startedAt:at}]}]};store.put('run',value);return value;};
  const history=async()=>{for(let index=0;index<3;index++){const execution=await service.begin(target);state.now+=1000;state.used+=4;await service.finish(execution.id,{status:'completed',dispatched:true});state.now+=1000;}};
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  return{engine,store,service,state,target,run,history,project,pipeline,reader};
}

test('concurrent admission reserves one shared account view before admitting another execution',async t=>{
  const h=await fixture(t);await h.history();const before=await h.service.assess(h.target,{refresh:true});
  assert.equal(before.status,'ready');assert.equal(before.account.windows[0].remainingPercent,6);assert.equal(before.trend.windows[0].highPercent,4);assert.equal(before.trend.comparableCount,3);
  h.run('synthetic-left');h.run('synthetic-right');
  const results=await Promise.allSettled(['synthetic-left','synthetic-right'].map(id=>h.engine.beginAccountExecution(id,'work','synthetic-resolved-model')));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');assert.equal((rejected.reason as AppError).code,'ACCOUNT_STEP_APPROVAL_REQUIRED');
  assert.equal((await h.service.assess(h.target)).activeExecutions,1);
  const accepted=results.find(result=>result.status==='fulfilled');assert.ok(accepted&&accepted.status==='fulfilled'&&accepted.value);await h.engine.finishAccountExecution(accepted.value.id,{status:'not_dispatched',dispatched:false});
});

test('an explicit expert token cap cannot bypass fresh account exhaustion',async t=>{
  const h=await fixture(t),run=h.run('synthetic-token-run','tokens'),snapshot=structuredClone(run.snapshot),policy=structuredClone(run.approvedPolicy);h.state.used=100;
  assert.equal((await h.service.assess(h.target)).status,'exhausted');const reads=h.state.reads;
  await assert.rejects(h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),code('ACCOUNT_EXHAUSTED'));
  assert.ok(h.state.reads>reads);assert.equal(h.store.list('account-allowance-execution').length,0);assert.deepEqual(h.engine.run(run.id).snapshot,snapshot);assert.deepEqual(h.engine.run(run.id).approvedPolicy,policy);assert.equal(h.engine.run(run.id).resourceMode,'tokens');
});

test('healthy account admission keeps the expert token safeguard and genuine reader-less legacy behavior',async t=>{
  const h=await fixture(t),run=h.run('synthetic-expert-healthy','tokens'),policy=structuredClone(run.approvedPolicy);h.state.used=20;
  const execution=await h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model');assert.ok(execution);assert.equal(h.engine.run(run.id).resourceMode,'tokens');assert.deepEqual(h.engine.run(run.id).approvedPolicy,policy);await h.engine.finishAccountExecution(execution.id,{status:'not_dispatched',dispatched:false});
  h.engine.accountAllowances=undefined;const reads=h.state.reads;assert.equal(await h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),null);assert.equal(h.state.reads,reads);
});

test('resolved inherited model context finds actual execution history and invalidates another model acknowledgement',async t=>{
  const h=await fixture(t);await h.history();const run=h.run('synthetic-inherited-model'),raw=h.engine.allowanceTarget(run,'work'),resolved=await h.engine.resolvedAllowanceTarget(run,'work');
  assert.equal(raw.model,null);assert.equal(resolved.model,'synthetic-resolved-model');assert.equal((await h.service.assess(resolved,{refresh:true})).trend.comparableCount,3);
  h.state.used=98;const assessment=await h.service.assess(resolved,{refresh:true});assert.equal(assessment.action,'owner-step');const approval=await h.engine.approveAccountStep(resolved,assessment.key,OWNER);run.accountApprovals=[approval];h.store.put('run',run);
  await assert.rejects(h.engine.beginAccountExecution(run.id,'work','synthetic-changed-model'),code('ACCOUNT_STEP_APPROVAL_REQUIRED'));assert.equal(h.engine.run(run.id).accountApprovals?.[0].used,undefined);assert.equal((await h.service.assess(resolved)).activeExecutions,0);
});

test('Stop cancels a pending account continuation even when its prior pipeline has already failed',async t=>{
  const h=await fixture(t),run=h.run('synthetic-failed-continuation');h.state.used=20;run.status='failed';run.endedAt=new Date(h.state.now).toISOString();run.stages[0].status='failed';Object.assign(run.stages[0].attempts[0],{status:'failed',endedAt:run.endedAt,usage:{input:0,output:0,total:0}});h.store.put('run',run);
  const recovery=await h.engine.recoveryWithAccount(run.id,'work',OWNER);assert.equal(recovery.action,'retry');
  let release!:(value:string)=>void,began!:()=>void;const pending=new Promise<string>(resolve=>{release=resolve;}),checking=new Promise<void>(resolve=>{began=resolve;});h.engine.accountModelResolver=()=>{began();return pending;};
  const continuation=h.engine.continueWithAccount(run.id,{stageId:'work',recoveryKey:recovery.recoveryKey},OWNER),rejected=assert.rejects(continuation,code('RECOVERY_CANCELLED'));await checking;
  const stopped=await h.engine.cancel(run.id,'Stop the pending continuation before another paid dispatch.',OWNER);assert.equal(stopped.status,'cancelled');release('synthetic-resolved-model');await rejected;
  assert.equal(h.engine.run(run.id).status,'cancelled');assert.equal(h.engine.run(run.id).stages[0].attempts.length,1);assert.equal(h.store.list('account-allowance-execution').length,0);assert.deepEqual(h.engine.run(run.id).snapshot,run.snapshot);
});

test('new conflicting account and token policy inputs are rejected without erasing explicit safeguards',async t=>{
  const h=await fixture(t);
  assert.throws(()=>h.engine.startRun({projectId:h.project.id,pipelineId:h.pipeline.id,goal:'Synthetic conflicting policy.',baseline:'Synthetic source.',idempotencyKey:'synthetic-conflicting-run',resourceMode:'account',limits:{tokenBudget:100}},OWNER),code('CONFLICTING_ALLOWANCE_POLICY'));
  const intake=new IntakeService(h.engine);assert.throws(()=>intake.create(h.project.id,{request:'Synthetic conflicting outcome.',idempotencyKey:'synthetic-conflicting-goal',resourceMode:'account',policy:{maxTotalTokens:1000}},OWNER),code('CONFLICTING_ALLOWANCE_POLICY'));
  assert.equal(h.store.list('run').length,0);assert.equal(h.store.list('intake').length,0);assert.equal(h.state.reads,0);
});

test('manual-only work starts and completes without consulting even a known exhausted account',async t=>{
  const h=await fixture(t);h.state.used=100;assert.equal((await h.service.assess()).status,'exhausted');const reads=h.state.reads;
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'development',name:'Synthetic manual owner review'},OWNER),flow=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'accept',name:'Record synthetic manual evidence',roleId:'development',executor:'manual',ownerGate:true,dependsOn:[],prompt:'Inspect the synthetic evidence.',review:false}]},OWNER),run=h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Accept synthetic manual work.',baseline:'Synthetic source.',idempotencyKey:'synthetic-manual-no-account'},OWNER);
  await h.engine.tick();assert.equal(h.engine.run(run.id).status,'waiting');assert.equal(h.state.reads,reads);
  h.engine.completeManual(run.id,'accept',{outcome:'done',summary:'Synthetic owner acceptance recorded.',artifacts:[],observations:[]},OWNER);assert.equal(h.engine.run(run.id).status,'completed');assert.equal(h.state.reads,reads);assert.equal(h.store.list('account-allowance-execution').length,0);
});

test('changing healthy provider readings do not create a false admission hold or a second preflight read',async t=>{
  const h=await fixture(t),run=h.run('synthetic-changing-healthy'),read=h.reader.readAccountAllowance.bind(h.reader);h.state.used=68;
  h.reader.readAccountAllowance=async()=>{const observation=await read();h.state.used++;return observation;};
  const execution=await h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model');
  assert.ok(execution);assert.equal(h.state.reads,1);assert.equal(execution.before.windows[0].remainingPercent,32);assert.equal(h.engine.run(run.id).stages[0].allowanceHold,undefined);
  assert.equal(h.store.list('account-allowance-execution').length,1);await h.engine.finishAccountExecution(execution.id,{status:'not_dispatched',dispatched:false});
});

test('Stop and changed attempts during a fresh account read prevent admission before ledger reservation',async t=>{
  for(const change of ['stop','attempt']as const)await t.test(change,async sub=>{
    const h=await fixture(sub),run=h.run('synthetic-pending-'+change),read=h.reader.readAccountAllowance.bind(h.reader);
    let release!:()=>void,began!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),checking=new Promise<void>(resolve=>{began=resolve;});
    h.reader.readAccountAllowance=async()=>{const observation=await read();began();await pending;return observation;};
    const admission=h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),rejected=assert.rejects(admission,code('ACCOUNT_EXECUTION_CANCELLED'));await checking;
    if(change==='stop')await h.engine.cancel(run.id,'Stop synthetic pending admission.',OWNER);
    else{const current=h.engine.run(run.id);current.stages[0].attempts[0].id='synthetic-replacement-attempt';h.store.put('run',current);}
    release();await rejected;assert.equal(h.store.list('account-allowance-execution').length,0);
  });
});

test('caution admission keeps exact, unrevoked and single-use owner permits',async t=>{
  for(const condition of ['missing','changed-key','changed-snapshot','revoked','used','valid']as const)await t.test(condition,async sub=>{
    const h=await fixture(sub),run=h.run('synthetic-caution-'+condition);h.state.used=98;
    const assessment=await h.service.assess(h.target,{refresh:true});assert.equal(assessment.action,'owner-step');
    if(condition!=='missing'){
      const permit=await h.engine.approveAccountStep(h.target,assessment.key,OWNER);
      if(condition==='changed-key')permit.assessmentKey='synthetic-wrong-assessment';
      if(condition==='changed-snapshot')permit.accountSnapshotId='synthetic-wrong-account';
      if(condition==='revoked')permit.revoked=true;
      if(condition==='used')permit.used=true;
      run.accountApprovals=[permit];h.store.put('run',run);
    }
    if(condition==='valid'){
      const execution=await h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model');assert.ok(execution);assert.equal(h.engine.run(run.id).accountApprovals?.[0].used,true);
      await assert.rejects(h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),code('ACCOUNT_STEP_APPROVAL_REQUIRED'));
      assert.equal(h.store.list('account-allowance-execution').length,1);await h.engine.finishAccountExecution(execution.id,{status:'not_dispatched',dispatched:false});
    }else{
      await assert.rejects(h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),code('ACCOUNT_STEP_APPROVAL_REQUIRED'));assert.equal(h.store.list('account-allowance-execution').length,0);
    }
  });
});

test('a freshly checked unavailable reading still requires and accepts one exact owner decision',async t=>{
  const h=await fixture(t),run=h.run('synthetic-unavailable-owner-step'),read=h.reader.readAccountAllowance.bind(h.reader);
  h.reader.readAccountAllowance=async()=>{const observation=await read();return normalizeAccountObservation({...observation,observedAt:new Date(h.state.now-90000).toISOString(),expiresAt:new Date(h.state.now-30000).toISOString()},h.state.now);};
  await assert.rejects(h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model'),code('ACCOUNT_STEP_APPROVAL_REQUIRED'));
  const assessment=await h.service.assess(h.target,{refresh:true});assert.equal(assessment.status,'unavailable');assert.equal(assessment.account.reason,'STALE_OBSERVATION');
  run.accountApprovals=[await h.engine.approveAccountStep(h.target,assessment.key,OWNER)];h.store.put('run',run);const reads=h.state.reads;
  const execution=await h.engine.beginAccountExecution(run.id,'work','synthetic-resolved-model');assert.ok(execution);assert.equal(h.state.reads,reads+1);assert.equal(execution.before.status,'unavailable');assert.equal(h.engine.run(run.id).accountApprovals?.[0].used,true);
  await h.engine.finishAccountExecution(execution.id,{status:'not_dispatched',dispatched:false});
});
