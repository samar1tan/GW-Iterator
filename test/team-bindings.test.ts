import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {PlatformRole} from '../web/platform/types.ts';

test('role template bindings preserve inheritance, explicit selections and unknown observations',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{readRoleTemplateBindings,effectiveRoleBindingIds,editRoleBinding,RoleBindingChoices}=await vite.ssrLoadModule('/web/platform/TeamWorkspace.tsx');
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const role:PlatformRole={id:'synthetic-role',name:'Synthetic reviewer',description:'Inspect independent evidence.',instructions:'Retain existing boundaries.',model:'synthetic-model',effort:'max',sandbox:'read-only',tools:['context.read','run.read'],skills:[{name:'Synthetic native context',path:'/synthetic/native/SKILL.md'}],multica:{agentId:'synthetic-template'}};
  const source=[{id:'synthetic-skill-a',name:'Synthetic source review'},{id:'synthetic-skill-b',name:'Synthetic evidence check'}],library=[...source,{id:'synthetic-skill-c',name:'Synthetic extra check'}];
  const observation={agentId:role.multica!.agentId,items:source};
  const render=(kind:string,value:PlatformRole,observed:unknown,choices=library,locale='en')=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(RoleBindingChoices,{role:value,kind,library:choices,observation:observed,onToggle(){},onRefresh(){}})));

  await t.test('observed inherited selections are visible, and the first edit starts from all of them',()=>{
    for(const locale of ['en','zh-CN']){
      const html=render('skillIds',role,observation,library,locale);
      assert.equal((html.match(/checked=""/g)??[]).length,2);assert.ok(html.includes(locale==='en'?'Inherited from template':'继承模板绑定'));
    }
    const added=editRoleBinding(role,'skillIds','synthetic-skill-c',true,observation);
    assert.deepEqual(added.multica.skillIds,['synthetic-skill-a','synthetic-skill-b','synthetic-skill-c']);
    const removed=editRoleBinding(role,'skillIds','synthetic-skill-a',false,observation);
    assert.deepEqual(removed.multica.skillIds,['synthetic-skill-b']);
    assert.equal(added.multica.mcpServerIds,undefined);assert.deepEqual(added.skills,role.skills);assert.deepEqual(added.tools,role.tools);assert.equal(added.sandbox,'read-only');
  });

  await t.test('reading or saving unrelated fields cannot materialize inherited arrays or replace explicit empty arrays',async()=>{
    const before=JSON.stringify(role),requests:string[]=[];
    const items=await readRoleTemplateBindings('synthetic project/one',role.multica!.agentId,'skillIds',async(path:string)=>{requests.push(path);return{skills:source};});
    assert.deepEqual(requests,['/api/projects/synthetic%20project%2Fone/team/agents/synthetic-template/skills']);
    assert.deepEqual(effectiveRoleBindingIds(role,'skillIds',{...observation,items}),source.map(item=>item.id));
    const unchanged={...role,description:'An unrelated role description update.'};
    assert.equal(unchanged.multica?.skillIds,undefined);assert.equal(unchanged.multica?.mcpServerIds,undefined);assert.equal(JSON.stringify(role),before);
    const explicit={...role,multica:{...role.multica,skillIds:[],mcpServerIds:[]}};
    assert.deepEqual(effectiveRoleBindingIds(explicit,'skillIds',observation),[]);assert.deepEqual(effectiveRoleBindingIds(explicit,'mcpServerIds',observation),[]);
    assert.equal((render('skillIds',explicit,observation).match(/checked=""/g)??[]).length,0);
    assert.ok(!render('skillIds',explicit,observation).includes('Inherited from template'));
    assert.deepEqual(JSON.parse(JSON.stringify(explicit)).multica.skillIds,[]);
  });

  await t.test('MCP inheritance includes only the template bindings enabled for future materialization',async()=>{
    const servers=await readRoleTemplateBindings('synthetic-project','synthetic-template','mcpServerIds',async()=>({servers:[{id:'synthetic-mcp-a',name:'Synthetic source tool',enabled:true},{id:'synthetic-mcp-disabled',name:'Synthetic disabled tool',enabled:false},{id:'synthetic-mcp-default',name:'Synthetic default tool'}]}));
    assert.deepEqual(servers.map((item:{id:string})=>item.id),['synthetic-mcp-a','synthetic-mcp-default']);
    const edited=editRoleBinding(role,'mcpServerIds','synthetic-mcp-new',true,{agentId:'synthetic-template',items:servers});
    assert.deepEqual(edited.multica.mcpServerIds,['synthetic-mcp-a','synthetic-mcp-default','synthetic-mcp-new']);assert.equal(edited.multica.skillIds,undefined);
    const html=render('mcpServerIds',role,{agentId:'synthetic-template',items:servers},[]);
    assert.equal((html.match(/checked=""/g)??[]).length,2);assert.ok(html.includes('Synthetic source tool'));
  });

  await t.test('failed and mismatched template reads remain unknown and cannot turn a first click into empty replacement',async()=>{
    await assert.rejects(readRoleTemplateBindings('synthetic-project','synthetic-template','skillIds',async()=>{throw new Error('Synthetic read failure');}),/Synthetic read failure/);
    await assert.rejects(readRoleTemplateBindings('synthetic-project','synthetic-template','mcpServerIds',async()=>({})),/valid selection/);
    for(const locale of ['en','zh-CN']){
      const unknown={agentId:'synthetic-template',error:new Error('Synthetic template unavailable')};
      const html=render('skillIds',role,unknown,library,locale);
      assert.ok(html.includes(locale==='en'?'Inheritance is retained.':'已保留继承设置。'));assert.ok(!html.includes('type="checkbox"'));
      assert.ok(!html.includes(locale==='en'?'No skills are bound':'此角色尚未绑定技能'));
      assert.equal(editRoleBinding(role,'skillIds','synthetic-skill-c',true,unknown),role);
    }
    const switched={...role,multica:{agentId:'synthetic-other-template'}};
    assert.equal(effectiveRoleBindingIds(switched,'skillIds',observation),undefined);assert.equal(editRoleBinding(switched,'skillIds','synthetic-skill-c',true,observation),switched);
    const explicit={...switched,multica:{...switched.multica,skillIds:['synthetic-saved-skill']}};
    assert.deepEqual(editRoleBinding(explicit,'skillIds','synthetic-skill-c',true,observation).multica.skillIds,['synthetic-saved-skill','synthetic-skill-c']);
  });
});
