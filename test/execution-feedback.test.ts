import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {AuditEvent,Intake,Project,Pipeline,Run} from '../src/contracts.ts';
import {currentAttemptEvents,executionFeedback,executionSignal} from '../web/platform/executionFeedback.ts';

const at='2026-01-01T12:00:00.000Z',start=Date.parse(at);
const project:Project={id:'synthetic-activity-project',revision:1,name:'Synthetic activity project',description:'Independent execution feedback fixture.',workspace:'/synthetic/activity-project',repository:'',roles:[{id:'lead',name:'Synthetic lead',description:'Coordinate bounded work.',instructions:'Inspect synthetic evidence.',model:'synthetic-model',effort:'max',sandbox:'read-only',skills:[],tools:[]}],knowledgeSources:[],createdAt:at,updatedAt:at};
const pipeline:Pipeline={id:'synthetic-activity-flow',projectId:project.id,revision:1,name:'Synthetic observation',description:'Inspect bounded evidence.',roleId:'lead',stages:[{id:'inspect',name:'Inspect source',roleId:'lead',executor:'codex',dependsOn:[],prompt:'Inspect synthetic evidence.',review:false}],policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:10000},updatedAt:at};
const run:Run={id:'synthetic-activity-run',projectId:project.id,pipelineId:pipeline.id,goal:'Explain the synthetic project state.',baseline:'Synthetic baseline.',trigger:{kind:'human',actor:'Synthetic owner'},status:'running',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-activity-key',inputHash:'synthetic-hash',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'inspect',status:'running',attempts:[{id:'synthetic-current-attempt',number:2,iteration:1,status:'running',startedAt:at,ref:{threadId:'synthetic-current-thread',turnId:'synthetic-current-turn'}}]}]};
const event=(seq:number,type:string,data:unknown={},message='Synthetic activity',seconds=seq):AuditEvent=>({seq,at:new Date(start+seconds*1000).toISOString(),projectId:project.id,runId:run.id,stageId:'inspect',type,actor:'synthetic-runner',message,data:{attemptId:'synthetic-current-attempt',...(data as Record<string,unknown>)}});

test('execution feedback classifies public operations without exposing reasoning or transport text',()=>{
  const command=event(1,'codex.item/started',{attemptId:'synthetic-current-attempt',itemType:'commandExecution'},'node --test synthetic.test.ts');
  assert.equal(executionFeedback(run,'inspect',[command],{now:start+2000})?.operation,'command');
  for(const hidden of [event(2,'item/reasoning/summaryTextDelta',{},'SYNTHETIC_HIDDEN_REASONING'),event(3,'item/agentMessage/delta',{},'{"action":'),event(4,'codex.multica.message',{type:'unknown'},'SYNTHETIC_UNCLASSIFIED_TEXT')])assert.equal(executionSignal(hidden),undefined);
  assert.equal(executionSignal(event(10,'codex.multica.message',{type:'text'},'{transport fragment'))?.operation,'output');
  assert.equal(executionSignal(event(10,'codex.multica.message',{type:'text'},'{transport fragment'))?.text,undefined);
  assert.equal(executionSignal(event(5,'item/completed',{detail:{itemType:'agentMessage',phase:'commentary'}},'Checking the synthetic navigation.'))?.text,'Checking the synthetic navigation.');
  assert.equal(executionSignal(event(6,'item/completed',{itemType:'agentMessage'},'SYNTHETIC_UNCLASSIFIED_MESSAGE')),undefined);
  assert.equal(executionSignal(event(7,'item/completed',{itemType:'agentMessage',phase:'commentary'},'{"response":"structured result"}')),undefined);
  assert.equal(executionSignal(event(8,'multica.status',{},'Agent execution: running'))?.operation,'providerWait','Displayed English is not a state identifier.');
  assert.equal(executionSignal(event(9,'multica.status',{detail:{status:'queued'}}))?.operation,'queued');
});

test('only the current attempt controls feedback; quiet is distinct from observation failure',()=>{
  const current=event(1,'item/started',{attemptId:'synthetic-current-attempt',itemType:'commandExecution'},'synthetic current command');
  const old=event(2,'item/completed',{attemptId:'synthetic-old-attempt',itemType:'commandExecution'},'SYNTHETIC_OLD_COMMAND');
  const foreign={...current,seq:3,runId:'synthetic-other-run'};
  const staleRef={...event(4,'item/completed',{},'SYNTHETIC_OLD_REFERENCE'),data:{ref:{threadId:'synthetic-old-thread'},detail:{itemType:'commandExecution'}}};
  const unscopedLegacy={...current,seq:5,data:{itemType:'commandExecution'}};
  assert.deepEqual(currentAttemptEvents(run,'inspect',run.stages[0].attempts[0],[current,old,foreign,staleRef,unscopedLegacy]).map(item=>item.seq),[1]);
  const active=executionFeedback(run,'inspect',[current],{now:start+2000,observedAt:start+2000})!;assert.equal(active.moving,true);
  const quiet=executionFeedback(run,'inspect',[current,event(8,'thread/tokenUsage/updated',{},'Repeated usage',40)],{now:start+45000,observedAt:start+45000})!;
  assert.equal(quiet.quiet,true);assert.equal(quiet.observationGap,false);assert.equal(quiet.moving,false);assert.equal(quiet.activitySeconds,44);
  const gap=executionFeedback(run,'inspect',[current],{now:start+2000,observationFailed:true})!;assert.equal(gap.observationGap,true);assert.equal(gap.quiet,false);assert.equal(gap.moving,false);
  assert.equal(executionFeedback(run,'inspect',[current],{now:start+20000,observedAt:start})?.observationGap,true);
});

test('waits, holds, cancellation and terminal handoff never imply active model output',()=>{
  const copy=()=>structuredClone(run),now=start+5000;
  for(const status of ['queued','waiting','review','paused'] as const){const value=copy();value.stages[0].status=status;assert.equal(executionFeedback(value,'inspect',[],{now})?.moving,false);}
  const unstarted=copy();unstarted.stages[0].status='queued';unstarted.stages[0].attempts=[];
  assert.equal(executionFeedback(unstarted,'inspect',[],{now})?.elapsedSeconds,undefined);assert.equal(executionFeedback(unstarted,'inspect',[],{now})?.lastActivityAt,undefined);
  const ci=copy();ci.snapshot.pipeline.stages[0].executor='github';assert.equal(executionFeedback(ci,'inspect',[],{now})?.operation,'ci');
  const human=copy();human.snapshot.pipeline.stages[0].executor='manual';human.stages[0].status='waiting';assert.equal(executionFeedback(human,'inspect',[],{now})?.operation,'human');
  const hold=copy();hold.stages[0].allowanceHold={code:'ACCOUNT_STEP_APPROVAL_REQUIRED'};assert.equal(executionFeedback(hold,'inspect',[],{now})?.operation,'approval');
  const stop=copy();stop.cancelRequested=true;assert.equal(executionFeedback(stop,'inspect',[],{now})?.operation,'stopping');assert.equal(executionFeedback(stop,'inspect',[],{now})?.moving,false);
  const done=copy();done.status=done.stages[0].status='completed';assert.equal(executionFeedback(done,'inspect',[],{now}),null);assert.equal(executionFeedback(done,'inspect',[],{now,settling:true})?.operation,'received');
  const failed=copy();failed.status=failed.stages[0].status='failed';assert.equal(executionFeedback(failed,'inspect',[],{now,settling:true}),null);
  assert.equal(executionFeedback(run,'inspect',[],{now})?.moving,false,'A returned execution reference is not evidence of active output.');
  for(const status of ['cancelled','failed','unrecognized'])assert.equal(executionFeedback(run,'inspect',[event(1,'multica.status',{status:'running'}),event(2,'multica.status',{status})],{now})?.moving,false);
  const queued=event(1,'multica.status',{detail:{status:'queued'}});assert.equal(executionFeedback(run,'inspect',[queued],{now})?.moving,false);
  const waiting=event(1,'thread/status/changed',{activeFlags:['waitingOnUserInput'],status:'active'});assert.equal(executionFeedback(run,'inspect',[waiting],{now})?.operation,'providerWait');
  const lateResult=event(2,'item/completed',{itemType:'commandExecution'},'Synthetic late result');
  assert.equal(executionFeedback(run,'inspect',[waiting,lateResult],{now})?.operation,'providerWait');
  assert.equal(executionFeedback(run,'inspect',[waiting,lateResult],{now})?.moving,false);
  assert.equal(executionFeedback(run,'inspect',[waiting,lateResult,event(3,'thread/status/changed',{status:'active',activeFlags:[]})],{now})?.moving,true);
});

test('coordinator and selected step expose the same bounded activity instead of duplicate empty panels',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx'),{RunWorkspace}=await vite.ssrLoadModule('/web/platform/RunWorkspace.tsx');
  const goal:Intake={id:'synthetic-activity-goal',projectId:project.id,request:run.goal,baseline:run.baseline,status:'routing',createdAt:at,updatedAt:at,routerRunId:run.id,targetRunIds:[],idempotencyKey:'synthetic-goal-key',rounds:[],policy:{maxRounds:3,maxParallel:1,maxElapsedSeconds:300,maxTotalTokens:20000}};
  const live=structuredClone(run);live.executionKind='agent-goal';live.stages[0].attempts[0].startedAt=new Date(Date.now()-2000).toISOString();
  const command={...event(1,'item/started',{detail:{itemType:'commandExecution'},attemptId:'synthetic-current-attempt'},'node --test synthetic.test.ts'),at:new Date().toISOString()};
  const hidden={...command,seq:2,type:'item/reasoning/summaryTextDelta',message:'SYNTHETIC_HIDDEN_REASONING'};
  const detail={project,pipelines:[pipeline],runs:[live],knowledge:[],proposals:[],events:[command,hidden],intakes:[goal]};
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof GoalWorkspace,props)));
    const html=render(GoalWorkspace,{goal,detail,models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(html.includes(locale==='en'?'Running a command':'正在运行命令'));assert.ok(html.includes('is-moving'));assert.ok(!html.includes('pf-goal-decision'));assert.ok(!html.includes(locale==='en'?'Establishing the scope':'正在确定工作范围'));
    assert.ok(!html.includes('SYNTHETIC_HIDDEN_REASONING'));assert.ok(html.includes('<h3 aria-live="polite" aria-atomic="true">'));assert.ok(!/<h3 aria-live="polite"[^>]*>[^<]*(?:ago|秒前)/.test(html));
    const step=render(RunWorkspace,{run:{...live,executionKind:undefined},events:[command,hidden],onSelect(){},onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(step.includes('pf-execution-activity'));assert.ok(step.includes('node --test synthetic.test.ts'));
    const delegated=structuredClone(live);delete delegated.executionKind;delegated.snapshot.pipeline.stages.push({...pipeline.stages[0],id:'next',name:'Synthetic pending next step',dependsOn:['inspect']});delegated.stages[0].status='completed';delegated.stages.push({stageId:'next',status:'queued',attempts:[]});
    const afterFirst=render(GoalWorkspace,{goal:{...goal,status:'dispatched',targetRunIds:[delegated.id]},detail:{...detail,runs:[delegated]},models:[],onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(afterFirst.includes('Synthetic pending next step'));assert.ok(afterFirst.includes('pf-execution-activity'));assert.ok(!afterFirst.includes('pf-execution-times'));
    const received=render(GoalWorkspace,{goal,detail:{...detail,runs:[]},models:[],onRun(){},onBack(){},onChanged:async()=>{}});assert.ok(received.includes(locale==='en'?'Task received':'任务已接收'));assert.ok(received.includes('<h3 aria-live="polite" aria-atomic="true">'));assert.ok(!received.includes('<span role="status">'));
    const unavailable=render(GoalWorkspace,{goal,detail,models:[],observationFailed:true,onRun(){},onBack(){},onChanged:async()=>{}});
    assert.ok(!unavailable.includes('pf-execution-activity is-moving'));assert.ok(unavailable.includes(locale==='en'?'Execution state needs an update':'暂时无法确认最新执行状态'));
  }
});

test('a changed allowance observation is not presented as an approval request',()=>{
  const now=start+5000,held=structuredClone(run);held.stages[0].status='waiting';
  for(const [code,operation]of [['ACCOUNT_ALLOWANCE_CHANGED','accountCheck'],['ACCOUNT_STEP_APPROVAL_REQUIRED','approval'],['ACCOUNT_EXHAUSTED','accountWait']] as const){
    held.stages[0].allowanceHold={code};
    assert.equal(executionFeedback(held,'inspect',[],{now})?.operation,operation);
    assert.equal(executionFeedback(held,'inspect',[],{now})?.moving,false);
  }
});
