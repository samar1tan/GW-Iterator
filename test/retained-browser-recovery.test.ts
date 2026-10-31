import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {defaultRoles} from '../src/defaults.ts';
import {attemptRole} from '../src/contracts.ts';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';
import type {Intake,Pipeline,Project,Run,TaskOutput,WorkResumeInput} from '../src/contracts.ts';
import type {CodexAdapter,CodexExecutionInput,GithubAdapter} from '../src/adapters/types.ts';

const OWNER={name:'Synthetic retained-work owner',kind:'human' as const},at='2026-01-01T00:00:00Z';
const done:TaskOutput={outcome:'done',summary:'Independent synthetic check passed.',artifacts:[],observations:[]};
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-retained-browser-')),store=new Store(path.join(directory,'state'));
  const tasks:{input:CodexExecutionInput;resolve:(value:{output:TaskOutput})=>void}[]=[];
  let coordinatorStarts=0;
  const codex={info:async()=>({available:true,connected:true,authenticated:true,models:[{id:'synthetic-model',name:'Synthetic model',efforts:['max']}]}),close:async()=>{},
    start:async(input:CodexExecutionInput)=>{let resolve!:(value:{output:TaskOutput})=>void;const completion=new Promise<{output:TaskOutput}>((accept,reject)=>{resolve=accept;input.signal.addEventListener('abort',()=>reject(new Error('Synthetic task stopped.')),{once:true});});tasks.push({input,resolve});return{ref:{},completion};},
    startGoal:async()=>{coordinatorStarts++;throw new Error('The retained-step test must not start a coordinator.');}} as unknown as CodexAdapter;
  const engine=new Engine(store,codex,{} as GithubAdapter),intake=new IntakeService(engine);
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  const original:Project={id:'synthetic-project',revision:1,name:'Retained synthetic work',description:'Independent recovery fixture.',workspace:directory,repository:'',roles:defaultRoles().map(role=>({...role,model:'synthetic-model'})),knowledgeSources:[],createdAt:at,updatedAt:at};
  const current=structuredClone(original);current.revision=2;const qa=current.roles.find(role=>role.id==='qa')!;qa.tools.push('browser.use');qa.browser={origins:['http://127.0.0.1:4567']};qa.sandbox='workspace-write';qa.instructions='Current unrelated instructions must not replace frozen instructions.';
  store.put('project',current);
  const stages=['scope','product','design','implement','verify','maintain'].map((id,index)=>({id,name:'Synthetic '+id,executor:'codex' as const,roleId:id==='verify'?'qa':id==='maintain'?'operations':'development',dependsOn:index?['scope','product','design','implement','verify','maintain'].slice(index-1,index):[],prompt:'Perform only the assigned synthetic stage.',review:id==='maintain'}));
  const pipeline:Pipeline={id:'synthetic-pipeline',projectId:original.id,revision:1,name:'Synthetic retained workflow',description:'Keep accepted upstream output.',roleId:'lead',stages,policy:{},updatedAt:at};
  const run:Run={id:'synthetic-run',projectId:original.id,pipelineId:pipeline.id,goal:'Verify the retained synthetic artifact.',baseline:'Frozen synthetic source.',trigger:{kind:'human',actor:OWNER.name},status:'failed',iteration:1,mode:'once',createdAt:at,updatedAt:at,endedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-run-key',inputHash:'synthetic-input',controlRevision:0,snapshot:{project:original,pipeline,pipelines:[pipeline],knowledge:[]},stages:stages.map((stage,index)=>({stageId:stage.id,status:index<4?'completed':index===4?'failed':'queued',attempts:index===5?[]:[{id:'synthetic-'+stage.id,number:1,iteration:1,status:index<4?'completed':'failed',startedAt:at,endedAt:at,output:index<4?{...done,artifacts:[{label:'Retained synthetic artifact',path:'artifact.txt'}]}:{...done,outcome:'blocked',summary:'The old synthetic browser could not launch.'},provider:'multica',...(index===4?{error:'The old synthetic browser could not launch.'}:{})}]}))};
  store.put('run',run);await writeFile(path.join(directory,'artifact.txt'),'Retained synthetic implementation.\n');
  for(const stage of run.stages)for(const attempt of stage.attempts)store.put('multica-execution',{id:attempt.id,projectId:run.projectId,runId:run.id,stageId:stage.stageId,status:'completed',cleanupConfirmed:true});
  const coordinator:Run={...structuredClone(run),id:'synthetic-coordinator',executionKind:'agent-goal',status:'completed',stages:[{stageId:'supervise',status:'completed',attempts:[{id:'synthetic-decision',number:1,iteration:1,status:'completed',provider:'multica',startedAt:at,endedAt:at,nativeDispatchState:'not_dispatched',nativeDispatched:false,nativeCleanupConfirmed:true}]}]};store.put('run',coordinator);
  const goal:Intake={id:'synthetic-goal',projectId:original.id,request:run.goal,baseline:run.baseline,status:'stopped',createdAt:at,updatedAt:at,routerRunId:coordinator.id,supervisorRunIds:[coordinator.id],targetRunIds:[run.id],rounds:[],policy:{},controlRevision:2,idempotencyKey:'synthetic-goal-key',basisRevision:1};store.put('intake',goal);store.put('intake-basis',{id:goal.id,revision:1,project:original,pipelines:[pipeline],knowledge:[]});
  const input:WorkResumeInput={idempotencyKey:'synthetic-resume-key',controlRevision:2,target:{runId:run.id,stageId:'verify',attemptId:'synthetic-verify',runControlRevision:0},browserProjectRevision:2,note:'Use the hosted browser to verify the retained implementation; then continue maintenance.'};
  const get=()=>intake.list(original.id).find(item=>item.id===goal.id)!;
  const pump=async(check:()=>boolean)=>{for(let i=0;i<60;i++){await engine.tick();await immediate();if(check())return;}assert.fail('Synthetic recovery did not reach its expected state: '+JSON.stringify({tasks:tasks.length,recovery:get().workRecoveryHistory?.at(-1),stage:engine.run(run.id).stages[4]}));};
  return{directory,store,engine,intake,run,goal,current,tasks,input,get,pump,coordinatorStarts:()=>coordinatorStarts};
}
function account(h:Awaited<ReturnType<typeof fixture>>,used=98){
  const now=Date.now(),state={used};
  h.engine.accountAllowances=new AccountAllowanceService(h.store,{readAccountAllowance:async()=>normalizeAccountObservation({status:'available',source:'local-codex',accountKey:'b'.repeat(64),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),windows:[{bucketId:'synthetic-window',slot:'primary',usedPercent:state.used,windowDurationMins:300,resetsAt:Math.floor(now/1000)+86400}],exhausted:state.used>=100},now)},{now:()=>now});
  return state;
}
async function approve(h:Awaited<ReturnType<typeof fixture>>){
  const recovery=await h.engine.recoveryWithAccount(h.run.id,'verify',OWNER),run=h.engine.run(h.run.id);
  assert.equal(recovery.action,'approve');
  const result=await h.engine.resolveWaiting(h.run.id,{stageId:'verify',attemptId:run.stages[4].attempts.at(-1)!.id,controlRevision:0,idempotencyKey:'synthetic-account-approval',recoveryKey:recovery.recoveryKey,approveAccountStep:true,accountAssessmentKey:recovery.account!.key},OWNER);
  assert.equal(result.status,'continued');await h.pump(()=>h.tasks.length===1);
  assert.equal(h.tasks[0].input.role.tools.includes('browser.use'),true);assert.deepEqual(h.tasks[0].input.role.browser,{origins:['http://127.0.0.1:4567']});
}

