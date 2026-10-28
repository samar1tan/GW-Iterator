import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,ProjectDetail,ProjectOverview,Run,WorkspaceWork,WorkRecoveryRecord} from '../src/contracts.ts';
import {workspaceSummary} from '../src/workspace.ts';
import {currentGoalRecovery,runAcceptsInput} from '../src/contracts.ts';
import {knownWorkspace,unobservedWorkspaceReceipts,workspaceWithReceipts,workspaceWorkCurrent,workspaceWorkNeedsInput} from '../web/platform/globalWork.ts';
import {currentWorkRecovery,recoveryReceiptObserved,workRecoveryPending} from '../web/platform/workRecovery.ts';
import {observeProjectWork,withCreatedWork} from '../web/platform/workObservations.ts';

const at='2026-01-01T00:00:00Z',later='2026-01-01T00:01:00Z',latest='2026-01-01T00:02:00Z';
const phases:WorkRecoveryRecord['phase'][]=['checking','backoff','retrying','resuming','needs_input','completed','cancelled'];
const project=(id='one'):ProjectOverview=>({id,name:'Synthetic project '+id,revision:1,description:'Authored state regression.',workspace:'/synthetic/'+id,repository:'',roles:[{id:'worker',name:'Synthetic worker',description:'',instructions:'Synthetic instructions.',model:null,effort:'max',sandbox:'read-only',skills:[],tools:[]}],knowledgeSources:[],createdAt:at,updatedAt:at,runCount:0,activeRuns:0,waitingRuns:0,knowledgeCount:0,pipelineCount:1});
const record=(phase:WorkRecoveryRecord['phase']='needs_input',id='old-recovery'):WorkRecoveryRecord=>({id,phase,trigger:'automatic',runId:'owned',stageId:'check',routerRunId:'router',controlRevision:0,startedAt:at,deadlineAt:later,nextAt:at,checks:1,code:phase==='needs_input'?'TERMINATION_UNCONFIRMED':'CONFIRMING_TERMINATION'});
const goal=(status:Intake['status']='failed',phase:WorkRecoveryRecord['phase']='needs_input'):Intake=>({id:'goal',projectId:'one',request:'Synthetic stopped goal',baseline:'Synthetic source.',status,createdAt:at,updatedAt:at,routerRunId:'router',targetRunIds:['owned'],rounds:[],idempotencyKey:'synthetic-goal',controlRevision:0,workRecoveryHistory:[record(phase)],policy:{maxRounds:2,maxParallel:1,maxTotalTokens:1000,maxElapsedSeconds:300}});
function run(id='owned',projectId='one',parentRunId?:string):Run {
  const owner=project(projectId),pipeline={id:'flow-'+id,projectId,revision:1,name:'Synthetic flow',description:'',roleId:'worker',updatedAt:at,stages:[{id:'check',name:'Historical gate '+id,roleId:'worker',executor:'manual' as const,dependsOn:[],prompt:'Synthetic manual input.',review:false}],policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:1000}};
  return{id,projectId,pipelineId:pipeline.id,goal:'Synthetic action '+id,baseline:'Synthetic source.',trigger:{kind:'human',actor:'Synthetic owner'},status:'waiting',iteration:1,mode:'once',createdAt:at,updatedAt:at,parentRunId,dependsOnRunIds:[],idempotencyKey:id,inputHash:id,snapshot:{project:owner,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'check',status:'waiting',attempts:[]}]};
}
const detail=(value:Intake,runs:Run[]=[]):ProjectDetail=>({project:project(),pipelines:[],runs,intakes:[value],events:[],knowledge:[],proposals:[]});

