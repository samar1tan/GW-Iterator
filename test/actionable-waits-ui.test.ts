import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,Pipeline,Project,Run} from '../src/contracts.ts';

const at='2026-01-01T00:00:00.000Z';
const project:Project={id:'synthetic-actions',revision:1,name:'Synthetic waiting project',description:'Independently authored recovery expectations.',workspace:'/synthetic/actions',repository:'',knowledgeSources:[],createdAt:at,updatedAt:at,roles:[{id:'development',name:'Development',description:'Prepare bounded work.',instructions:'Use synthetic evidence.',model:null,effort:'max',sandbox:'workspace-write',skills:[],tools:[]}]};
const pipeline:Pipeline={id:'synthetic-action-flow',projectId:project.id,revision:1,name:'Synthetic focused correction',description:'One independently checked correction.',roleId:'development',updatedAt:at,policy:{concurrency:1,maxAttempts:3,maxIterations:1,timeoutSeconds:300,tokenBudget:10000},stages:[{id:'work',name:'Inspect the correction',roleId:'development',executor:'codex',dependsOn:[],prompt:'Use only independently authored input.',review:false}]};
const run:Run={id:'synthetic-held-work',projectId:project.id,pipelineId:pipeline.id,goal:'Inspect the correction.',baseline:'Synthetic source basis.',status:'waiting',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-key',inputHash:'synthetic-hash',trigger:{kind:'human',actor:'Synthetic owner'},snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'work',status:'waiting',allowanceHold:{code:'ACCOUNT_ALLOWANCE_CHANGED'},attempts:[{id:'synthetic-not-dispatched',number:1,iteration:1,status:'failed',startedAt:at,endedAt:at,admissionHeld:true,failureCode:'ACCOUNT_ALLOWANCE_CHANGED'}]}]};

test('waiting and failed work expose direct actions and a usable note before diagnostics',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{StageRecovery,stageDecisionKey,stageResolutionObserved,pendingStageResolution}=await vite.ssrLoadModule('/web/platform/StageRecovery.tsx'),{RunWorkspace}=await vite.ssrLoadModule('/web/platform/RunWorkspace.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx');
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof StageRecovery,props)));
    const props={run,stageId:'work',onChanged:async()=>{}},held=render(StageRecovery,props);
    assert.ok(held.includes(locale==='en'?'Continue this step':'继续此步'));
    assert.ok(held.includes(locale==='en'?'Do not retry':'不再重试'));
    assert.ok(held.includes('aria-keyshortcuts="Enter Meta+Enter Control+Enter"'));
    assert.ok(held.indexOf('pf-resolution-actions')<held.indexOf('<textarea'),'A person can act before expanding or typing a note.');
    const failed={...run,status:'failed',stages:[{...run.stages[0],status:'failed',allowanceHold:undefined}]};
    assert.ok(render(StageRecovery,{...props,run:failed}).includes(locale==='en'?'Retry this step':'重试此步骤'));
    const cancelled={...run,status:'cancelled',cancelRequested:true,continuationDeclined:{at,actor:'Synthetic owner',note:'Do not retry.'},stages:[{...run.stages[0],status:'cancelled'}]};
    const stopped=render(RunWorkspace,{...props,run:cancelled,events:[],onSelect(){},onRun(){},onBack(){}});
    assert.ok(stopped.includes(locale==='en'?'Further execution stopped':'已停止后续执行'));
    assert.ok(!stopped.includes('<textarea'));assert.ok(!stopped.includes(locale==='en'?'waiting for an account':'等待账户额度决策'));
    const goal:Intake={id:'synthetic-goal-actions',projectId:project.id,request:run.goal,baseline:run.baseline,status:'dispatched',routerRunId:'synthetic-supervisor',targetRunIds:[run.id],rounds:[],createdAt:at,updatedAt:at,idempotencyKey:'synthetic-goal-key',policy:{maxRounds:4,maxParallel:1,maxElapsedSeconds:3600,maxTotalTokens:600000}};
    const detail={project,pipelines:[pipeline],runs:[run],knowledge:[],proposals:[],events:[],intakes:[goal]};
    const globalInspector=render(GoalWorkspace,{goal,detail,models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    assert.equal(globalInspector.split(locale==='en'?'Do not retry':'不再重试').length-1,1);
    assert.ok(globalInspector.includes('pf-goal-step-resolution'));
    const closed=render(GoalWorkspace,{goal:{...goal,status:'completed'},detail:{...detail,intakes:[{...goal,status:'completed'}]},models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(!closed.includes('pf-goal-step-resolution'));assert.ok(!closed.includes(locale==='en'?'Do not retry':'不再重试'));
    const laterRun={...run,id:'synthetic-later-success',status:'completed',stages:run.stages.map(stage=>({...stage,status:'completed'}))};
    const laterGoal={...goal,status:'dispatched',targetRunIds:[run.id,laterRun.id],rounds:[{number:1,routerRunId:'synthetic-supervisor',targetRunIds:[run.id]},{number:2,routerRunId:'synthetic-later-supervisor',targetRunIds:[laterRun.id]}]};
    const later=render(GoalWorkspace,{goal:laterGoal,detail:{...detail,runs:[run,laterRun],intakes:[laterGoal]},models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(!later.includes('pf-goal-step-resolution'),'Earlier failed actions stay in history after a later action replaces them.');
  }
  assert.equal(stageDecisionKey(run,'work'),stageDecisionKey({...run,updatedAt:'2026-01-01T01:00:00.000Z'},'work'),'Background polling cannot continually abort a pending decision lookup.');
  assert.notEqual(stageDecisionKey(run,'work'),stageDecisionKey({...run,controlRevision:1},'work'));
  const receipt={...run,updatedAt:'2026-01-01T01:00:00.000Z'};
  const queued={...run,status:'queued',updatedAt:at,stages:run.stages.map(stage=>({...stage,status:'queued'}))};
  const failedAgain={...run,status:'failed',updatedAt:at,stages:run.stages.map(stage=>({...stage,status:'failed',attempts:[...stage.attempts,{...stage.attempts[0],id:'synthetic-second-attempt',number:2}]}))};
  assert.equal(pendingStageResolution(run,queued),queued,'An old GET with the same timestamp must not erase an acknowledged retry.');
  assert.equal(pendingStageResolution(failedAgain,queued),null,'A rapid second failure takes over even without an intermediate running poll.');
  assert.equal(pendingStageResolution({...failedAgain,cancelRequested:true,controlRevision:1,status:'cancelled'},queued),null,'A later Stop takes precedence over a prior accepted receipt.');
  assert.equal(stageResolutionObserved(run,receipt),false);assert.equal(stageResolutionObserved(receipt,receipt),true);assert.equal(stageResolutionObserved({...receipt,id:'synthetic-other-work'},receipt),false);
});
