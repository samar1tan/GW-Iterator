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

test('attachment summaries focus only their named group without navigation, submission or draft changes',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{AttachmentSummary,AttachmentControls}=await vite.ssrLoadModule('/web/platform/GoalAttachments.tsx');
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');});
  const focused:string[]=[],scrolled:string[]=[],groups=new Map<string,{focus:(options:FocusOptions)=>void;scrollIntoView:(options:ScrollIntoViewOptions)=>void}>();
  groups.set('another-stage-files',{focus:()=>assert.fail('Another recovery must keep its focus.'),scrollIntoView:()=>assert.fail('Another recovery must keep its position.')});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>groups.get(id)??null}});
  for(const locale of ['en','zh-CN'])for(const blocked of [false,true]){
    const controlsId=`resolution:synthetic-${locale}:run:step:${blocked?'interrupted':'ready'}-files`;
    groups.set(controlsId,{focus:options=>{assert.equal(options.preventScroll,true);focused.push(controlsId);},scrollIntoView:options=>{assert.equal(options.block,'start');scrolled.push(controlsId);}});
    const draft={value:{items:[{key:'synthetic-file',name:'Synthetic 文件.txt',size:3,ordinal:1,state:blocked?'interrupted':'ready'}],nextOrdinal:2,storageFailed:false},ids:blocked?[]:['synthetic-upload'],blocked,over:false,hasBytes:()=>false,remove:()=>assert.fail('Inspection cannot remove files.'),add:()=>assert.fail('Inspection cannot add files.'),retry:()=>assert.fail('Inspection cannot retry uploads.'),clear:()=>assert.fail('Inspection cannot clear the draft.')};
    const before=JSON.stringify(draft);let activate:(()=>void)|undefined;
    function SummaryProbe(){const summary=AttachmentSummary({draft,controlsId});activate=summary?.props.onClick;return summary;}
    const render=(child:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},child));
    const html=render(createElement(SummaryProbe));
    assert.match(html,/<button type="button"/,'A local button must not follow a fragment or submit its enclosing form.');
    assert.ok(!html.includes('href='));assert.ok(html.includes(`aria-controls="${controlsId}"`));assert.ok(!html.includes('disabled'));
    assert.ok(html.includes(locale==='en'?(blocked?'Resolve or remove the affected files before starting.':'1 files selected'):(blocked?'请先处理或移除有问题的文件，再开始执行。':'已选 1 个文件')));
    const controls=render(createElement(AttachmentControls,{draft,id:controlsId}));
    assert.ok(controls.includes(`id="${controlsId}" tabindex="-1" role="group"`));assert.ok(controls.includes('aria-label="'+(locale==='en'?'1 files selected':'已选 1 个文件')+'"'));
    assert.ok(activate);activate();assert.equal(focused.at(-1),controlsId);assert.equal(scrolled.at(-1),controlsId);assert.equal(JSON.stringify(draft),before);
    groups.delete(controlsId);const count=focused.length;assert.doesNotThrow(()=>activate!());assert.equal(focused.length,count,'A removed group must not redirect focus to another recovery.');
    assert.equal(render(createElement(AttachmentSummary,{draft:{...draft,value:{...draft.value,items:[]}},controlsId})), '');
  }
  assert.equal(focused.length,4);assert.deepEqual(scrolled,focused);
});
