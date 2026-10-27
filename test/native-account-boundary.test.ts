import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Actor,Run,Usage} from '../src/contracts.ts';
import type {AdapterEvent,CodexExecutionInput,CodexGoalInput} from '../src/adapters/types.ts';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';

const OWNER:Actor={kind:'human',name:'Synthetic native-boundary owner'},USAGE:Usage={input:5,output:1,total:6};
const OUTPUT={outcome:'done' as const,summary:'Synthetic native task completed.',artifacts:[],observations:[]};
type Mode='unknown'|'silent-unknown'|'preparation'|'terminal-error'|'success';
type Sample={id:string;finishedAt?:string;dispatched?:boolean;status?:string;usage?:Usage};
const boundary=(state:'dispatching'|'not_dispatched'|'terminal'):AdapterEvent=>({type:'codex.execution_boundary',message:'Synthetic native execution boundary.',data:{state,dispatched:state!=='not_dispatched',cleanupConfirmed:state!=='dispatching'}});
async function until(condition:()=>boolean){for(let index=0;index<100;index++){if(condition())return;await setImmediate();}assert.fail('Synthetic native boundary did not settle.');}

async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-native-boundary-')),workspace=path.join(directory,'source');await mkdir(workspace);const store=new Store(path.join(directory,'state'));
  const control={mode:'unknown' as Mode,calls:[] as (CodexExecutionInput|CodexGoalInput)[]};
  const runNative=(input:CodexExecutionInput|CodexGoalInput)=>{
    control.calls.push(input);const run=store.list<Run>('run').find(run=>run.stages.some(stage=>stage.status==='running'))!,attempt=run.stages.find(stage=>stage.status==='running')!.attempts.at(-1)!;
    assert.ok(attempt.allowanceExecutionId,'Observation identity is durable before a paid-capable adapter call.');assert.equal(attempt.nativeCleanupConfirmed,false);assert.equal(JSON.stringify(attempt).includes('accountKey'),false);
    if(control.mode==='preparation'){input.onEvent(boundary('not_dispatched'));throw new Error('Synthetic unsupported preparation, explicitly not dispatched.');}
    if(control.mode==='silent-unknown')throw new Error('Synthetic startup result is unknown.');
    input.onEvent(boundary('dispatching'));const ref={threadId:'synthetic-native-thread',turnId:'synthetic-native-turn'};input.onEvent({type:'turn/started',message:'Synthetic native turn accepted.',ref});input.onEvent({type:'usage',message:'Synthetic actual usage before result.',ref,usage:USAGE});
    if(control.mode==='unknown')throw new Error('Synthetic startup receipt was lost after acceptance.');
    if(control.mode==='terminal-error'){input.onEvent({...boundary('terminal'),ref});throw new Error('Synthetic confirmed terminal failure.');}
    return ref;
  };
  const codex={async info(){return{available:true,connected:true,authenticated:true,models:[{id:'synthetic-model',name:'Synthetic model',efforts:['max'],isDefault:true}]};},async skills(){return[];},async start(input:CodexExecutionInput){const ref=runNative(input);return{ref,completion:Promise.resolve({output:OUTPUT,usage:USAGE})};},async startGoal(input:CodexGoalInput){const ref=runNative(input);return{ref,completion:Promise.resolve({status:'blocked' as const,summary:'Synthetic native goal ended with evidence.',usage:USAGE})};},async steer(){},async interrupt(){},async close(){}};
  const engine=new Engine(store,codex,{async info(){return{available:true,authenticated:true};},async observe(){throw new Error('No actual CI.');},async dispatch(){throw new Error('No actual CI.');}});
  engine.accountAllowances=new AccountAllowanceService(store,{async readAccountAllowance(){const now=Date.now();return normalizeAccountObservation({status:'available',source:'local-codex',accountKey:createHash('sha256').update('synthetic-account').digest('hex'),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),exhausted:false,windows:[{bucketId:'synthetic-codex',slot:'primary',usedPercent:10,windowDurationMins:300,resetsAt:Math.floor(now/1000)+3600}]},now);}});engine.accountModelResolver=async()=> 'synthetic-model';
  const project=await engine.createProject({name:'Synthetic native boundary',workspace},OWNER),initial=engine.createPipeline({projectId:project.id,roleId:'development',name:'Synthetic one-step native worker'},OWNER),flow=engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'work',name:'Synthetic native worker',roleId:'development',executor:'codex',dependsOn:[],prompt:'Use only synthetic input.',review:false}],policy:{...initial.policy,tokenBudget:1000,maxAttempts:3}},OWNER);
  const start=()=>engine.startRun({projectId:project.id,pipelineId:flow.id,goal:'Verify synthetic native startup.',baseline:'Synthetic source.',idempotencyKey:'synthetic-native-boundary',resourceMode:'tokens'},OWNER);
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});return{engine,store,control,project,start,samples:()=>store.list<Sample>('account-allowance-execution')};
}