test('closed goals treat every recovery phase as history without rewriting evidence',()=>{
  for(const status of ['stopped','completed'] as const)for(const phase of phases){
    const value=goal(status,phase),owned=run(),before=JSON.stringify({value,owned});
    const summary=workspaceSummary([project()],[owned],[value],1),item=summary.work[0];
    assert.equal(currentGoalRecovery(value),undefined);assert.equal(currentWorkRecovery(value),undefined);assert.equal(workRecoveryPending(value),false);
    assert.equal(item.recoveryPhase,undefined);assert.equal(item.recoveryId,undefined);assert.equal(item.attention,undefined);assert.equal(item.waitingForInput,undefined);
    assert.equal(workspaceWorkCurrent(item),false);assert.equal(workspaceWorkNeedsInput(item),false);assert.deepEqual(summary.decisions,[]);
    assert.equal(JSON.stringify({value,owned}),before);
    for(const stalePhase of phases){const oldServer={...item,attention:true,recoveryPhase:stalePhase};assert.equal(workspaceWorkCurrent(oldServer),false);assert.equal(workspaceWorkNeedsInput(oldServer),false);}
  }
});

test('only the current recovery generation contributes attention or activity',()=>{
  const active=goal('failed','checking');assert.ok(currentGoalRecovery(active));assert.equal(workRecoveryPending(active),true);
  for(const stale of [{...active,controlRevision:1},{...active,routerRunId:'new-router'},{...active,workRecoveryHistory:[{...record('needs_input'),code:'RECOVERY_SUPERSEDED'}]}]){
    assert.equal(currentGoalRecovery(stale),undefined);assert.equal(workspaceSummary([project()],[],[stale],1).work[0].recoveryPhase,undefined);
  }
  const failed=workspaceSummary([project()],[],[goal()],1).work[0];assert.equal(workspaceWorkNeedsInput(failed),true);
});

test('closed owners suppress direct and nested historical gates but not independent or other-project input',()=>{
  for(const status of ['stopped','completed'] as const){
    const value=goal(status),owned=run(),nested=run('nested','one',owned.id),independent=run('independent'),other=run('owned','two');
    nested.stages[0].status='review';independent.snapshot.pipeline.stages[0].name='Current independent gate';
    const runs=[owned,nested,independent,other],summary=workspaceSummary([project(),project('two')],runs,[value],1);
    assert.equal(runAcceptsInput(owned,runs,[value]),false);assert.equal(runAcceptsInput(nested,runs,[value]),false);
    assert.equal(runAcceptsInput(independent,runs,[value]),true);assert.equal(runAcceptsInput(other,runs,[value]),true);
    assert.deepEqual(summary.decisions.map(item=>[item.projectId,item.runId]),[['one','independent'],['two','owned']]);
    assert.ok(!summary.work.some(item=>item.id==='owned'&&item.projectId==='one'||item.id==='nested'));
    for(const state of ['cancelled','completed'] as const){const closed=run('direct');closed.status=state;assert.deepEqual(workspaceSummary([project()],[closed],[],1).decisions,[]);}
  }
});

test('later Stop and completion observations supersede an older recovery receipt on both surfaces',()=>{
  const previous=goal(),continued={...previous,updatedAt:later,workRecoveryHistory:[record('checking','new-recovery')]},receipt={kind:'continued-intake' as const,value:continued,previous};
  for(const status of ['stopped','completed'] as const)for(const revision of [0,1]){
    const terminal={...continued,status,updatedAt:latest,controlRevision:revision},snapshot=detail(terminal),summary=workspaceSummary([project()],[],[terminal],2);
    assert.equal(recoveryReceiptObserved(terminal,continued),true);assert.equal(withCreatedWork(snapshot,receipt).intakes[0].status,status);
    assert.deepEqual(observeProjectWork(undefined,snapshot,[receipt]).pending,[]);
    assert.deepEqual(unobservedWorkspaceReceipts(summary,[receipt]),[]);assert.equal(workspaceWithReceipts(summary,[receipt]).work[0].status,status);
  }
});

test('a fresh explicit recovery can still overlay an older stopped observation in the same router and generation',()=>{
  const stopped={...goal('stopped'),controlRevision:1},freshRecord={...record('checking','fresh-recovery'),controlRevision:1},continued={...stopped,status:'failed' as const,updatedAt:later,workRecoveryHistory:[...stopped.workRecoveryHistory!,freshRecord]},receipt={kind:'continued-intake' as const,value:continued,previous:stopped};
  assert.equal(recoveryReceiptObserved(stopped,continued),false);assert.equal(withCreatedWork(detail(stopped),receipt).intakes[0].status,'failed');
  assert.equal(observeProjectWork(undefined,detail(stopped),[receipt]).pending.length,1);
  const oldSummary=workspaceSummary([project()],[],[stopped],1),overlaid=knownWorkspace(oldSummary,oldSummary.projects,[receipt])!;
  assert.equal(overlaid.work[0].recoveryId,freshRecord.id);assert.equal(workspaceWorkCurrent(overlaid.work[0]),true);assert.equal(workspaceWorkNeedsInput(overlaid.work[0]),false);
  assert.equal(unobservedWorkspaceReceipts(oldSummary,[receipt]).length,1);
});

