import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {Project,RoleProfile} from '../src/contracts.ts';
import type {RoleCopyReceipt} from '../web/platform/TeamWorkspace.tsx';

test('a confirmed role copy recovers through observation without creating another copy',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{duplicateRoleWithReceipt,roleCopyObserved,RoleCopyNotice,TeamWorkspace}=await vite.ssrLoadModule('/web/platform/TeamWorkspace.tsx');
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const source:RoleProfile={id:'synthetic-original',name:'Synthetic reviewer',description:'Check synthetic evidence.',instructions:'Retain the existing boundary.',model:null,effort:'max',sandbox:'read-only',tools:['context.read'],skills:[]};
  const copy:RoleProfile={...source,id:'synthetic-copy',name:'Synthetic reviewer copy'};
  const saved:Project={id:'synthetic-project',revision:8,name:'Synthetic project',description:'Independent copy receipt fixture.',workspace:'/synthetic/workspace',repository:'synthetic/repository',roles:[source,copy],knowledgeSources:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:01:00Z'};
  const basis={projectId:saved.id,sourceRoleId:source.id,revision:7,roleIds:[source.id]};
  const render=(element:ReturnType<typeof createElement>,locale='en')=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},element));

  await t.test('POST is confirmed before a delayed refresh and a 503 leaves a refresh-only retry',async()=>{
    let finishPost!:(value:Project)=>void,failRead!:(error:Error)=>void;
    const confirmations:RoleCopyReceipt[]=[];
    let writes=0,reads=0;
    const post=()=>{writes++;return new Promise<Project>(resolve=>{finishPost=resolve});};
    const pending=duplicateRoleWithReceipt({basis,create:post,onConfirmed:(value:RoleCopyReceipt)=>{confirmations.push(value)},refresh:()=>{reads++;assert.ok(confirmations.length,'The POST receipt must be visible before any dependent GET.');return new Promise<void>((_resolve,reject)=>{failRead=reject})}});
    assert.equal(writes,1);assert.equal(reads,0);assert.equal(confirmations.length,0);
    finishPost(saved);await Promise.resolve();
    const receipt=confirmations[0];assert.ok(receipt);
    assert.equal(reads,1);assert.equal(receipt.role?.id,copy.id);assert.equal(receipt.revision,8);assert.equal(receipt.sourceRoleId,source.id);
    const failure=new Error('Synthetic GET 503 after POST 201');failRead(failure);
    const result=await pending;assert.equal(result.receipt,receipt);assert.equal(result.refreshError,failure);
    assert.equal(roleCopyObserved(receipt,{revision:7,roles:[source]}),false);

    for(const observation of [{revision:7,roles:[source]},{revision:8,roles:[source,copy]}]){
      const refreshed:{receipt:RoleCopyReceipt;refreshError?:unknown}=await duplicateRoleWithReceipt({basis,receipt,create:()=>{writes++;assert.fail('A confirmed copy may only be refreshed.');},onConfirmed:()=>assert.fail('The original receipt identity must be retained.'),refresh:async()=>{reads++}});
      assert.equal(refreshed.receipt,receipt);assert.equal(refreshed.refreshError,undefined);
      assert.equal(roleCopyObserved(receipt,observation),observation.revision===8);
    }
    assert.equal(writes,1);assert.equal(reads,3);
  });

  await t.test('only a successful matching identity and sufficient revision acknowledge the copy',()=>{
    const receipt:RoleCopyReceipt={projectId:saved.id,sourceRoleId:source.id,revision:8,role:copy};
    assert.equal(roleCopyObserved(receipt,null),false);
    assert.equal(roleCopyObserved(receipt,{revision:7,roles:[source,copy]}),false);
    assert.equal(roleCopyObserved(receipt,{revision:8,roles:[source]}),false);
    assert.equal(roleCopyObserved(receipt,{revision:8,roles:[source,copy]},new Error('Synthetic failed read')),false);
    assert.equal(roleCopyObserved(receipt,{revision:9,roles:[source,copy]}),true);
    assert.equal(roleCopyObserved(receipt,{revision:7,roles:[source]}),false,'A late old observation cannot clear the receipt watermark.');
  });

  await t.test('both locales acknowledge the copy and expose only refresh while the saved team is unavailable',()=>{
    const receipt:RoleCopyReceipt={projectId:saved.id,sourceRoleId:source.id,revision:8,role:copy};
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(RoleCopyNotice,{receipt,error:new Error('Synthetic GET 503'),busy:false,onRefresh(){}}),locale);
      assert.ok(html.includes(locale==='en'?'Role copied: Synthetic reviewer copy.':'已复制角色：Synthetic reviewer copy。'));
      assert.ok(html.includes(locale==='en'?'Could not load the saved team':'暂时无法读取已保存的团队'));
      assert.ok(html.includes(copy.id));assert.ok(html.includes(locale==='en'?'Project revision 8':'项目版本 8'));
      assert.equal((html.match(/<button/g)??[]).length,1);assert.ok(!/<button[^>]*>(Duplicate role|复制角色)<\/button>/.test(html));
    }
    const team={roles:[source],agents:[],skills:[],runtimes:[],revision:7,connection:{connected:true}};
    for(const error of [null,new Error('Synthetic failed team read')]){
      const html=render(createElement(TeamWorkspace,{project:saved,team,error,models:[],runs:[],onRefresh:async()=>{},onRun(){}}));
      assert.match(html,/<button[^>]*disabled=""[^>]*>Duplicate role<\/button>/);
    }
  });

  await t.test('a rejected POST has no confirmed identity and does not trigger a dependent read',async()=>{
    await assert.rejects(duplicateRoleWithReceipt({basis,create:async()=>{throw new Error('Synthetic role validation failure')},onConfirmed:()=>assert.fail('A rejected copy has no receipt.'),refresh:async()=>assert.fail('Do not refresh an unconfirmed write.')}),/Synthetic role validation failure/);
  });
});
