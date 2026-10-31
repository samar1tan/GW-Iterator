import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {Engine} from '../src/engine.ts';
import {Store} from '../src/store.ts';
import {IntakeService} from '../src/intake.ts';
import {defaultRoles} from '../src/defaults.ts';
import {configuredReworkTarget,pendingBrowserContinuation} from '../src/contracts.ts';
import type {Intake,Pipeline,Project,Run,RunReworkInput,TaskOutput} from '../src/contracts.ts';
import type {CodexAdapter,CodexExecutionInput,GithubAdapter} from '../src/adapters/types.ts';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';

const OWNER={name:'Synthetic rework owner',kind:'human' as const},at='2026-01-01T00:00:00Z';
const done:TaskOutput={outcome:'done',summary:'Synthetic responsibility completed.',artifacts:[{label:'Synthetic retained artifact',path:'artifact.txt'}],observations:[]};
const code=(value:string)=>(error:unknown)=>(error as {code?:string}).code===value;

async function fixture(t:TestContext,withGoal=false){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-failed-rework-')),store=new Store(path.join(directory,'state'));
  const tasks:{input:CodexExecutionInput;resolve:(value:{output:TaskOutput})=>void}[]=[];
  let coordinatorStarts=0;
  const codex={info:async()=>({available:true,connected:true,authenticated:true,models:[{id:'synthetic-model',name:'Synthetic model',efforts:['max']}]}),close:async()=>{},start:async(input:CodexExecutionInput)=>{
    let resolve!:(value:{output:TaskOutput})=>void;const completion=new Promise<{output:TaskOutput}>((accept,reject)=>{resolve=accept;input.signal.addEventListener('abort',()=>reject(new Error('Synthetic execution stopped.')),{once:true});});tasks.push({input,resolve});return{ref:{},completion};
  },startGoal:async()=>{coordinatorStarts++;throw new Error('No coordinator should start before retained maintenance ends.');}} as unknown as CodexAdapter;
  const engine=new Engine(store,codex,{} as GithubAdapter),intake=withGoal?new IntakeService(engine):undefined;
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  const project:Project={id:'synthetic-project',revision:1,name:'Synthetic retained work',description:'Independent failed-verifier fixture.',workspace:directory,repository:'',roles:defaultRoles().map(role=>({...role,model:'synthetic-model'})),knowledgeSources:[],createdAt:at,updatedAt:at};store.put('project',project);
  const pipeline:Pipeline={id:'synthetic-flow',projectId:project.id,revision:1,name:'Synthetic repair handoff',description:'Keep accepted work and return exact findings.',roleId:'lead',policy:{},updatedAt:at,stages:[
    {id:'scope',name:'Define the bounded outcome',executor:'codex',roleId:'development',dependsOn:[],prompt:'Retain the synthetic scope.',review:false},
    {id:'build',name:'Repair the prepared artifact',executor:'codex',roleId:'development',dependsOn:['scope'],prompt:'Repair only the recorded findings.',review:true},
    {id:'verify',name:'Verify the actual candidate',executor:'codex',roleId:'qa',dependsOn:['build'],prompt:'Verify without changing the candidate.',review:false,reworkTo:'build'},
    {id:'maintain',name:'Maintain the delivery artifacts',executor:'codex',roleId:'operations',dependsOn:['verify'],prompt:'Update affected delivery artifacts.',review:true},
    {id:'retained',name:'Keep an independent accepted result',executor:'codex',roleId:'development',dependsOn:['scope'],prompt:'Retain this result.',review:false},
  ]};
  const run:Run={id:'synthetic-run',projectId:project.id,pipelineId:pipeline.id,goal:'Repair a retained synthetic delivery.',baseline:'Frozen synthetic basis.',trigger:{kind:'human',actor:OWNER.name},status:'failed',mode:'once',iteration:1,createdAt:at,updatedAt:at,endedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-run-key',inputHash:'synthetic-input',controlRevision:0,snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:pipeline.stages.map(stage=>({stageId:stage.id,status:stage.id==='verify'?'failed':stage.id==='maintain'?'queued':'completed',attempts:stage.id==='maintain'?[]:[{id:'old-'+stage.id,number:1,iteration:1,status:stage.id==='verify'?'failed':'completed',startedAt:at,endedAt:at,provider:'multica',...(stage.id==='verify'?{error:'Synthetic provider failure.',failureCode:'MULTICA_TASK_FAILED'}:{output:done}),...(stage.id==='build'?{review:{decision:'accept' as const,note:'Earlier synthetic artifact accepted.',actor:OWNER.name,at}}:{})}]}))};store.put('run',run);
  for(const stage of run.stages)for(const attempt of stage.attempts)store.put('multica-execution',{id:attempt.id,projectId:run.projectId,runId:run.id,stageId:stage.stageId,status:stage.status==='failed'?'failed':'completed',cleanupConfirmed:true});
  const coordinator:Run={...structuredClone(run),id:'synthetic-coordinator',executionKind:'agent-goal',status:'completed',stages:[{stageId:'supervise',status:'completed',attempts:[{id:'synthetic-decision',number:1,iteration:1,status:'completed',provider:'multica',startedAt:at,endedAt:at,nativeDispatchState:'not_dispatched',nativeDispatched:false,nativeCleanupConfirmed:true}]}]};
  const goal:Intake={id:'synthetic-goal',projectId:project.id,request:run.goal,baseline:run.baseline,status:'failed',createdAt:at,updatedAt:at,routerRunId:coordinator.id,supervisorRunIds:[coordinator.id],targetRunIds:[run.id],rounds:[],policy:{},controlRevision:2,idempotencyKey:'synthetic-goal-key',basisRevision:1};
  if(withGoal){store.put('run',coordinator);store.put('intake',goal);store.put('intake-basis',{id:goal.id,revision:1,project,pipelines:[pipeline],knowledge:[]});}
  const input:RunReworkInput={attemptId:'old-verify',controlRevision:0,idempotencyKey:'synthetic-rework-request',note:'Repair the synthetic multi-file selection and current-stage attachment handoff; retain the accepted scope.'};
  const pump=async(check:()=>boolean)=>{for(let i=0;i<80;i++){await engine.tick();await immediate();if(check())return;}assert.fail('Synthetic rework did not reach its expected state.');};
  return{directory,store,engine,intake,codex,project,pipeline,run,goal,coordinator,input,tasks,pump,coordinatorStarts:()=>coordinatorStarts};
}

test('explicit failed-verifier rework retains accepted history, Pause and restarted receipts before repairing only its predecessor',async t=>{
  const h=await fixture(t,true),before=structuredClone(h.run);h.store.put('run',{...h.run,pausedAt:at});
  const receipt=h.engine.requestRework(h.run.id,'verify',h.input,OWNER);assert.equal(receipt.status,'paused');assert.ok(receipt.pausedAt);assert.equal(receipt.controlRevision,1);assert.equal(h.tasks.length,0);
  assert.deepEqual(receipt.snapshot,before.snapshot);assert.deepEqual(receipt.stages[0],before.stages[0]);assert.deepEqual(receipt.stages[4],before.stages[4]);assert.deepEqual(receipt.stages[1].attempts,before.stages[1].attempts);assert.deepEqual(receipt.stages[2].attempts,before.stages[2].attempts);assert.deepEqual(receipt.stages.map(stage=>stage.status),['completed','queued','queued','queued','completed']);
  assert.deepEqual(h.engine.requestRework(h.run.id,'verify',h.input,OWNER),receipt);assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.rework_requested').length,1);
  const restoredStore=new Store(path.join(h.directory,'state')),restored=new Engine(restoredStore,h.codex,{} as GithubAdapter);t.after(()=>restored.close());assert.deepEqual(restored.requestRework(h.run.id,'verify',h.input,OWNER),receipt);assert.equal(h.tasks.length,0);
  const recovery=h.intake!.list(h.project.id)[0].workRecoveryHistory!.at(-1)!;assert.equal(recovery.code,'REWORKING_STEP');assert.equal(recovery.stageId,'build');assert.equal(recovery.phase,'retrying');assert.equal(recovery.runControlRevision,1);
  h.engine.resume(h.run.id,OWNER);await h.pump(()=>h.tasks.length===1);assert.ok(h.tasks[0].input.prompt.includes(h.input.note),'New findings reach the responsible stage after its earlier acceptance.');assert.equal(h.coordinatorStarts(),0);
  h.tasks[0].resolve({output:done});await h.pump(()=>h.engine.run(h.run.id).stages[1].status==='review');h.engine.review(h.run.id,'build','accept','The scoped synthetic repair is independently supported.',OWNER);
  await h.pump(()=>h.tasks.length===2);assert.equal(h.tasks[1].input.role.id,'qa');assert.equal(h.tasks[1].input.role.tools.includes('browser.use'),false);h.tasks[1].resolve({output:done});await h.pump(()=>h.tasks.length===3);assert.equal(h.tasks[2].input.role.id,'operations');h.tasks[2].resolve({output:done});await h.pump(()=>h.engine.run(h.run.id).stages[3].status==='review');
  assert.equal(h.coordinatorStarts(),0);const after=h.engine.run(h.run.id);assert.deepEqual(after.snapshot,before.snapshot);assert.deepEqual(after.stages[2].attempts[0],before.stages[2].attempts[0]);assert.equal(h.intake!.list(h.project.id)[0].workRecoveryHistory!.length,1);
});

test('rework rejects stale or forged targets, worker controls and closed work without writes',async t=>{
  for(const variant of ['attempt','control','empty-note','destination','missing-target','unrelated-target','worker','foreign','owner-gate','stopped','completed','closed-goal'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub,variant==='closed-goal');let input={...h.input},actor=OWNER as {name:string;kind:'human'|'agent';projectId?:string};const run=h.engine.run(h.run.id);
    if(variant==='attempt')input.attemptId='another-attempt';if(variant==='control')input.controlRevision=1;if(variant==='empty-note')input.note=' ';
    if(variant==='destination')input={...input,targetStageId:'scope'} as RunReworkInput;
    if(variant==='missing-target')delete run.snapshot.pipeline.stages[2].reworkTo;if(variant==='unrelated-target')run.snapshot.pipeline.stages[2].reworkTo='retained';
    if(variant==='worker')actor={name:'Synthetic scoped worker',kind:'agent',projectId:h.project.id};if(variant==='foreign')actor={name:'Synthetic foreign worker',kind:'agent',projectId:'foreign'};
    if(variant==='owner-gate'){run.snapshot.pipeline.stages[2].ownerGate=true;actor={name:'Synthetic global agent',kind:'agent'};}
    if(variant==='stopped'){run.cancelRequested=true;run.status='cancelled';}if(variant==='completed')run.status='completed';
    if(variant==='closed-goal'){h.store.put('intake',{...h.goal,status:'stopped'});}
    h.store.put('run',run);const before=structuredClone(run),expected=variant==='attempt'||variant==='control'?'RECOVERY_CONFLICT':variant==='empty-note'||variant==='destination'?'INVALID_REWORK':variant==='missing-target'||variant==='unrelated-target'||variant==='completed'?'REWORK_TARGET_UNAVAILABLE':variant==='foreign'?'PROJECT_SCOPE':variant==='worker'||variant==='owner-gate'?'OWNER_REQUIRED':variant==='closed-goal'?'GOAL_CLOSED':'RECOVERY_CANCELLED';
    assert.throws(()=>h.engine.requestRework(run.id,'verify',input,actor),code(expected));assert.deepEqual(h.engine.run(run.id),before);assert.equal(h.store.list('run-rework-receipt').length,0);assert.equal(h.store.list('rework-guidance').length,0);assert.equal(h.tasks.length,0);
  });
});

