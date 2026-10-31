import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('shared file rows escape private content, expose localized recovery and keep distinct same-name actions',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{AttachmentControls,SubmittedAttachments,goalInstructionScope}=await vite.ssrLoadModule('/web/platform/GoalAttachments.tsx');
  const first={id:'synthetic-first',projectId:'synthetic-project',name:'<script>文件.txt',size:5,mediaType:'text/plain',sha256:'a'.repeat(64),preview:{kind:'text',excerpt:'<img src="https://private.invalid/reference" onerror="unsafe()">',truncated:false}},second={...first,id:'synthetic-second',sha256:'b'.repeat(64)};
  const draft={value:{items:[{key:'first',name:first.name,size:5,ordinal:1,state:'ready',attachment:first},{key:'second',name:second.name,size:5,ordinal:2,state:'interrupted',attachment:second}],nextOrdinal:3,storageFailed:true},ids:[first.id],blocked:true,over:false,add:async()=>{},remove:()=>{},retry:async()=>{},hasBytes:()=>false,clear:()=>false};
  for(const locale of ['en','zh-CN']){
    const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(component as typeof AttachmentControls,props)));
    const html=render(AttachmentControls,{draft});assert.ok(html.includes(locale==='en'?'Attach files':'添加附件'));assert.ok(html.includes(locale==='en'?'Choose file again':'重新选择文件'));assert.ok(html.includes(locale==='en'?'File 1':'文件 1'));assert.ok(html.includes(locale==='en'?'File 2':'文件 2'));assert.ok(html.includes(locale==='en'?'Upload interrupted':'上传已中断'));assert.ok(html.includes('role="status"'));assert.ok(html.includes('&lt;script&gt;文件.txt'));assert.ok(!html.includes('<script>文件'));assert.ok(!html.includes('<img src="https://private.invalid'));assert.ok(html.includes('&lt;img src='));assert.ok(html.indexOf('pf-attachment-list')<html.indexOf('pf-attachment-add'));
    const history=render(SubmittedAttachments,{items:[first]});assert.ok(history.includes('/api/projects/synthetic-project/attachments/synthetic-first/content'));assert.ok(!history.includes('data-attachment-remove'));assert.ok(!history.includes('<img src="https://private.invalid'));
  }
  const goal={projectId:'synthetic-project',id:'synthetic-goal',routerRunId:'synthetic-router',controlRevision:0,recoveryKey:'synthetic-basis'};
  assert.notEqual(goalInstructionScope(goal),goalInstructionScope({...goal,recoveryKey:'different-basis'}));assert.notEqual(goalInstructionScope(goal),goalInstructionScope({...goal,projectId:'other-project'}));
});
