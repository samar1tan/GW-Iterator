import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Intake,Pipeline,ProjectOverview,Run} from '../src/contracts.ts';
import {workspaceSummary} from '../src/workspace.ts';
import {globalWorkRoute,observeWorkspace,workspaceWithReceipts,unobservedWorkspaceReceipts,nextWorkspaceInteraction,knownWorkspace} from '../web/platform/globalWork.ts';
import {readRoute,writeRoute} from '../web/platform/route.ts';

const at='2026-01-01T00:00:00Z';
function project(id:string):ProjectOverview{return{id,name:'Synthetic '+id,revision:1,workspace:'/synthetic/private-'+id,description:'Synthetic configuration is not a summary payload.',repository:'synthetic/'+id,roles:[],knowledgeSources:[],createdAt:at,updatedAt:at,runCount:0,activeRuns:0,waitingRuns:0,knowledgeCount:0,pipelineCount:1};}
function run(id:string,projectId='one',parentRunId?:string):Run{
  const pipeline:Pipeline={id:'flow-'+id,projectId,name:'Synthetic evidence workflow',description:'Private configuration text.',roleId:'owner',revision:1,updatedAt:at,policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:1000},stages:[{id:'check',name:'Check the prepared result',roleId:'owner',executor:'manual',prompt:'SYNTHETIC_PRIVATE_PROMPT',dependsOn:[],review:false}]};
  return{id,projectId,pipelineId:pipeline.id,goal:'A same-named synthetic task',trigger:{kind:'human',actor:'Synthetic reviewer'},baseline:'SYNTHETIC_PRIVATE_BASELINE',status:'waiting',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:id,inputHash:id,parentRunId,snapshot:{project:project(projectId),pipeline,pipelines:[],knowledge:[]},stages:[{stageId:'check',status:'waiting',attempts:[]}]};
}
function goal(id:string,projectId='one'):Intake{return{id,projectId,request:'A same-named synthetic task',baseline:'SYNTHETIC_PRIVATE_BASELINE',status:'dispatched',createdAt:at,updatedAt:at,routerRunId:'router-'+id,idempotencyKey:id,targetRunIds:['owned-'+id],rounds:[],policy:{maxRounds:2,maxParallel:1,maxTotalTokens:1000,maxElapsedSeconds:300}};}

test('global summary keeps project-qualified roots and nested human decisions without exposing configuration',()=>{
  const first=goal('first'),owned=run('owned-first','one',first.routerRunId),nested=run('nested','one',owned.id),direct=run('direct'),other=run('direct','two');
  const summary=workspaceSummary([project('one'),project('two')],[owned,nested,direct,other],[first],8);
  assert.deepEqual(summary.work.map(item=>[item.projectId,item.kind,item.id]),[['one','run','direct'],['one','goal','first'],['two','run','direct']]);
  assert.equal(summary.decisions.length,4);assert.ok(summary.decisions.some(item=>item.runId==='nested'));
  assert.equal(summary.work.filter(item=>item.id===owned.id||item.id==='nested').length,0);
  const text=JSON.stringify(summary);for(const value of ['SYNTHETIC_PRIVATE_PROMPT','SYNTHETIC_PRIVATE_BASELINE','/synthetic/private-','tokenBudget','knowledgeSources'])assert.equal(text.includes(value),false);
  const scoped=workspaceSummary([project('one')],[owned,nested,direct,other],[first,goal('second','two')],9);
  assert.ok(scoped.work.every(item=>item.projectId==='one'));assert.ok(scoped.decisions.every(item=>item.projectId==='one'));assert.equal(scoped.projects.length,1);
});

test('global summary distinguishes a question, accepted answer, failure and deliberate pause',()=>{
  const question={...goal('question'),status:'clarification' as const,question:'Which source should be checked?'},answer={...goal('answer'),status:'completed' as const,resultKind:'answer' as const},failed={...run('failed'),status:'failed' as const},paused={...run('paused'),status:'paused' as const,stages:[{stageId:'check',status:'paused' as const,attempts:[]}]};
  const summary=workspaceSummary([project('one')],[failed,paused],[question,answer],3);
  assert.equal(summary.decisions.find(item=>item.intakeId===question.id)?.title,question.question);
  assert.equal(summary.work.find(item=>item.id===answer.id)?.resultKind,'answer');assert.equal(summary.work.find(item=>item.id===failed.id)?.attention,true);assert.equal(summary.work.find(item=>item.id===paused.id)?.attention,undefined);
});

test('global routes preserve global level and project scope through encoding and selected stages',()=>{
  const origin={surface:'workbench' as const,role:'',projectFilter:'synthetic one/二'};
  const selected=readRoute(writeRoute(globalWorkRoute(origin,'synthetic two/三','run','same-id','manual choice')));
  assert.equal(selected.projectId,undefined);assert.equal(selected.contextProjectId,'synthetic two/三');assert.equal(selected.projectFilter,origin.projectFilter);assert.equal(selected.runId,'same-id');assert.equal(selected.stageId,'manual choice');
  const reply=readRoute(writeRoute(globalWorkRoute(selected,selected.contextProjectId!,'goal','follow-up')));assert.equal(reply.projectId,undefined);assert.equal(reply.intakeId,'follow-up');assert.equal(reply.runId,undefined);
  const focused=readRoute('#/projects/one/workbench?project=two&filter=three');assert.equal(focused.projectId,'one');assert.equal(focused.contextProjectId,undefined);assert.equal(focused.projectFilter,undefined);
});

