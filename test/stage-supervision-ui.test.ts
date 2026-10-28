import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,Pipeline,Project,Run} from '../src/contracts.ts';
import type {AllowanceAssessment} from '../src/account-allowance-types.ts';

const at='2026-01-01T00:00:00.000Z';
const project:Project={id:'synthetic-supervision',revision:1,name:'Synthetic supervision',description:'Independently authored stage supervision examples.',workspace:'/synthetic/supervision',repository:'',createdAt:at,updatedAt:at,knowledgeSources:[],roles:[{id:'worker',name:'Synthetic worker',description:'Prepare a verifiable result.',instructions:'Preserve source and recorded evidence.',model:null,effort:'max',sandbox:'workspace-write',skills:[],tools:[]}]};
const pipeline:Pipeline={id:'synthetic-supervision-flow',projectId:project.id,revision:1,name:'Synthetic supervised work',description:'One task with explicit delivery checks.',roleId:'worker',stages:[{id:'work',name:'Prepare evidence',roleId:'worker',executor:'codex',prompt:'Prepare the requested evidence.',dependsOn:[],review:true,checks:['Check the actual result.']}],updatedAt:at,policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:120000}};
const run:Run={id:'synthetic-supervision-run',projectId:project.id,pipelineId:pipeline.id,goal:'Prepare and verify the synthetic result.',baseline:'Independently authored fixture.',trigger:{kind:'human',actor:'Synthetic owner'},status:'failed',iteration:12,mode:'loop',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-run-key',inputHash:'synthetic-input',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'work',status:'failed',attempts:[{id:'synthetic-attempt',number:8,iteration:12,status:'failed',startedAt:at,endedAt:at,usage:{input:150000,output:9000,total:159000},nativeCleanupConfirmed:true,error:'Synthetic result needs new guidance.'}]}]};
const now=Date.now();
const account:AllowanceAssessment={key:'synthetic-account',status:'learning',code:'ACCOUNT_ALLOWANCE_LEARNING',action:'continue',account:{id:'synthetic-observation',status:'available',source:'local-codex',observedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),exhausted:false,windows:[{bucketId:'synthetic-window',slot:'primary',usedPercent:10,remainingPercent:90,windowDurationMins:300,resetsAt:Math.floor(now/1000)+18000}]},trend:{sampleCount:0,comparableCount:0,direction:'unknown',windows:[],attribution:'shared-account-observation',reasons:['NO_SAMPLES']},activeExecutions:0,target:{projectId:project.id,pipelineId:pipeline.id,stageId:'work',roleId:'worker',kind:'stage',effort:'max',model:null}};
const goal:Intake={id:'synthetic-supervision-goal',projectId:project.id,request:run.goal,baseline:run.baseline,status:'failed',createdAt:at,updatedAt:at,routerRunId:'synthetic-supervisor',targetRunIds:[run.id],rounds:[],idempotencyKey:'synthetic-goal-key',policy:{maxRounds:4,maxParallel:2,maxElapsedSeconds:3600,maxTotalTokens:600000,smartRetry:true},executionTime:{usedSeconds:9000,totalElapsedSeconds:9000},canRetry:true,account};

test('authoring and launch expose the work contract without execution quota inputs for old and new definitions',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{PipelineEditor}=await vite.ssrLoadModule('/web/platform/PipelineEditor.tsx'),{LaunchPipeline}=await vite.ssrLoadModule('/web/platform/LaunchPipeline.tsx');
  for(const locale of ['en','zh-CN'])for(const policy of [{},pipeline.policy]){
    const definition={...pipeline,policy};
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof PipelineEditor,props)));
    const editor=render(PipelineEditor,{pipeline:definition,project,pipelines:[definition],runs:[],onBack(){},onChanged:async()=>{}});
    assert.ok(editor.includes('Check the actual result.'));
    assert.ok(editor.includes(locale==='en'?'Dependencies and handoffs':'依赖与交接'));
    assert.ok(editor.includes(locale==='en'?'Require approval after output':'产出后需要批准'));
    assert.ok(!editor.includes('type="number"'));
    assert.ok(!editor.includes(locale==='en'?'Cap for explicit token mode':'显式 token 模式上限'));
    const launch=render(LaunchPipeline,{pipeline:definition,project,onClose(){},onStarted:async()=>{}});
    assert.ok(launch.includes('Prepare evidence'));
    assert.ok(!launch.includes('type="number"'));
    assert.ok(!launch.includes(locale==='en'?'Attempts per scope':'每个范围的尝试上限'));
    assert.ok(!launch.includes('120,000'));
    assert.ok(launch.includes(locale==='en'?'Read and change the execution workspace':'可读取并修改执行工作区'));
  }
});

