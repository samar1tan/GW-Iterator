import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {KnowledgeContextRecord} from '../src/knowledge-context-types.ts';

test('the bilingual source inspector exposes blocked guidance repair in its exact project without claiming retry refreshes the frozen basis',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:{ignored:['**/.local/**','**/.git/**']}},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{ContextPanel,FrozenSourceLocation}=await vite.ssrLoadModule('/web/platform/ContextPanel.tsx');
  const at='2026-01-01T00:00:00Z',record:KnowledgeContextRecord={plan:{id:'synthetic-context',scope:{projectId:'synthetic-context-project',corpusId:'synthetic-corpus',runId:'synthetic-run',stageId:'verify',attemptId:'synthetic-attempt',roleId:'qa'},manifest:{id:'synthetic-corpus',projectId:'synthetic-context-project',projectRevision:1,contentHash:'synthetic-content-hash',origin:'registered-live',governanceBoundary:'captured',captureStartedAt:at,captureCompletedAt:at,documents:[],issues:[]},strategyVersion:'synthetic-selector',tokenizerVersion:'synthetic-tokenizer',indexVersion:'synthetic-index',intentHash:'synthetic-intent',status:'blocked',queryFacets:{task:'Check exact evidence.',stage:'Verify.',upstream:''},guidance:[],evidence:[],gaps:[{code:'GUIDANCE_MISSING',entryIds:['synthetic-missing'],message:'A registered synthetic required source is missing.'}],budget:{limitChars:32000,usedChars:300},omissions:[],context:'{}',createdAt:at},reads:[]};
  for(const locale of ['en','zh-CN']){const html=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(ContextPanel,{runId:'synthetic-run',stageId:'verify',attemptId:'synthetic-attempt',record})));
    assert.ok(html.includes('href="#/projects/synthetic-context-project/knowledge?role=qa"'));assert.ok(html.includes(locale==='en'?'Open Knowledge':'打开知识库'));assert.ok(html.includes(locale==='en'?'explicitly refreshed basis':'显式刷新后的配置基础'));assert.ok(html.includes(locale==='en'?'this attempt keeps its frozen context':'本次尝试保留原冻结上下文'));assert.ok(html.includes(locale==='en'?'Retrieval does not prove':'检索不代表'));assert.ok(!html.includes('href="#/projects/other-project'));
  }
  const requested=Object.freeze({corpusId:'synthetic-corpus',entryId:'synthetic-entry',revision:1,hash:'synthetic-hash',chunkId:'synthetic-selected',headingPath:['Contract'],startLine:116,endLine:116}),returned=Object.freeze({...requested,chunkId:'synthetic-reading-span',endLine:118});
  for(const locale of ['en','zh-CN']){const render=(selected:boolean)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(FrozenSourceLocation,{requested,returned,selected})));assert.ok(render(true).includes(locale==='en'?'Selected L116–116 · Reading L116–118':'已选 L116–116 · 正在阅读 L116–118'));assert.ok(render(false).includes(locale==='en'?'Requested L116–116 · Reading L116–118':'读取位置 L116–116 · 正在阅读 L116–118'));assert.equal(requested.endLine,116,'Reading neighbors must not rewrite the initial selection.');}
});