test('explicit stopped-goal continuation preserves accepted work, gives only the next QA attempt current browser access, then reaches maintenance',async t=>{
  const h=await fixture(t),before=structuredClone(h.run);
  assert.equal(h.engine.recovery(h.run.id,'verify').code,'GOAL_CLOSED');
  const receipt=h.intake.continueWork(h.goal.id,OWNER,h.input);
  assert.equal(receipt.controlRevision,3);assert.equal(receipt.status,'failed');
  assert.equal(h.intake.continueWork(h.goal.id,OWNER,h.input).workRecoveryHistory?.length,1);
  await h.pump(()=>h.tasks.length===1);
  const retried=h.engine.run(h.run.id),attempt=retried.stages[4].attempts[1];
  assert.deepEqual(retried.snapshot,before.snapshot);assert.deepEqual(retried.stages.slice(0,4),before.stages.slice(0,4));assert.deepEqual(retried.stages[4].attempts[0],before.stages[4].attempts[0]);
  assert.equal(h.tasks[0].input.role.sandbox,'read-only');assert.equal(h.tasks[0].input.role.instructions.includes('Current unrelated instructions'),false);
  assert.ok(h.tasks[0].input.prompt.includes(h.input.note!),'The new owner guidance reaches QA without rewriting the old attempt.');
  assert.equal(h.tasks[0].input.role.tools.includes('browser.use'),true);assert.deepEqual(h.tasks[0].input.role.browser,{origins:['http://127.0.0.1:4567']});
  assert.equal(attemptRole(retried,'verify',retried.stages[4].attempts[0])?.browser,undefined);
  assert.equal(attemptRole(retried,'verify',attempt)?.browser?.origins[0],'http://127.0.0.1:4567');
  assert.equal(h.coordinatorStarts(),0);assert.equal(await readFile(path.join(h.directory,'artifact.txt'),'utf8'),'Retained synthetic implementation.\n');
  h.tasks[0].resolve({output:done});await h.pump(()=>h.tasks.length===2);
  assert.equal(h.engine.run(h.run.id).stages[4].status,'completed');assert.equal(h.engine.run(h.run.id).stages[5].status,'running');
  assert.equal(h.tasks[1].input.role.tools.includes('browser.use'),false);assert.equal(h.tasks[1].input.role.browser,undefined);assert.equal(h.coordinatorStarts(),0);
  h.tasks[1].resolve({output:done});await h.pump(()=>h.engine.run(h.run.id).stages[5].status==='review');
  assert.equal(h.intake.continueWork(h.goal.id,OWNER,h.input).workRecoveryHistory?.length,1);assert.equal(h.tasks.length,2);
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,{...h.input,note:'Different instructions.'}),code('IDEMPOTENCY_CONFLICT'));
});