test('unknown affected execution and supervising cleanup block rework atomically',async t=>{
  for(const variant of ['unconfirmed','missing','native','child','coordinator'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub,variant==='coordinator'),before=structuredClone(h.engine.run(h.run.id));
    if(variant==='unconfirmed')h.store.put('multica-execution',{id:'old-verify',projectId:h.project.id,runId:h.run.id,stageId:'verify',status:'failed',cleanupConfirmed:false});
    if(variant==='missing')h.store.db.prepare("DELETE FROM records WHERE kind='multica-execution' AND id='old-verify'").run();
    if(variant==='native'){const run=h.engine.run(h.run.id);run.stages[2].attempts[0].ref={provider:'codex',threadId:'synthetic-thread'};run.stages[2].attempts[0].provider='codex';h.store.put('run',run);}
    if(variant==='child')h.store.put('run',{...structuredClone(h.run),id:'synthetic-child',parentRunId:h.run.id,status:'running'});
    if(variant==='coordinator'){const router={...h.coordinator,status:'failed' as const};router.stages[0].attempts[0].nativeCleanupConfirmed=false;router.stages[0].attempts[0].nativeDispatchState='unknown';h.store.put('run',router);}
    const actualBefore=structuredClone(h.engine.run(h.run.id));assert.throws(()=>h.engine.requestRework(h.run.id,'verify',h.input,OWNER),code('EXTERNAL_RECONCILIATION_REQUIRED'));assert.deepEqual(h.engine.run(h.run.id),actualBefore);assert.equal(h.store.list('rework-guidance').length,0);assert.equal(h.store.list('run-rework-receipt').length,0);assert.equal(h.tasks.length,0);assert.deepEqual(before.snapshot,h.engine.run(h.run.id).snapshot);
  });
});