test('uncertain native task startup retains its observation and blocks replacement until a late terminal proof',async t=>{
  const h=await fixture(t),run=h.start();await until(()=>h.engine.run(run.id).status==='failed');
  const attempt=h.engine.run(run.id).stages[0].attempts[0];assert.ok(attempt.allowanceExecutionId);assert.equal(attempt.nativeCleanupConfirmed,false);assert.equal(attempt.usage?.total,6);assert.equal(h.samples()[0].finishedAt,undefined);assert.equal(h.samples()[0].dispatched,undefined);assert.equal(h.engine.recovery(run.id,'work').action,'reconcile');
  assert.throws(()=>h.engine.retry(run.id,'work','Do not repeat uncertain native execution.',OWNER),(error:unknown)=>error instanceof AppError&&error.code==='EXTERNAL_RECONCILIATION_REQUIRED');
  h.control.calls[0].onEvent(boundary('terminal'));await until(()=>!!h.samples()[0].finishedAt);assert.equal(h.samples()[0].dispatched,true);assert.equal(h.samples()[0].status,'failed');assert.equal(h.engine.recovery(run.id,'work').action,'retry');
  const ended=h.samples()[0].finishedAt;h.control.calls[0].onEvent(boundary('terminal'));await setImmediate();assert.equal(h.samples()[0].finishedAt,ended);assert.equal(h.samples().length,1);
  h.control.calls[0].onEvent(boundary('dispatching'));assert.equal(h.engine.recovery(run.id,'work').action,'reconcile');h.control.calls[0].onEvent(boundary('terminal'));assert.equal(h.engine.recovery(run.id,'work').action,'retry');assert.equal(h.samples()[0].finishedAt,ended);
});

test('unconfirmed silent startup is never inferred free from the absence of a native reference',async t=>{
  const h=await fixture(t);h.control.mode='silent-unknown';const run=h.start();await until(()=>h.engine.run(run.id).status==='failed');
  assert.equal(h.engine.run(run.id).stages[0].attempts[0].ref,undefined);assert.equal(h.samples()[0].finishedAt,undefined);assert.equal(h.engine.recovery(run.id,'work').action,'reconcile');
  h.control.calls[0].onEvent(boundary('not_dispatched'));await until(()=>!!h.samples()[0].finishedAt);assert.equal(h.samples()[0].dispatched,false);assert.equal(h.samples()[0].status,'not_dispatched');assert.equal(h.engine.allowance(run.id).remainingTokens,1000);
});

test('explicit native preparation rejection settles without charging a sample or trapping a technical token safeguard',async t=>{
  const h=await fixture(t);h.control.mode='preparation';const run=h.start();await until(()=>h.engine.run(run.id).status==='failed'&&!!h.samples()[0]?.finishedAt);
  const attempt=h.engine.run(run.id).stages[0].attempts[0];assert.equal(attempt.nativeDispatchState,'not_dispatched');assert.equal(attempt.nativeCleanupConfirmed,true);assert.equal(h.samples()[0].dispatched,false);assert.equal(h.engine.allowance(run.id).remainingTokens,1000);assert.equal(h.engine.recovery(run.id,'work').action,'retry');
});

