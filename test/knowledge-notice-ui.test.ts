import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {KnowledgeReceiptNoticeValue} from '../web/KnowledgeView';

test('confirmed knowledge notices follow the current locale without replacing the receipt',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  t.after(()=>vite.close());
  const {KnowledgeReceiptNotice}=await vite.ssrLoadModule('/web/KnowledgeView.tsx');
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const render=(notice:KnowledgeReceiptNoticeValue,locale:string)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(KnowledgeReceiptNotice,{notice})));
  const archived:KnowledgeReceiptNoticeValue={key:'lessonArchived',params:{title:'Synthetic archived evidence'}};
  const restored:KnowledgeReceiptNoticeValue={key:'lessonRestored',params:{title:'Different restored evidence'}};

  assert.match(render(archived,'en'),/Archived lesson: Synthetic archived evidence/);
  const chinese=render(archived,'zh-CN');
  assert.match(chinese,/已归档经验：Synthetic archived evidence/);
  assert.ok(!chinese.includes('Archived lesson'));
  assert.match(render(restored,'zh-CN'),/已恢复经验：Different restored evidence/);
  assert.match(render(restored,'en'),/Restored lesson: Different restored evidence/);
  assert.match(render(archived,'en'),/Archived lesson: Synthetic archived evidence/);
  assert.deepEqual(archived,{key:'lessonArchived',params:{title:'Synthetic archived evidence'}});

  for(const [key,english,chineseText] of [
    ['sourceRegistered','Source registered.','已登记来源。'],
    ['sourceUpdated','Source updated.','来源已更新。'],
    ['sourceRemoved','Source registration removed.','已移除来源登记。'],
    ['lessonSaved','Lesson retained in project knowledge.','已保存到项目知识。'],
  ] as const){
    const receipt:KnowledgeReceiptNoticeValue={key};
    assert.ok(render(receipt,'en').includes(english));
    assert.ok(render(receipt,'zh-CN').includes(chineseText));
  }
});