test('receipt overlays remove stale child decisions when the owning work is already closed',()=>{
  const value=goal('stopped'),summary=workspaceSummary([project()],[],[value],1);
  summary.decisions=[{id:'stale-review',projectId:'one',kind:'review',title:'Historical input',request:value.request,runId:'owned',stageId:'check',workKind:'goal',workId:value.id}];
  assert.deepEqual(workspaceWithReceipts(summary,[]).decisions,[]);
});

test('bilingual workbench and goal views show stopped history without inherited recovery actions',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{Workbench}=await vite.ssrLoadModule('/web/platform/Workbench.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx'),{WorkState}=await vite.ssrLoadModule('/web/platform/GlobalWorkbench.tsx'),{RunWorkspace}=await vite.ssrLoadModule('/web/platform/RunWorkspace.tsx');
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof Workbench,props)));
    for(const phase of phases){
      const stopped={...goal('stopped',phase),canRetry:true},owned=run(),independent=run('independent');independent.snapshot.pipeline.stages[0].name='Current independent gate';
      const data=detail(stopped,[owned,independent]),bench=render(Workbench,{detail:data,onGoal(){},onRun(){},onPipeline(){},onLibrary(){},onStartPipeline:async()=>{},onChanged:async()=>{}});
      const decisions=bench.slice(bench.indexOf('pf-decision-section'),bench.indexOf('pf-delivery-section')),history=bench.slice(bench.indexOf('pf-history-section'));
      assert.ok(decisions.includes('Current independent gate'));assert.ok(!decisions.includes(stopped.request));assert.ok(!decisions.includes('Historical gate owned'));
      assert.ok(history.includes(stopped.request));assert.ok(history.includes(locale==='en'?'Stopped':'已停止'));
      const page=render(GoalWorkspace,{goal:stopped,detail:data,models:[],onRun(){},onBack(){},onChanged:async()=>{}});
      assert.ok(!page.includes('class="pf-work-recovery"'));assert.ok(!page.includes('Historical gate owned'));
      for(const status of ['stopped','completed'] as const){
        const item:WorkspaceWork={id:'goal',projectId:'one',kind:'goal',title:'Synthetic goal',status,updatedAt:at,recoveryPhase:phase};
        const label=render(WorkState,{item});assert.ok(label.includes(locale==='en'?(status==='stopped'?'Stopped':'Completed'):(status==='stopped'?'已停止':'已完成')));
      }
    }
    for(const status of ['waiting','review'] as const){
      const live=run();live.stages[0].status=status;
      const props={events:[],onSelect(){},onRun(){},onBack(){},onChanged:async()=>{}};
      const active=render(RunWorkspace,{...props,run:live});assert.match(active,/class="[^"]*primary/);
      for(const state of ['cancelled','completed'] as const){
        const closed={...live,status:state},page=render(RunWorkspace,{...props,run:closed});
        assert.doesNotMatch(page,/class="[^"]*primary/);assert.ok(!page.includes('class="pf-stage-decision"'));
        assert.equal(page.includes(locale==='en'?'Further execution stopped':'已停止后续执行'),state==='cancelled');
      }
      const stopped=goal('stopped'),nested=run('nested','one',live.id),family=[live,nested];nested.stages[0].status=status;
      const historical=render(RunWorkspace,{...props,run:nested,acceptsInput:runAcceptsInput(nested,family,[stopped])});
      assert.doesNotMatch(historical,/class="[^"]*primary/);assert.ok(!historical.includes('class="pf-stage-decision"'));
      const cancelling={...live,cancelRequested:true};assert.equal(runAcceptsInput(cancelling,[cancelling],[]),false);
    }
  }
});