test('recovery preserves guidance, account decisions and historical diagnostics without quota extensions',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{GoalRetryForm}=await vite.ssrLoadModule('/web/GoalRecovery.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx'),{RunWorkspace}=await vite.ssrLoadModule('/web/platform/RunWorkspace.tsx'),{HistoricalExecutionPolicy}=await vite.ssrLoadModule('/web/platform/ExecutionHistory.tsx');
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof GoalRetryForm,props)));
    const legacy={...goal,canRetry:false,retryBlockedCode:'GOAL_TIME_LIMIT',recoveryRecommendation:{policy:{maxRounds:5,maxElapsedSeconds:7200},basis:{usedTokens:800000,reservedTokens:0,usedSeconds:9000,actionRounds:12,previousPolicy:goal.policy},purpose:'one-focused-continuation'}};
    const retry=render(GoalRetryForm,{intake:legacy,models:[],onRetry:async()=>{},onClose(){}});
    assert.ok(retry.includes('<textarea'));
    assert.ok(!retry.includes('type="number"'));
    assert.ok(!retry.includes('pf-recovery-recommendation'));
    assert.ok(!retry.match(/<button[^>]*type="submit"[^>]*>[^]*?<\/button>/)?.[0].includes('disabled'));
    assert.ok(retry.includes(locale==='en'?'Historical execution quotas':'历史执行配额'));
    assert.ok(retry.includes(locale==='en'?'Current work proceeds without numeric execution quotas.':'当前工作不受固定执行配额限制'));
    const detail={project,pipelines:[pipeline],runs:[run],knowledge:[],proposals:[],events:[],intakes:[goal]};
    const goalView=render(GoalWorkspace,{goal,detail,models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    const stageView=render(RunWorkspace,{run,events:[],onRun(){},onSelect(){},onBack(){},onChanged:async()=>{}});
    assert.ok(goalView.includes('9,000s'));
    assert.ok(stageView.includes('159,000'));
    for(const view of [goalView,stageView]){
      assert.ok(view.includes(locale==='en'?'Do not retry':'不再重试'));
      assert.ok(!view.includes(locale==='en'?'Change execution boundaries':'更改执行边界'));
      assert.ok(!view.includes('NaN'));assert.ok(!view.includes('Infinity'));
    }
    assert.equal(render(HistoricalExecutionPolicy,{policy:{}}),'');
    const history=render(HistoricalExecutionPolicy,{policy:pipeline.policy});
    assert.ok(history.includes('120,000'));assert.ok(!history.includes('<input'));
    const unavailable={...account,key:'synthetic-unavailable',status:'unavailable',code:'ACCOUNT_ALLOWANCE_UNAVAILABLE',action:'owner-step',account:{...account.account,status:'unavailable',windows:[]}};
    const decision=render(GoalRetryForm,{intake:{...goal,account:unavailable,accountAcknowledgementRequired:true},models:[],onRetry:async()=>{},onClose(){}});
    assert.ok(decision.includes(locale==='en'?'Approve this execution':'批准本次执行'));
    const exhausted={...account,status:'exhausted',code:'ACCOUNT_ALLOWANCE_EXHAUSTED',action:'wait',account:{...account.account,exhausted:true,windows:account.account.windows.map(window=>({...window,usedPercent:100,remainingPercent:0}))}};
    const held=render(GoalRetryForm,{intake:{...goal,account:exhausted,canRetry:false,retryBlockedCode:'ACCOUNT_EXHAUSTED'},models:[],onRetry:async()=>{},onClose(){}});
    assert.ok(!held.includes('type="submit"'));
  }
});
