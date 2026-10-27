import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {followUpContext} from '../src/intake-context.ts';
import type {Intake,Project} from '../src/contracts.ts';

const at='2026-01-01T12:00:00.000Z';
const project:Project={id:'synthetic-conversation-project',name:'Synthetic conversation',description:'Independent follow-up UI fixture.',workspace:'/synthetic/conversation',repository:'',revision:1,createdAt:at,updatedAt:at,knowledgeSources:[],roles:[]};
const parent:Intake={id:'synthetic-first-question',projectId:project.id,request:'What should be investigated next?',baseline:'Synthetic evidence.',status:'completed',createdAt:at,updatedAt:at,routerRunId:'synthetic-first-execution',targetRunIds:[],rounds:[],idempotencyKey:'synthetic-first-key',policy:{maxRounds:4,maxParallel:2,maxElapsedSeconds:300,maxTotalTokens:20000},resultKind:'answer',outcome:'Inspect the navigation guide before changing the links.'};

test('conversation snapshots retain bounded source results without policies, logs or hidden execution state',()=>{
  let context=followUpContext(parent);
  for(let index=0;index<8;index++)context=followUpContext({...parent,id:'synthetic-question-'+index,request:'Synthetic request '+index,outcome:'Synthetic response '+index},context);
  assert.equal(context.rootIntakeId,parent.id);assert.equal(context.turns.length,4);assert.equal(context.omittedTurns,5);assert.equal(context.turns.at(-1)?.response,'Synthetic response 7');
  assert.ok(!JSON.stringify(context).includes('maxTotalTokens'));assert.ok(!JSON.stringify(context).includes('recoveryHistory'));
  const large=followUpContext({...parent,request:'"'.repeat(4000),outcome:'"'.repeat(16000)});
  assert.ok(JSON.stringify(large).length<=24000);assert.equal(large.turns[0].truncated,true);assert.equal(large.turns[0].request.length,4000);
  const escaped=followUpContext({...parent,request:String.fromCharCode(1).repeat(4000),outcome:'Synthetic response.'});assert.ok(JSON.stringify(escaped).length<=24000);assert.equal(escaped.turns[0].truncated,true);
  const clarified=followUpContext({...parent,outcome:'Done.',recoveryHistory:[{id:'synthetic-reply',trigger:'manual',status:'completed',at,reason:'Synthetic request.',replyToQuestion:'Which document may change?',note:'Only edit docs/navigation.md.',previousRunId:'synthetic-old',basisRevision:1,previousBasisRevision:1,refreshConfiguration:false}]});assert.deepEqual(clarified.turns[0].clarifications,[{question:'Which document may change?',response:'Only edit docs/navigation.md.'}]);
  const next=followUpContext({...parent,id:'synthetic-next',outcome:'A fresh result.'},large);assert.equal(next.turns.at(-1)?.response,'A fresh result.');assert.equal(large.turns[0].intakeId,parent.id,'The prior frozen context remains unchanged.');
});

test('completed results and clarification expose an inline composer and navigable context without configuration',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{GoalWorkspace}=await vite.ssrLoadModule('/web/platform/GoalWorkspace.tsx'),{RequestComposer}=await vite.ssrLoadModule('/web/platform/RequestComposer.tsx');
  const child={...parent,id:'synthetic-follow-up',request:'Check the guide you identified.',parentIntakeId:parent.id,conversation:followUpContext(parent)};
  const detail={project,pipelines:[],runs:[],knowledge:[],proposals:[],events:[],intakes:[child,parent]};
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof GoalWorkspace,props)));
    const html=render(GoalWorkspace,{goal:parent,detail,models:[],onRun(){},onGoal(){},onBack(){},onChanged:async()=>{}});
    assert.ok(html.includes('pf-request-composer'));assert.ok(html.indexOf('Inspect the navigation guide')<html.indexOf('pf-request-composer'));
    assert.ok(html.includes(locale==='en'?'Continue here':'接着说'));assert.ok(html.includes('maxLength="4000"'));assert.ok(html.includes('Enter Meta+Enter Control+Enter'));assert.ok(html.includes(locale==='en'?'Enter to send · Shift+Enter for a new line':'Enter 发送 · Shift+Enter 换行'));assert.ok(html.includes('aria-describedby="pf-followup-'+parent.id+'-keys"'));assert.ok(!html.includes('type="number"'));
    assert.ok(html.includes('Check the guide you identified.'));
    const linked=render(GoalWorkspace,{goal:child,detail,models:[],onRun(){},onGoal(){},onBack(){},onChanged:async()=>{}});
    assert.ok(linked.includes('pf-conversation-link'));assert.ok(linked.includes('What should be investigated next?'));assert.ok(linked.includes(locale==='en'?'Conversation context':'对话上下文'));
    const reply={...parent,status:'clarification',question:'Which guide is authoritative?',canRetry:true,outcome:undefined,resultKind:undefined};
    const needsReply=render(GoalWorkspace,{goal:reply,detail:{...detail,intakes:[reply]},models:[],onRun(){},onGoal(){},onBack(){},onChanged:async()=>{}});
    assert.ok(needsReply.includes(locale==='en'?'Send reply':'发送回复'));assert.ok(needsReply.includes('maxLength="2000"'));assert.ok(!needsReply.includes(locale==='en'?'No action was dispatched.':'本次没有派发任务。'));
    const pending=render(GoalWorkspace,{goal:{...reply,canRetry:false,continuationPending:true,retryBlockedReason:'SYNTHETIC_DUPLICATE_PENDING_WARNING'},detail,models:[],onRun(){},onGoal(){},onBack(){},onChanged:async()=>{}});assert.ok(pending.includes('pf-request-composer'));assert.ok(pending.includes(locale==='en'?'Cancel this continuation':'取消本次继续'));assert.ok(pending.includes('disabled=""'));assert.ok(!pending.includes('SYNTHETIC_DUPLICATE_PENDING_WARNING'));
    const independent=render(RequestComposer,{project,onCreated(){},onChanged:async()=>{}});assert.ok(independent.includes('id="pf-new-outcome"'));assert.ok(!independent.includes(locale==='en'?'Ask a related question':'继续提问'));
  }
});
