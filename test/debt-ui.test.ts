import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Pipeline,Project,ProjectDetail,ProjectReadiness} from '../src/contracts.ts';

const project:Project={
  id:'synthetic-debt-project',name:'Synthetic ownership project',description:'Independently authored module-ownership fixture.',workspace:'/synthetic/project',repository:'',revision:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',
  roles:[{id:'qa',name:'Synthetic reviewer',description:'Review synthetic evidence.',instructions:'Inspect only supplied test material.',model:'synthetic-model',effort:'max',sandbox:'read-only',skills:[],tools:['context.read']}],
  knowledgeSources:[{id:'shared-source',kind:'document',path:'/synthetic/project/docs/shared.md',roles:[]}],
};

test('module ownership and first-work feedback remain coherent in both locales',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  t.after(()=>vite.close());
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const {ConfigurationView}=await vite.ssrLoadModule('/web/ConfigurationView.tsx');
  const {KnowledgeView}=await vite.ssrLoadModule('/web/KnowledgeView.tsx');
  const {KnowledgeSourceEditor}=await vite.ssrLoadModule('/web/KnowledgeSourceEditor.tsx');
  const {ProjectReadinessNotice}=await vite.ssrLoadModule('/web/platform/ProjectReadiness.tsx');
  const {LaunchPipeline}=await vite.ssrLoadModule('/web/platform/LaunchPipeline.tsx');
  const render=(locale:string,element:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},element));

  await t.test('Settings offers binding edits and links to each responsible manager',()=>{
    for(const locale of ['en','zh-CN']){
      const html=render(locale,createElement(ConfigurationView,{project,onChanged:async()=>{},onTeam:()=>{},onKnowledge:()=>{}}));
      assert.equal((html.match(/<input\b/g)??[]).length,3);
      assert.equal((html.match(/<textarea\b/g)??[]).length,1);
      assert.equal(html.includes('<select'),false,'Settings must not retain another role/model/source editor.');
      assert.ok(html.includes(locale==='en'?'Manage team':'管理团队'));
      assert.ok(html.includes(locale==='en'?'Manage knowledge':'管理知识'));
      assert.ok(html.includes('Synthetic reviewer'));assert.ok(html.includes('Max'));
      assert.equal(html.includes(project.knowledgeSources[0].path),false);
    }
  });

  await t.test('a project-wide source stays manageable while a specific role is selected',()=>{
    const detail:ProjectDetail={project,knowledge:[],pipelines:[],runs:[],intakes:[],proposals:[],events:[]};
    for(const locale of ['en','zh-CN']){
      const html=render(locale,createElement(KnowledgeView,{detail,route:{projectId:project.id,surface:'knowledge',role:'qa'},navigate:()=>{},onChanged:async()=>{}}));
      assert.ok(html.includes(project.knowledgeSources[0].path),'An all-role source must remain visible to its applicable role.');
      assert.ok(html.includes(locale==='en'?'Edit source':'编辑来源'));
      assert.ok(html.includes(locale==='en'?'Remove registration':'移除登记'));
    }
  });

  await t.test('readiness shows actionable gaps and stays silent for valid no-source projects',()=>{
    const ready:ProjectReadiness={projectId:project.id,projectRevision:1,observedAt:'2026-01-01T00:00:00Z',workspace:{status:'ready',code:'READY',sourceCommit:'synthetic-commit'},knowledge:{status:'not_configured',configuredSources:0,indexedSources:0,currentEntries:0,missingEntries:0,errorEntries:0}};
    const blocked:ProjectReadiness={...ready,workspace:{status:'blocked',code:'GIT_COMMIT_REQUIRED'},knowledge:{...ready.knowledge,status:'not_indexed',configuredSources:1}};
    for(const locale of ['en','zh-CN']){
      const common={error:null,loading:false,refresh:async()=>{},onSettings:()=>{},onKnowledge:()=>{}};
      assert.equal(render(locale,createElement(ProjectReadinessNotice,{...common,readiness:ready})), '');
      const html=render(locale,createElement(ProjectReadinessNotice,{...common,readiness:blocked}));
      assert.ok(html.includes(locale==='en'?'Check again':'重新检查'));
      assert.ok(html.includes(locale==='en'?'Project bindings':'项目绑定'));
      assert.ok(html.includes(locale==='en'?'Manage knowledge':'管理知识'));
      assert.equal(html.includes('<input'),false,'Readiness must not become another setup form.');
    }
  });

  await t.test('knowledge status distinguishes unverified local content, initial sync, changed settings and actual issues',()=>{
    const ready:ProjectReadiness={projectId:project.id,projectRevision:1,observedAt:'2026-01-01T00:00:00Z',workspace:{status:'ready',code:'READY'},knowledge:{status:'not_indexed',configuredSources:12,indexedSources:0,currentEntries:1,missingEntries:0,errorEntries:0}};
    for(const locale of ['en','zh-CN']){
      const props={error:null,loading:false,refresh:async()=>{},onKnowledge:()=>{}};
      const existing=render(locale,createElement(ProjectReadinessNotice,{...props,readiness:ready}));
      assert.ok(existing.includes('notice info'));
      assert.ok(existing.includes(locale==='en'?'Sources with unconfirmed sync status: 12.':'有 12 个来源的同步状态尚未确认'));
      assert.ok(existing.includes(locale==='en'?'Synchronize sources':'同步来源'));
      assert.ok(!existing.includes(locale==='en'?'Check again':'重新检查'));
      const fresh=render(locale,createElement(ProjectReadinessNotice,{...props,readiness:{...ready,knowledge:{...ready.knowledge,currentEntries:0}}}));
      assert.ok(fresh.includes(locale==='en'?'Unsynchronized sources: 12.':'还有 12 个登记来源未同步'));
      const changed=render(locale,createElement(ProjectReadinessNotice,{...props,readiness:{...ready,knowledge:{...ready.knowledge,indexedSources:11,lastSyncedAt:'2026-01-01T00:00:00Z'}}}));
      assert.ok(changed.includes(locale==='en'?'Sources needing synchronization again: 1.':'有 1 个来源的设置已变更'));
      const issues=render(locale,createElement(ProjectReadinessNotice,{...props,readiness:{...ready,knowledge:{...ready.knowledge,status:'issues',missingEntries:2,errorEntries:1}}}));
      assert.ok(issues.includes('notice warning'));
      assert.ok(issues.includes(locale==='en'?'Missing entries: 2; indexing errors: 1.':'有 2 条资料缺失、1 条索引异常'));
      const unavailable=render(locale,createElement(ProjectReadinessNotice,{...props,readiness:null,error:new Error('Controlled unavailable observation')}));
      assert.ok(unavailable.includes(locale==='en'?'Could not check the project status.':'无法检查项目状态'));
      assert.ok(unavailable.includes(locale==='en'?'Check again':'重新检查'));
      assert.ok(!unavailable.includes(locale==='en'?'Synchronize sources':'同步来源'));
    }
  });

  await t.test('an existing Markdown section remains inspectable when editing a document source',()=>{
    const source={...project.knowledgeSources[0],section:'Selected synthetic section'};
    const withSection={...project,knowledgeSources:[source]};
    for(const locale of ['en','zh-CN']){
      const html=render(locale,createElement(KnowledgeSourceEditor,{project:withSection,source,scopedRole:'',onClose:()=>{},onChanged:async()=>{}}));
      assert.ok(html.includes('value="Selected synthetic section"'),'The saved indexing boundary must stay visible in the source editor.');
    }
  });

  await t.test('known human-only launch does not inherit model-source or account gates',()=>{
    const flow:Pipeline={id:'synthetic-manual-flow',projectId:project.id,revision:1,name:'Synthetic human flow',description:'Record synthetic review evidence.',roleId:'qa',updatedAt:project.updatedAt,policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:20000},stages:[{id:'human-review',name:'Record review',roleId:'qa',executor:'manual',dependsOn:[],prompt:'Inspect synthetic evidence.',review:false}]};
    for(const locale of ['en','zh-CN']){
      const html=render(locale,createElement(LaunchPipeline,{pipeline:flow,project,onClose:()=>{},onStarted:async()=>{}}));
      assert.ok(html.includes(locale==='en'?'Human workflow':'人工流程'));
      assert.equal(html.includes(locale==='en'?'Checking project source':'正在检查项目源码'),false);
      assert.equal(html.includes('pf-account-allowance'),false);
    }
  });
});