test('global stale observations and receipt overlays retain identities without replacing a later Stop',()=>{
  const initial=workspaceSummary([project('one')],[],[],10),created=goal('new'),receipt={kind:'intake' as const,value:created};
  assert.equal(workspaceWithReceipts(initial,[receipt,receipt]).work.length,1);
  assert.equal(workspaceWithReceipts(initial,[{kind:'intake',value:goal('outside','two')}]).work.length,0);
  assert.equal(observeWorkspace(initial,{...initial,sequence:9}),initial);
  const revised={...initial,projects:[{...initial.projects[0],revision:3}]};assert.equal(observeWorkspace(revised,{...initial,sequence:11}),revised);
  const old={...created,status:'clarification' as const},continued={...created,status:'routing' as const,updatedAt:'2026-01-01T00:01:00Z'},continuation={kind:'continued-intake' as const,value:continued,previous:old};
  const oldSummary=workspaceSummary([project('one')],[],[old],11);const overlay=workspaceWithReceipts(oldSummary,[continuation]);assert.equal(overlay.work[0].status,'routing');assert.equal(overlay.decisions.length,0,'An acknowledged reply removes its stale clarification action.');
  const stopped=workspaceSummary([project('one')],[],[{...old,status:'stopped'}],12);assert.equal(workspaceWithReceipts(stopped,[continuation]).work[0].status,'stopped');
});

test('summary acknowledgement is independent of detail acknowledgement and continuation generations',()=>{
  const initial=workspaceSummary([project('one')],[],[],10),created=goal('created'),receipt={kind:'intake' as const,value:created};
  const summaryPending=[receipt];
  const known=knownWorkspace(null,initial.projects,summaryPending)!;assert.equal(known.work.length,1);assert.equal(known.observedAt,'');assert.equal(knownWorkspace(null,initial.projects,[]),null);
  assert.equal(workspaceWithReceipts(initial,summaryPending).work.length,1);
  assert.deepEqual(unobservedWorkspaceReceipts(initial,summaryPending),summaryPending,'A detail response cannot acknowledge a missing summary record.');
  const observed=workspaceSummary([project('one')],[],[created],11);assert.deepEqual(unobservedWorkspaceReceipts(observed,summaryPending),[]);
  const old={...created,status:'clarification' as const},next={...created,routerRunId:'new-router',supervisorRunIds:[created.routerRunId,'new-router']},continued={kind:'continued-intake' as const,value:next,previous:old};
  assert.equal(unobservedWorkspaceReceipts(workspaceSummary([project('one')],[],[old],12),[continued]).length,1);
  assert.equal(unobservedWorkspaceReceipts(workspaceSummary([project('one')],[],[next],13),[continued]).length,0);
  const start={stamp:'global|one',generation:0},away=nextWorkspaceInteraction(start,'global|two'),returned=nextWorkspaceInteraction(away,'global|one');assert.notEqual(returned.generation,start.generation);assert.equal(nextWorkspaceInteraction(returned,'global|one'),returned);
});

test('only wholly waiting roots are reduced from current work, while parallel work retains its root',()=>{
  const owned=run('owned-first','one','router-first'),nested=run('nested','one',owned.id),first=goal('first');
  const waiting=workspaceSummary([project('one')],[owned,nested],[first],1);assert.equal(waiting.work[0].waitingForInput,true);assert.ok(waiting.decisions.every(item=>item.workKind==='goal'&&item.workId===first.id));
  nested.status='running';nested.stages[0].status='running';const parallel=workspaceSummary([project('one')],[owned,nested],[first],2);assert.equal(parallel.work[0].waitingForInput,undefined);assert.equal(parallel.decisions.length,1);
  nested.status='waiting';nested.stages[0].status='waiting';nested.snapshot.pipeline.stages[0].executor='github';const ci=workspaceSummary([project('one')],[owned,nested],[first],3);assert.equal(ci.work[0].waitingForInput,undefined,'An automatic CI wait remains current alongside the human handoff.');
});

test('global request and goal surfaces render bilingual project identity and preserve global result links',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{GlobalWorkbench}=await vite.ssrLoadModule('/web/platform/GlobalWorkbench.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx');
  for(const locale of ['en','zh-CN']){
    const render=(component:any,props:any)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component,props)));
    const markup=render(GlobalWorkbench,{projects:[project('one')],models:[],route:{surface:'workbench',role:''},navigate(){},onConnect(){},onManual(){}});
    assert.ok(markup.includes(locale==='en'?'Global workbench':'全局工作台'));assert.ok(markup.includes(locale==='en'?'Work in':'目标项目'));assert.ok(markup.includes('pf-global-request-one'));assert.ok(!markup.includes('type="number"'));
    const answer={...goal('answer'),status:'completed',resultKind:'answer',outcome:'## Finding\n\n[Read finding](#finding)'};
    const result=render(GoalWorkspace,{goal:answer,detail:{project:project('one'),pipelines:[],runs:[],events:[],knowledge:[],proposals:[],intakes:[answer]},models:[],backLabel:'GLOBAL_RETURN',documentHref:'#/projects?project=one&goal=answer',onBack(){},onRun(){},onChanged:async()=>{}});
    assert.ok(result.includes('GLOBAL_RETURN'));assert.ok(result.includes('href="#/projects?project=one&amp;goal=answer"'));assert.ok(!result.includes('href="#/projects/one/workbench'));
  }
});
