import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,Project,ProjectDetail,Run} from '../src/contracts.ts';
import {activityTitle,isHumanActivity} from '../web/platform/activity.ts';

const at='2026-01-01T00:00:00Z';
const project:Project={id:'synthetic-answer-project',name:'Synthetic answer project',description:'Independently authored answer-rendering fixture.',workspace:'/synthetic/project',repository:'',roles:[],knowledgeSources:[],revision:1,createdAt:at,updatedAt:at};
const goal:Intake={id:'synthetic-question',projectId:project.id,request:'Explain the recorded project status.',baseline:'Synthetic committed basis.',status:'completed',resultKind:'answer',createdAt:at,updatedAt:at,routerRunId:'synthetic-coordinator',idempotencyKey:'synthetic-question',targetRunIds:[],rounds:[],policy:{maxRounds:2,maxParallel:1,maxTotalTokens:10000,maxElapsedSeconds:300},outcome:'## Current status\n\nNo actions are active. **Delivery has not been verified.**'};
const coordinator:Run={id:goal.routerRunId,projectId:project.id,pipelineId:'synthetic-planner',goal:goal.request,baseline:goal.baseline,trigger:{kind:'human',actor:'Synthetic owner'},executionKind:'agent-goal',status:'completed',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-coordinator',inputHash:'synthetic-input',snapshot:{project,pipeline:{id:'synthetic-planner',projectId:project.id,revision:1,name:'Synthetic coordination',description:'One read-only decision.',roleId:'lead',stages:[],policy:{concurrency:1,maxAttempts:1,maxIterations:1,timeoutSeconds:300,tokenBudget:10000},updatedAt:at},pipelines:[],knowledge:[]},stages:[{stageId:'supervise',status:'completed',attempts:[{id:'synthetic-ended-attempt',number:1,iteration:1,status:'completed',startedAt:at,endedAt:at,provider:'multica',output:{outcome:'done',summary:goal.outcome!,artifacts:[],observations:[]}}]}]};
function detail(item:Intake,run:Run=coordinator):ProjectDetail{return{project,pipelines:[],runs:[run],intakes:[item],knowledge:[],events:[],proposals:[]};}

test('questions show answers and retained failed results without inventing delivery or replaying work',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const {GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx');
  const {Workbench}=await vite.ssrLoadModule('/web/platform/Workbench.tsx');
  const render=(locale:string,Component:typeof GoalWorkspace,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(Component,props)));
  for(const locale of ['en','zh-CN']){
    const props={goal,detail:detail(goal),models:[],onRun:()=>{},onBack:()=>{},onChanged:async()=>{}};
    const answered=render(locale,GoalWorkspace,props);
    assert.ok(answered.includes(locale==='en'?'Answered':'已回答'));
    assert.ok(answered.includes(locale==='en'?'<h2>Answer</h2>':'<h2>回答</h2>'));
    assert.ok(answered.includes('<strong>Delivery has not been verified.</strong>'));
    assert.ok(!answered.includes(locale==='en'?'<h2>Actions</h2>':'<h2>行动</h2>'));
    const history=render(locale,Workbench,{detail:detail(goal),onGoal:()=>{},onRun:()=>{},onPipeline:()=>{},onLibrary:()=>{},onStartPipeline:async()=>{},onChanged:async()=>{}});
    assert.ok(history.includes(locale==='en'?'Answered':'已回答'));
    const failed:Intake={...goal,status:'failed',resultKind:undefined,outcome:undefined,error:'Synthetic completion guard rejected the result.'};
    const before=structuredClone({failed,coordinator});
    const retained=render(locale,GoalWorkspace,{...props,goal:failed,detail:detail(failed)});
    assert.ok(retained.includes(locale==='en'?'Generated result':'已生成的结果'));
    assert.ok(retained.includes('<strong>Delivery has not been verified.</strong>'));
    assert.ok(retained.includes(failed.error!));
    assert.ok(!retained.includes(locale==='en'?'Determining the work scope':'正在确定工作范围'));
    assert.deepEqual({failed,coordinator},before);
    const noOutput={...coordinator,stages:[{stageId:'supervise',status:'failed' as const,attempts:[]}]};
    const empty=render(locale,GoalWorkspace,{...props,goal:failed,detail:detail(failed,noOutput)});
    assert.ok(empty.includes(locale==='en'?'Retry task':'重试任务'));
    assert.ok(empty.includes('class="pf-work-recovery"'));
    assert.ok(!empty.includes(locale==='en'?'Determining the work scope':'正在确定工作范围'));
  }
  assert.equal(activityTitle('goal.answered'),'eventAnswered');
  assert.ok(isHumanActivity({seq:1,at,projectId:project.id,runId:coordinator.id,stageId:null,type:'goal.answered',actor:'synthetic-coordinator',message:goal.outcome!}));
});