test('ordinary continuation cannot silently acquire the current role browser or other permissions',async t=>{
  const h=await fixture(t),input={...h.input};delete input.browserProjectRevision;
  h.intake.continueWork(h.goal.id,OWNER,input);await h.pump(()=>h.tasks.length===1);
  assert.equal(h.tasks[0].input.role.tools.includes('browser.use'),false);assert.equal(h.tasks[0].input.role.browser,undefined);assert.equal(h.engine.run(h.run.id).browserContinuations,undefined);
});

test('owner, exact target, project revision and completed-goal boundaries fail before any dispatch',async t=>{
  const h=await fixture(t);
  assert.throws(()=>h.intake.continueWork(h.goal.id,{name:'Synthetic agent',kind:'agent'},h.input),code('OWNER_REQUIRED'));
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,{...h.input,browserProjectRevision:1}),code('REVISION_CONFLICT'));
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,{...h.input,target:{...h.input.target!,runId:'foreign-run'}}),code('PROJECT_SCOPE'));
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,{...h.input,target:{...h.input.target!,attemptId:'stale-attempt'}}),code('RECOVERY_CONFLICT'));
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,{...h.input,controlRevision:1}),code('RECOVERY_CONFLICT'));
  const goal=h.store.get<Intake>('intake',h.goal.id)!;goal.status='completed';h.store.put('intake',goal);
  assert.throws(()=>h.intake.continueWork(h.goal.id,OWNER,h.input),code('GOAL_COMPLETED'));
  assert.deepEqual(h.engine.run(h.run.id),h.run);assert.equal(h.tasks.length,0);
});

test('a project change while cleanup is being confirmed cannot authorize browser dispatch',async t=>{
  const h=await fixture(t);h.store.put('multica-execution',{id:'synthetic-verify',projectId:h.run.projectId,runId:h.run.id,stageId:'verify',status:'running',cleanupConfirmed:false});
  let release!:()=>void;h.engine.reconcileExternal=async()=>{await new Promise<void>(resolve=>{release=resolve;});h.store.put('multica-execution',{id:'synthetic-verify',projectId:h.run.projectId,runId:h.run.id,stageId:'verify',status:'completed',cleanupConfirmed:true});return{status:'completed',cleanupConfirmed:true};};
  h.intake.continueWork(h.goal.id,OWNER,h.input);await immediate();
  h.store.put('project',{...h.current,revision:3});release();
  await h.pump(()=>h.get().workRecoveryHistory?.at(-1)?.phase==='needs_input');
  assert.equal(h.get().workRecoveryHistory?.at(-1)?.code,'REVISION_CONFLICT');assert.equal(h.tasks.length,0);assert.deepEqual(h.engine.run(h.run.id),h.run);
});

