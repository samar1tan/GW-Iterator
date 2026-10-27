import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,ProjectDetail,Run,WorkRecoveryRecord} from '../src/contracts.ts';
import {observeProjectWork,withCreatedWork,type CreatedWork} from '../web/platform/workObservations.ts';
import {knownWorkspace,unobservedWorkspaceReceipts,workspaceWorkCurrent,workspaceWorkNeedsInput} from '../web/platform/globalWork.ts';
import {recordWorkStart} from '../web/platform/workStart.ts';
import {currentWorkRecovery,recoveryReceiptObserved,workRecoveryTiming} from '../web/platform/workRecovery.ts';

const at='2026-01-01T00:00:00Z',later='2026-01-01T00:00:01Z';
function fixtures(){
  const project={id:'synthetic-project',name:'Synthetic recovery project',description:'Independent synthetic UI fixture.',repository:'synthetic/recovery',workspace:'/synthetic/recovery',revision:1,roles:[],knowledgeSources:[],createdAt:at,updatedAt:at};
  const pipeline={id:'synthetic-flow',projectId:project.id,name:'Synthetic evidence workflow',description:'Retry only retained synthetic evidence.',roleId:'owner',revision:1,updatedAt:at,policy:{maxAttempts:2,maxIterations:1,concurrency:1,timeoutSeconds:300,tokenBudget:1000},stages:[{id:'inspect',name:'Inspect the retained evidence',roleId:'owner',executor:'codex' as const,prompt:'Keep accepted work.',dependsOn:[],review:false}]};
  const run:Run={id:'synthetic-run',projectId:project.id,pipelineId:pipeline.id,goal:'Inspect the synthetic evidence.',baseline:'synthetic-baseline',trigger:{kind:'human',actor:'Synthetic owner'},status:'failed',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-run-key',inputHash:'synthetic-hash',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'inspect',status:'failed',attempts:[{id:'synthetic-attempt',number:1,iteration:1,status:'failed',startedAt:at,endedAt:later,failureCode:'STAGE_TIMEOUT',error:'SYNTHETIC_RAW_STEP_DETAIL'}]}]};
  const goal:Intake={id:'synthetic-goal',projectId:project.id,request:'Inspect the synthetic evidence.',baseline:'synthetic-baseline',status:'failed',createdAt:at,updatedAt:at,routerRunId:'synthetic-router',idempotencyKey:'synthetic-goal-key',targetRunIds:[run.id],rounds:[],policy:{maxRounds:2,maxParallel:1,maxElapsedSeconds:300,maxTotalTokens:1000},canRetry:false,retryBlockedCode:'EXTERNAL_RECONCILIATION_REQUIRED',error:'SYNTHETIC_RAW_GOAL_DETAIL',retryBlockedReason:'SYNTHETIC_RAW_CLEANUP_DETAIL',controlRevision:0};
  const detail:ProjectDetail={project,pipelines:[pipeline],runs:[run],intakes:[goal],events:[],knowledge:[],proposals:[]};
  const record:WorkRecoveryRecord={id:'synthetic-recovery',trigger:'manual',phase:'checking',runId:run.id,stageId:'inspect',attemptId:'synthetic-attempt',routerRunId:goal.routerRunId,controlRevision:0,startedAt:later,deadlineAt:'2030-01-01T00:01:00Z',nextAt:later,checks:0,code:'CONFIRMING_TERMINATION'};
  return{goal,detail,run,record};
}

test('same-router recovery receipts survive an old GET and are acknowledged by their own record',async()=>{
  const{goal,detail,record}=fixtures(),next={...goal,updatedAt:later,workRecoveryHistory:[record]},receipt:CreatedWork={kind:'continued-intake',value:next,previous:goal};
  const injected=withCreatedWork(detail,receipt);assert.equal(injected.intakes[0].workRecoveryHistory?.at(-1)?.id,record.id);
  const old=observeProjectWork(injected,detail,[receipt]);assert.equal(old.pending.length,1);assert.equal(old.detail.intakes[0].workRecoveryHistory?.at(-1)?.id,record.id);
  const checked={...next,workRecoveryHistory:[{...record,phase:'backoff' as const,checks:1,code:'RETRY_SCHEDULED'}]};
  assert.equal(observeProjectWork(old.detail,{...detail,intakes:[checked]},old.pending).pending.length,0);
  const stopped={...next,status:'stopped' as const,controlRevision:1,workRecoveryHistory:[{...record,phase:'cancelled' as const,code:'RECOVERY_CANCELLED'}]};
  assert.equal(withCreatedWork({...detail,intakes:[stopped]},receipt).intakes[0].status,'stopped');
  assert.equal(recoveryReceiptObserved(stopped,next),true);
  const superseded={...next,routerRunId:'synthetic-next-router',supervisorRunIds:[goal.routerRunId,'synthetic-next-router'],workRecoveryHistory:[{...record,phase:'needs_input' as const,code:'GOAL_BOUNDARY'}]};
  assert.equal(currentWorkRecovery(superseded),undefined);assert.equal(recoveryReceiptObserved(superseded,next),true);
  const supersededRecord={...goal,workRecoveryHistory:[{...record,phase:'cancelled' as const,code:'RECOVERY_SUPERSEDED'}]};
  assert.equal(currentWorkRecovery(supersededRecord),undefined);
  const timingRecord={...record,nextAt:'2026-01-01T00:00:05Z',deadlineAt:'2026-01-01T00:01:00Z'};
  assert.deepEqual(workRecoveryTiming(timingRecord,Date.parse(at)),{nextSeconds:5,remainingSeconds:60,expired:false});
  assert.deepEqual(workRecoveryTiming(timingRecord,Date.parse('2026-01-01T00:00:01Z')),{nextSeconds:4,remainingSeconds:59,expired:false});
  assert.equal(workRecoveryTiming(timingRecord,Date.parse('2026-01-01T00:01:00Z')).expired,true);
  let recorded=0,observationErrors=0;
  const result=await recordWorkStart(async()=>next,()=>recorded++,async()=>{throw new Error('Synthetic HTTP 503');},()=>observationErrors++);
  assert.equal(result,next);assert.equal(recorded,1);assert.equal(observationErrors,1);
});

test('global recovery receipts stay current until summary observation and need-input does not become a result',()=>{
  const{goal,detail,record}=fixtures(),next={...goal,updatedAt:later,workRecoveryHistory:[record]},receipt:CreatedWork={kind:'continued-intake',value:next,previous:goal};
  const projects=[{id:goal.projectId,name:detail.project.name,repository:detail.project.repository,revision:1,pipelineCount:1}];
  const known=knownWorkspace(null,projects,[receipt])!;
  assert.equal(workspaceWorkCurrent(known.work[0]),true);assert.equal(workspaceWorkNeedsInput(known.work[0]),false);assert.equal(known.observedAt,'');
  const old={...known,work:[{...known.work[0],updatedAt:at,recoveryPhase:undefined,recoveryId:undefined}]};
  assert.equal(unobservedWorkspaceReceipts(old,[receipt]).length,1);
  assert.equal(unobservedWorkspaceReceipts({...old,work:[{...old.work[0],updatedAt:later}]},[receipt]).length,1,'An equal timestamp cannot acknowledge a different recovery identity.');
  assert.equal(unobservedWorkspaceReceipts(known,[receipt]).length,0);
  assert.equal(workspaceWorkNeedsInput({...known.work[0],recoveryPhase:'needs_input'}),true);
});

test('recovery surfaces explain deadlines and stopping reasons in both locales without duplicate raw banners',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx'),{WorkRecoverySurface}=await vite.ssrLoadModule('/web/platform/WorkRecoverySurface.tsx'),{Workbench}=await vite.ssrLoadModule('/web/platform/Workbench.tsx'),{canPerformStageRecovery}=await vite.ssrLoadModule('/web/platform/StageRecovery.tsx');
  assert.equal(canPerformStageRecovery('reconcile',true),true,'Model-free checks remain available with an unavailable account reading.');
  assert.equal(canPerformStageRecovery('retry',true),false);assert.equal(canPerformStageRecovery('approve',true),false);
  const{goal,detail,run,record}=fixtures();
  for(const locale of ['en','zh-CN']){
    const render=(component:any,props:any)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component,props)));
    const props={goal,detail,models:[],onRun(){},onBack(){},onChanged:async()=>{}};
    const failed=render(GoalWorkspace,props);
    assert.ok(failed.includes(locale==='en'?'Retry failed step':'重试失败步骤'));
    const surface=failed.slice(failed.indexOf('class="pf-work-recovery"')),technical=surface.indexOf('<details');
    assert.ok(technical>0);assert.equal(surface.slice(0,technical).includes('SYNTHETIC_RAW_'),false);
    assert.equal(failed.split('SYNTHETIC_RAW_CLEANUP_DETAIL').length-1,1);
    const checking=render(GoalWorkspace,{...props,goal:{...goal,rationale:'Synthetic earlier dispatch rationale.',workRecoveryHistory:[record]}});
    assert.ok(checking.includes(locale==='en'?'Confirming the previous execution has ended':'正在确认上次执行已结束'));
    assert.ok(checking.includes(locale==='en'?'at most':'最多再检查'));assert.ok(checking.includes(locale==='en'?'Stop':'停止'));
    assert.ok(!checking.includes('Synthetic earlier dispatch rationale.'));
    assert.match(checking,/<p class="pf-work-recovery-time">/);
    const smart=render(GoalWorkspace,{...props,goal:{...goal,policy:{...goal.policy,smartRetry:true}}});
    assert.ok(smart.includes(locale==='en'?'at most two automatic retries':'最多自动重试两次'));assert.ok(!smart.includes('class="goal-recovery-policy"'));assert.ok(failed.includes('class="goal-recovery-policy"'));
    const stopped=render(WorkRecoverySurface,{goal:{...goal,workRecoveryHistory:[{...record,phase:'needs_input',code:'REPEATED_TIMEOUT'}]},runs:[run],id:'synthetic-surface',busy:false,error:null,observationFailed:false,onRefresh:async()=>{},onRetry(){},onStep(){}});
    assert.ok(stopped.includes(locale==='en'?'This step timed out again':'这个步骤再次超时'));assert.ok(stopped.includes(locale==='en'?'Review step recovery':'查看步骤恢复选项'));
    const needsInput={...goal,workRecoveryHistory:[{...record,phase:'needs_input' as const,code:'REPEATED_TIMEOUT'}]};
    const workbench=render(Workbench,{detail:{...detail,intakes:[needsInput]},onGoal(){},onRun(){},onPipeline(){},onLibrary(){},onStartPipeline:async()=>{},onChanged:async()=>{}});
    const attention=workbench.slice(workbench.indexOf('pf-decision-section'),workbench.indexOf('pf-delivery-section'));
    assert.ok(attention.includes(goal.request));assert.ok(attention.includes(locale==='en'?'Review recovery':'查看恢复选项'));
    const completedRun={...run,status:'completed',stages:run.stages.map(stage=>({...stage,status:'completed'}))},coordinator={...completedRun,id:goal.routerRunId,executionKind:'agent-goal'};
    const ready=render(GoalWorkspace,{...props,goal:needsInput,detail:{...detail,runs:[completedRun,coordinator],intakes:[needsInput]}});
    assert.ok(ready.includes(locale==='en'?'Resume task':'继续任务'));assert.ok(!ready.includes(locale==='en'?'Retry failed step':'重试失败步骤'));
    const externalRun={...run,snapshot:{...run.snapshot,pipeline:{...run.snapshot.pipeline,stages:run.snapshot.pipeline.stages.map(stage=>({...stage,executor:'github'}))}}};
    const external=render(GoalWorkspace,{...props,goal:{...goal,workRecoveryHistory:[{...record,phase:'needs_input',code:'EXTERNAL_REVIEW_REQUIRED'}]},detail:{...detail,runs:[externalRun]}});
    assert.ok(external.includes(locale==='en'?'Review the external task result before deciding':'先查看外部任务结果'));assert.ok(external.includes(locale==='en'?'View external task result':'查看外部任务结果'));assert.ok(!external.includes(locale==='en'?'Retry failed step':'重试失败步骤'));
    const stale=render(WorkRecoverySurface,{goal:{...goal,workRecoveryHistory:[record]},runs:[run],id:'synthetic-stale',busy:false,error:null,observationFailed:true,onRefresh:async()=>{},onRetry(){},onStep(){}});
    assert.ok(stale.includes(locale==='en'?'Recovery status needs an update':'需要更新恢复状态'));assert.ok(!stale.includes('class="pf-work-recovery-time"'));
  }
});
