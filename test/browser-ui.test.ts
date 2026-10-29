import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {RoleProfile} from '../src/contracts.ts';
import {portableRole} from '../src/templates.ts';

test('browser origins are visible in both languages and stay local when a role is reused',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{BrowserAccess,setRoleTool}=await vite.ssrLoadModule('/web/platform/BrowserAccess.tsx'),{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{roleTemplateDraft}=await vite.ssrLoadModule('/web/platform/templateDefinition.ts');
  const role:RoleProfile={id:'synthetic-browser-role',name:'Browser reviewer',description:'Inspect a synthetic local page.',instructions:'Use the hosted tool.',model:null,effort:'low',sandbox:'read-only',skills:[],tools:['browser.use'],browser:{origins:['http://127.0.0.1:45678']}};
  for(const locale of ['en','zh-CN']){
    const render=(value:RoleProfile,editing=false)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(BrowserAccess,{role:value,...(editing?{onChange(){}}:{})})));
    assert.match(render(role),/http:\/\/127.0.0.1:45678/);assert.match(render(role,true),/textarea/);assert.match(render(role,true),new RegExp(locale==='en'?'New runs':'新运行'));
    assert.equal(render({...role,tools:[]}), '');assert.match(render({...role,browser:undefined}),new RegExp(locale==='en'?'Set a local test origin':'请先设置本地测试地址'));
  }
  for(const definition of [portableRole(role),roleTemplateDraft(role)]){assert.deepEqual(definition.requirements.tools,['browser.use']);assert.equal(JSON.stringify(definition).includes('45678'),false);}
  assert.deepEqual(structuredClone(role).browser,role.browser);
  const invalid={...role,browser:{origins:['']}};
  assert.deepEqual(setRoleTool(invalid,'browser.use',false,role.browser).browser,role.browser);
  assert.equal(setRoleTool(invalid,'browser.use',false).browser,undefined);
  assert.equal(setRoleTool(invalid,'browser.use',false,role.browser).tools.includes('browser.use'),false);
});