test('Stop during exact cleanup cancels the browser continuation without changing the retained run',async t=>{
  const h=await fixture(t);h.store.put('multica-execution',{id:'synthetic-verify',projectId:h.run.projectId,runId:h.run.id,stageId:'verify',status:'running',cleanupConfirmed:false});
  let release!:()=>void;h.engine.reconcileExternal=async()=>{await new Promise<void>(resolve=>{release=resolve;});return{status:'running',cleanupConfirmed:false};};
  h.intake.continueWork(h.goal.id,OWNER,h.input);await immediate();h.intake.cancel(h.goal.id,'Stop this synthetic continuation.',OWNER);release();await immediate();await h.engine.tick();
  assert.equal(h.get().status,'stopped');assert.equal(h.get().workRecoveryHistory?.at(-1)?.phase,'cancelled');assert.equal(h.tasks.length,0);assert.deepEqual(h.engine.run(h.run.id),h.run);
});

test('a real account approval retains pending browser authority without starting an unapproved model turn',async t=>{
  const h=await fixture(t);account(h);
  h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>h.get().workRecoveryHistory?.at(-1)?.phase==='needs_input');
  assert.equal(h.tasks.length,0);assert.equal(h.engine.run(h.run.id).browserContinuations?.length,1);
  await approve(h);assert.equal(h.tasks.length,1);assert.equal(h.engine.run(h.run.id).accountApprovals?.[0].used,true);
  assert.equal(h.get().workRecoveryHistory?.at(-1)?.phase,'retrying');
});

test('account uncertainty arising at dispatch leaves the browser grant available for the approved execution',async t=>{
  const h=await fixture(t),state=account(h,20),begin=h.engine.beginAccountExecution.bind(h.engine);
  t.mock.method(h.engine,'beginAccountExecution',async(runId:string,stageId:string,actualModel?:string|null)=>{state.used=98;return begin(runId,stageId,actualModel);});
  h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>h.engine.run(h.run.id).stages[4].allowanceHold!==undefined&&h.get().workRecoveryHistory?.at(-1)?.phase==='needs_input');
  const held=h.engine.run(h.run.id).stages[4].attempts.at(-1)!;
  assert.equal(held.admissionHeld,true);assert.ok(held.browserContinuationId);assert.equal(h.tasks.length,0);
  await approve(h);assert.equal(h.tasks.length,1);assert.equal(h.engine.run(h.run.id).stages[4].attempts.at(-1)?.browserContinuationId,held.browserContinuationId);
  assert.equal(h.get().workRecoveryHistory?.at(-1)?.phase,'retrying');
});

test('a completed browser execution consumes the grant instead of giving later retries implicit new authority',async t=>{
  const h=await fixture(t);h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>h.tasks.length===1);
  h.tasks[0].resolve({output:{...done,outcome:'blocked',summary:'A new synthetic finding needs owner guidance.'}});
  await h.pump(()=>h.engine.run(h.run.id).status==='failed');
  h.engine.retry(h.run.id,'verify','Inspect the changed synthetic evidence.',OWNER);await h.pump(()=>h.tasks.length===2);
  assert.equal(h.tasks[1].input.role.tools.includes('browser.use'),false);assert.equal(h.engine.run(h.run.id).stages[4].attempts.at(-1)?.browserContinuationId,undefined);
});

test('a persisted browser continuation is idempotent across a supervisor restart',async t=>{
  const h=await fixture(t);h.intake.continueWork(h.goal.id,OWNER,h.input);await immediate();await h.engine.close();
  const engine=new Engine(new Store(path.join(h.directory,'state')),h.engine.codex,{} as GithubAdapter),intake=new IntakeService(engine);
  try{
    assert.equal(intake.continueWork(h.goal.id,OWNER,h.input).workRecoveryHistory?.length,1);
    for(let i=0;i<40&&h.tasks.length===0;i++){await engine.tick();await immediate();}
    assert.equal(h.tasks.length,1);assert.equal(h.tasks[0].input.role.tools.includes('browser.use'),true);
    assert.equal(intake.continueWork(h.goal.id,OWNER,h.input).workRecoveryHistory?.length,1);assert.equal(h.tasks.length,1);
  }finally{await engine.close();}
});

