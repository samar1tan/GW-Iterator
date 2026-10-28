import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('shared dialogs leave nested inspector stacking contexts without changing their content contract',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  t.after(()=>vite.close());
  const {Modal,ModalPortal}=await vite.ssrLoadModule('/web/components.tsx');
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const child=createElement('section',{'data-synthetic-reader':true},'Frozen synthetic source');

  await t.test('the portal uses the viewport root, never its sticky reader parent',()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
    const root={nodeType:1},body={nodeType:1},inspector={nodeType:1,parentElement:root};
    try{
      Object.defineProperty(globalThis,'document',{configurable:true,value:{body}});
      const portal=ModalPortal({children:child});
      assert.equal(portal.$$typeof,Symbol.for('react.portal'));
      assert.equal(portal.containerInfo,body);
      assert.notEqual(portal.containerInfo,inspector);
      assert.equal(portal.children.type,'div');
      assert.equal(portal.children.props.className,'pf-platform');
      assert.deepEqual(portal.children.props.style,{display:'contents'},'The theme scope must not add another page-sized layout box.');
      assert.equal(portal.children.props.children,child);
    }finally{
      if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');
    }
  });

  await t.test('SSR retains the named dialog, separate scroll body and fixed footer in both locales',()=>{
    for(const locale of ['en','zh-CN']){
      const html=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(Modal,{title:'Frozen synthetic source',busy:true,onClose:()=>{},footer:createElement('button',null,'Synthetic footer')},child)));
      const titleId=html.match(/aria-labelledby="([^"]+)"/)?.[1];
      assert.ok(titleId);assert.ok(html.includes(`<h2 id="${titleId}">Frozen synthetic source</h2>`));
      assert.match(html,/role="dialog" aria-modal="true" aria-busy="true"/);
      assert.match(html,/<div class="modal-content" inert="">[\s\S]*data-synthetic-reader="true"[\s\S]*<\/div><footer class="modal-footer" inert="">/);
      assert.ok(html.includes(locale==='en'?'Processing…':'正在处理…'));
    }
  });
});