test('rework invalidates unused affected authority and known exhaustion still prevents paid dispatch',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id);run.accountApprovals=[{stageId:'build',assessmentKey:'old',accountSnapshotId:'old',at,actor:OWNER.name,used:false},{stageId:'retained',assessmentKey:'other',accountSnapshotId:'other',at,actor:OWNER.name,used:false}];
  run.browserContinuations=[{id:'synthetic-pending-browser',stageId:'verify',roleId:'qa',afterAttemptId:'old-verify',projectRevision:1,browser:{origins:['http://127.0.0.1:4567']},actor:OWNER.name,at,note:'Only the old candidate.'}];h.store.put('run',run);
  const now=Date.now();h.engine.accountAllowances=new AccountAllowanceService(h.store,{readAccountAllowance:async()=>normalizeAccountObservation({status:'available',source:'local-codex',accountKey:'c'.repeat(64),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),windows:[{bucketId:'synthetic-window',slot:'primary',usedPercent:100,windowDurationMins:300,resetsAt:Math.floor(now/1000)+86400}],exhausted:true},now)},{now:()=>now});
  const receipt=h.engine.requestRework(run.id,'verify',h.input,OWNER);assert.equal(receipt.accountApprovals![0].revoked,true);assert.equal(receipt.accountApprovals![1].revoked,undefined);assert.ok(receipt.browserContinuations![0].revokedAt);
  await h.pump(()=>h.engine.run(run.id).stages[1].status==='waiting');assert.equal(h.tasks.length,0);assert.equal(h.engine.run(run.id).stages[1].attempts.at(-1)!.admissionHeld,true);
});