test('a native startup rejection with authoritative terminal proof retains actual dispatched usage',async t=>{
  const h=await fixture(t);h.control.mode='terminal-error';const run=h.start();await until(()=>h.engine.run(run.id).status==='failed'&&!!h.samples()[0]?.finishedAt);
  assert.equal(h.samples()[0].dispatched,true);assert.equal(h.samples()[0].usage?.total,6);assert.equal(h.engine.run(run.id).stages[0].attempts[0].nativeCleanupConfirmed,true);
});

test('a successful native task completion supplies terminal proof even for older adapters without boundary completion events',async t=>{
  const h=await fixture(t);h.control.mode='success';const run=h.start();await until(()=>h.engine.run(run.id).status==='completed'&&!!h.samples()[0]?.finishedAt);assert.equal(h.samples()[0].dispatched,true);assert.equal(h.samples()[0].status,'completed');
});

test('native goal startup uncertainty stays held and a late terminal proof permits bounded continuation',async t=>{
  const h=await fixture(t),intake=new IntakeService(h.engine),item=await intake.createWithAccount(h.project.id,{request:'Inspect one synthetic native goal.',idempotencyKey:'synthetic-native-goal'},OWNER);await until(()=>intake.list(h.project.id)[0].status==='failed');
  const before=intake.list(h.project.id)[0],attempt=h.engine.run(before.routerRunId).stages[0].attempts[0];assert.ok(attempt.allowanceExecutionId);assert.equal(before.canRetry,false);assert.equal(h.samples()[0].finishedAt,undefined);
  h.control.calls[0].onEvent(boundary('terminal'));await until(()=>!!h.samples()[0].finishedAt&&intake.list(h.project.id)[0].canRetry===true);assert.equal(h.samples()[0].dispatched,true);assert.equal(h.samples()[0].usage?.total,6);
});

test('explicit unsupported native goal preparation remains cleanable instead of permanently holding account observation',async t=>{
  const h=await fixture(t);h.control.mode='preparation';const intake=new IntakeService(h.engine);await intake.createWithAccount(h.project.id,{request:'Inspect synthetic goal capability.',idempotencyKey:'synthetic-unsupported-goal'},OWNER);await until(()=>intake.list(h.project.id)[0].status==='failed'&&!!h.samples()[0]?.finishedAt);
  assert.equal(intake.list(h.project.id)[0].canRetry,true);assert.equal(h.samples()[0].dispatched,false);assert.equal(h.samples()[0].status,'not_dispatched');
});

test('Stop after account preflight is checked before either paid-capable native start',async t=>{
  for(const kind of ['task','goal'] as const)await t.test(kind,async sub=>{
    const h=await fixture(sub),begin=h.engine.beginAccountExecution.bind(h.engine);h.control.mode='success';
    h.engine.beginAccountExecution=async(...args)=>{const observation=await begin(...args);await h.engine.cancel(args[0],'Stop the synthetic native request before adapter startup.',OWNER);return observation;};
    if(kind==='task'){const run=h.start();await until(()=>h.engine.run(run.id).status==='cancelled'&&!!h.samples()[0]?.finishedAt);}
    else{const intake=new IntakeService(h.engine);await intake.createWithAccount(h.project.id,{request:'Stop synthetic native goal before startup.',idempotencyKey:'synthetic-stop-after-read'},OWNER);await until(()=>intake.list(h.project.id)[0].status==='stopped'&&!!h.samples()[0]?.finishedAt);}
    assert.equal(h.control.calls.length,0);assert.equal(h.samples()[0].dispatched,false);assert.equal(h.samples()[0].status,'not_dispatched');
  });
});
