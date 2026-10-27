import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Pipeline,Project} from '../src/contracts.ts';
import type {AllowanceAssessment} from '../src/account-allowance-types.ts';

const at='2026-01-01T00:00:00Z',now=Date.parse(at);
const project:Project={id:'synthetic-launch-project',name:'Synthetic launch project',description:'Independently authored launch design fixture.',workspace:'/synthetic/project',repository:'',revision:1,createdAt:at,updatedAt:at,knowledgeSources:[],roles:[{id:'development',name:'Development',description:'Prepare source.',instructions:'Use synthetic scope.',model:'synthetic-model',effort:'max',sandbox:'workspace-write',skills:[],tools:[]},{id:'qa',name:'QA',description:'Check source.',instructions:'Read synthetic evidence.',model:'synthetic-model',effort:'max',sandbox:'read-only',skills:[],tools:[]}]};
const pipeline:Pipeline={id:'synthetic-launch-flow',projectId:project.id,revision:1,name:'Synthetic focused change',description:'Prepare, verify and accept.',roleId:'development',updatedAt:at,policy:{concurrency:1,maxAttempts:3,maxIterations:2,timeoutSeconds:240,tokenBudget:180000},stages:[{id:'prepare',name:'Prepare the change',roleId:'development',executor:'codex',dependsOn:[],prompt:'Prepare the synthetic change.',review:false},{id:'verify',name:'Check independently',roleId:'qa',executor:'codex',dependsOn:['prepare'],prompt:'Check the prepared source.',executionPurpose:'review',reworkTo:'prepare',review:false},{id:'accept',name:'Accept delivery',roleId:'development',executor:'manual',dependsOn:['verify'],prompt:'Inspect evidence.',review:false}]};
const account:AllowanceAssessment={key:'synthetic-launch-reading',status:'learning',code:'ACCOUNT_ALLOWANCE_LEARNING',action:'continue',account:{id:'synthetic-reading',status:'available',source:'local-codex',observedAt:at,expiresAt:new Date(now+60000).toISOString(),exhausted:false,windows:[{bucketId:'synthetic',slot:'primary',windowDurationMins:360,remainingPercent:48,usedPercent:52,resetsAt:Math.floor(now/1000)+3600}]},trend:{sampleCount:0,comparableCount:0,direction:'unknown',windows:[],attribution:'shared-account-observation',reasons:['SHARED_ACCOUNT_ACTIVITY','NO_SAMPLES']},activeExecutions:0,target:{projectId:project.id,pipelineId:pipeline.id,stageId:'prepare',roleId:'development',model:'synthetic-model',effort:'max',kind:'stage'}};

test('launch presents task and true execution structure with a separately associated footer',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const {LaunchPipeline}=await vite.ssrLoadModule('/web/platform/LaunchPipeline.tsx');
  const {Modal}=await vite.ssrLoadModule('/web/components.tsx');
  const {AccountAllowanceView,canRequestAccountStep}=await vite.ssrLoadModule('/web/platform/AccountAllowance.tsx');
  const render=(locale:string,component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof LaunchPipeline,props)));
  for(const locale of ['en','zh-CN']){
    const props={pipeline,project,onClose:()=>{},onStarted:async()=>{}};
    const html=render(locale,LaunchPipeline,props),formId=html.match(/<form id="([^"]+)"/)?.[1];
    assert.ok(formId);const submit=html.match(/<button(?=[^>]*type="submit")[^>]*>/)?.[0];assert.ok(submit?.includes(`form="${formId}"`));
    assert.ok(html.indexOf('</form>')<html.indexOf('<footer'),'Launch actions must remain outside the scrolling form body.');
    assert.ok(html.includes('pf-launch-path is-serial'));assert.ok(html.includes('Accept delivery'));
    const beforeDetails=html.split('<details class="pf-launch-details"')[0];
    assert.equal((beforeDetails.match(/synthetic-model/g)??[]).length,1,'Shared model defaults must be summarized once.');
    assert.ok(!beforeDetails.includes(locale==='en'?'Inherited settings':'继承的设置'));
    assert.ok(!html.includes('180,000'),'Legacy token diagnostics are not a launch decision.');
    const branched={...pipeline,stages:[pipeline.stages[0],{...pipeline.stages[1],dependsOn:[]},{...pipeline.stages[2],dependsOn:['prepare','verify'],condition:{stageId:'verify',outcome:'done'}}]};
    const branch=render(locale,LaunchPipeline,{...props,pipeline:branched});
    assert.ok(!branch.includes('pf-launch-path is-serial'));assert.ok(branch.includes('Prepare the change, Check independently'));
    assert.ok(branch.includes(locale==='en'?'Return on requested revision: Prepare the change':'要求修改时返回: Prepare the change'));
    for(const executor of ['manual','github']){
      const flow={...pipeline,stages:[{...pipeline.stages[0],executor}]};
      const scoped=render(locale,LaunchPipeline,{...props,pipeline:flow});
      assert.ok(!scoped.includes('pf-account-allowance'));assert.ok(!scoped.includes('pf-launch-models'));
    }
    const unknown={...pipeline,stages:[{...pipeline.stages[0],executor:'pipeline',options:{pipelineId:'synthetic-missing-child'}}]};
    assert.ok(render(locale,LaunchPipeline,{...props,pipeline:unknown}).includes('pf-account-allowance'));
    const busy=render(locale,Modal,{title:'Synthetic busy dialog',busy:true,onClose:()=>{},children:createElement('input'),footer:createElement('button',null,'Synthetic submit')});
    assert.match(busy,/<footer[^>]*inert=""/);
    const healthy=render(locale,AccountAllowanceView,{assessment:account,now}),ordinary=healthy.split('<details')[0];
    assert.ok(ordinary.includes('<meter'));assert.ok(ordinary.includes('48%'));assert.ok(!ordinary.includes(locale==='en'?'no samples yet':'尚无执行样本'));
    const expired={...account,account:{...account.account,expiresAt:new Date(now-1).toISOString()}};
    const stale=render(locale,AccountAllowanceView,{assessment:expired,now});
    assert.ok(!stale.includes('<meter'));assert.ok(stale.split('<details')[0].includes(locale==='en'?'observation is stale':'观测已过期'));assert.equal(canRequestAccountStep(expired,now),false);
    const unknownAccount={...account,status:'unavailable',action:'owner-step',account:{...account.account,status:'unavailable',windows:[]}};
    const unavailable=render(locale,AccountAllowanceView,{assessment:unknownAccount,now});
    assert.ok(unavailable.split('<details')[0].includes(locale==='en'?'Approve this execution':'批准'));assert.ok(!unavailable.includes('<details class="pf-account-details" open'));assert.equal(canRequestAccountStep(unknownAccount,now),true);
    const exhausted={...account,status:'exhausted',action:'wait',account:{...account.account,exhausted:true,windows:[{...account.account.windows[0],remainingPercent:0,usedPercent:100}]}};
    const waiting=render(locale,AccountAllowanceView,{assessment:exhausted,now});
    assert.ok(waiting.split('<details')[0].includes(locale==='en'?'limit reached':'已用尽'));assert.equal(canRequestAccountStep(exhausted,now),false);
  }
});