test('rework receipts deduplicate after Stop and changed request identities fail closed',async t=>{
  const h=await fixture(t);h.store.put('run',{...h.run,pausedAt:at});const receipt=h.engine.requestRework(h.run.id,'verify',h.input,OWNER);await h.engine.cancel(h.run.id,'Synthetic owner stopped.',OWNER);
  assert.deepEqual(h.engine.requestRework(h.run.id,'verify',h.input,OWNER),receipt);assert.equal(h.engine.run(h.run.id).status,'cancelled');assert.equal(h.tasks.length,0);assert.throws(()=>h.engine.requestRework(h.run.id,'verify',{...h.input,note:'Different findings.'},OWNER),code('IDEMPOTENCY_CONFLICT'));
  assert.equal(configuredReworkTarget(h.engine.run(h.run.id),'verify'),undefined);assert.equal(h.store.events({runId:h.run.id}).filter(event=>event.type==='stage.rework_requested').length,1);
});

test('rework revokes every affected browser grant without exposing an earlier pending grant',async t=>{
  const h=await fixture(t),project=structuredClone(h.project);project.revision=2;const qa=project.roles.find(role=>role.id==='qa')!;qa.tools.push('browser.use');qa.browser={origins:['http://127.0.0.1:4567']};h.store.put('project',project);
  const grant={id:'first-pending-grant',stageId:'verify',roleId:'qa',afterAttemptId:'old-verify',projectRevision:2,browser:qa.browser,actor:OWNER.name,at,note:'Synthetic explicit next-attempt browser choice.'};
  h.engine.authorizeBrowserContinuation(h.run.id,grant,OWNER);h.engine.authorizeBrowserContinuation(h.run.id,{...grant,id:'second-pending-grant'},OWNER);assert.equal(pendingBrowserContinuation(h.engine.run(h.run.id),'verify')?.id,'second-pending-grant');
  const run=h.engine.run(h.run.id);run.browserContinuations!.push({...grant,id:'unrelated-grant',stageId:'retained',roleId:'development',afterAttemptId:'old-retained'});h.store.put('run',run);
  const result=h.engine.requestRework(h.run.id,'verify',h.input,OWNER,{deferDispatch:true});assert.ok(result.browserContinuations!.slice(0,2).every(value=>value.revokedAt));assert.equal(result.browserContinuations![2].revokedAt,undefined);assert.equal(pendingBrowserContinuation(result,'verify'),undefined);assert.deepEqual(result.snapshot,h.run.snapshot);assert.equal(h.tasks.length,0);
});