test('Stop revokes unconsumed browser authority before a later continuation without browser opt-in',async t=>{
  const h=await fixture(t),state=account(h);
  h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>h.get().workRecoveryHistory?.at(-1)?.phase==='needs_input');
  await h.intake.cancelRun(h.goal.routerRunId,'Stop this synthetic retained-work continuation.');
  const revoked=h.engine.run(h.run.id).browserContinuations?.[0];assert.ok(revoked?.revokedAt);assert.equal(h.get().status,'stopped');
  state.used=20;const input={...h.input,idempotencyKey:'synthetic-after-stop',controlRevision:h.get().controlRevision};delete input.browserProjectRevision;
  h.intake.continueWork(h.goal.id,OWNER,input);await h.pump(()=>h.tasks.length===1);
  assert.equal(h.tasks[0].input.role.tools.includes('browser.use'),false);assert.equal(h.tasks[0].input.role.browser,undefined);assert.equal(h.engine.run(h.run.id).browserContinuations?.[0].id,revoked!.id);
});

async function historicalPreparation(h:Awaited<ReturnType<typeof fixture>>){
  const current=h.store.get<Run>('run',h.goal.routerRunId)!,prior=structuredClone(current);prior.id='synthetic-rejected-coordinator';prior.status='failed';prior.stages[0].status='failed';const attempt=prior.stages[0].attempts[0];attempt.id='synthetic-rejected-attempt';attempt.status='failed';attempt.error='Synthetic preparation rejected before provider assignment.';delete attempt.nativeDispatchState;delete attempt.nativeDispatched;delete attempt.nativeCleanupConfirmed;h.store.put('run',prior);
  const record={id:'synthetic-rejected-preparation',projectId:h.run.projectId,runId:prior.id,stageId:'decision-1',status:'not_dispatched',cleanupConfirmed:true};h.store.put('multica-execution',record);
  const goal=h.store.get<Intake>('intake',h.goal.id)!;goal.supervisorRunIds=[prior.id,current.id];goal.rounds=[{number:1,routerRunId:current.id,targetRunIds:[h.run.id]}];h.store.put('intake',goal);return{prior,record};
}

test('a historical unaccepted coordinator preparation cannot block retained QA after later accepted rounds',async t=>{
  const h=await fixture(t),{prior,record}=await historicalPreparation(h),before=structuredClone(h.run);let reconciliations=0;h.engine.reconcileExternal=async()=>{reconciliations++;return{status:'unknown',cleanupConfirmed:false};};
  h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>h.tasks.length===1);assert.equal(reconciliations,0);assert.deepEqual(h.engine.run(prior.id),prior);assert.deepEqual(h.store.get('multica-execution',record.id),record);
  const retried=h.engine.run(h.run.id);assert.deepEqual(retried.snapshot,before.snapshot);assert.deepEqual(retried.stages.slice(0,4),before.stages.slice(0,4));assert.deepEqual(retried.stages[4].attempts[0],before.stages[4].attempts[0]);assert.equal(h.coordinatorStarts(),0);
  h.tasks[0].resolve({output:done});await h.pump(()=>h.tasks.length===2);assert.equal(h.engine.run(h.run.id).stages[5].status,'running');h.tasks[1].resolve({output:done});await h.pump(()=>h.engine.run(h.run.id).stages[5].status==='review');
});

test('ambiguous, foreign and unconfirmed historical preparation evidence still blocks retained QA',async t=>{
  for(const mode of ['ambiguous','foreign','unconfirmed','invalid-stage'] as const)await t.test(mode,async sub=>{
    const h=await fixture(sub),{record}=await historicalPreparation(h);if(mode==='ambiguous')h.store.put('multica-execution',{...record,id:'synthetic-extra-preparation',stageId:'decision-2'});else h.store.put('multica-execution',{...record,...(mode==='foreign'?{projectId:'synthetic-foreign-project'}:mode==='unconfirmed'?{cleanupConfirmed:false}:{stageId:'verify'})});
    let checks=0;h.engine.reconcileExternal=async()=>{checks++;return{status:'unknown',cleanupConfirmed:false};};h.intake.continueWork(h.goal.id,OWNER,h.input);await h.pump(()=>checks===1);assert.equal(h.tasks.length,0);assert.equal(h.coordinatorStarts(),0);assert.deepEqual(h.engine.run(h.run.id),h.run);
  });
});