test('rework termination proof must match every recorded assignment reference and an ended state',async t=>{
  for(const variant of ['matched','issue','task','agent','runtime','provider','active-status','unassigned-with-ref','unassigned-empty'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub),run=h.engine.run(h.run.id);run.stages[2].attempts[0].ref={provider:'multica',issueId:'synthetic-actual-issue',externalId:'synthetic-actual-task',agentId:'synthetic-actual-agent',runtimeId:'synthetic-actual-runtime'};
    const record={id:'old-verify',projectId:h.project.id,runId:run.id,stageId:'verify',status:'completed',cleanupConfirmed:true,issueId:'synthetic-actual-issue',taskId:'synthetic-actual-task',agentId:'synthetic-actual-agent',runtimeId:'synthetic-actual-runtime'};
    if(variant==='provider')run.stages[2].attempts[0].ref!.provider='codex';if(variant==='issue')record.issueId='another-issue';if(variant==='task')record.taskId='another-task';if(variant==='agent')record.agentId='another-agent';if(variant==='runtime')record.runtimeId='another-runtime';if(variant==='active-status')record.status='running';
    if(variant.startsWith('unassigned')){record.status='not_dispatched';delete (record as Partial<typeof record>).issueId;delete (record as Partial<typeof record>).taskId;if(variant==='unassigned-empty')delete run.stages[2].attempts[0].ref;}
    h.store.put('run',run);h.store.put('multica-execution',record);
    if(variant==='matched'||variant==='unassigned-empty'){h.engine.requestRework(run.id,'verify',h.input,OWNER,{deferDispatch:true});assert.equal(h.engine.run(run.id).stages[1].status,'queued');}
    else{assert.throws(()=>h.engine.requestRework(run.id,'verify',h.input,OWNER),code('EXTERNAL_RECONCILIATION_REQUIRED'));assert.deepEqual(h.engine.run(run.id),run);assert.equal(h.store.list('run-rework-receipt').length,0);assert.equal(h.store.list('rework-guidance').length,0);}
    assert.equal(h.tasks.length,0);
  });
});
