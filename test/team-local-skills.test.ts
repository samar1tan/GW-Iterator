import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('advanced local role skills retain their native scope and saved selections through discovery',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  t.after(()=>vite.close());
  const {LocalRoleSkillsView,discoverLocalRoleSkills,localSkillChoices}=await vite.ssrLoadModule('/web/platform/LocalRoleSkills.tsx');
  const {I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const selected=[{name:'Synthetic saved skill',path:'/synthetic/project/skills/saved/SKILL.md'}];
  const available={name:'Synthetic available skill',path:'/synthetic/project/skills/available/SKILL.md',description:'Independently authored discovery fixture.'};
  const render=(discovery:unknown,locale='en',loading=false)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(LocalRoleSkillsView,{discovery,selected,loading,onDiscover:()=>{},onChange:()=>{}})));

  await t.test('initial views identify native Codex applicability in both locales without claiming discovery',()=>{
    for(const locale of ['en','zh-CN']){
      const html=render({checked:false,skills:[]},locale);
      assert.ok(html.includes(locale==='en'?'Local Codex skill context':'本地 Codex 技能上下文'));
      assert.ok(html.includes(locale==='en'?"GWI&#x27;s native Codex execution":'GWI 的原生 Codex 执行'));
      assert.ok(html.includes(locale==='en'?'Multica tasks use the separate skill-library bindings':'Multica 任务使用上方独立的技能库绑定'));
      assert.ok(html.includes(selected[0].path));
      assert.equal((html.match(/checked=""/g)??[]).length,1);
      assert.ok(html.includes(locale==='en'?'Local skills have not been checked.':'尚未检查本地技能。'));
      assert.equal(html.includes(locale==='en'?'No local skills were found':'此项目目录未发现本地技能'),false);
    }
  });

  await t.test('failed discovery retains the last file list and saved paths while offering another read',async()=>{
    const previous={checked:true,skills:[available]};
    const failed=await discoverLocalRoleSkills('synthetic project/one',previous,async(request:string)=>{
      assert.equal(request,'/api/projects/synthetic%20project%2Fone/skills');
      throw new Error('Synthetic discovery failed.');
    });
    assert.equal(failed.skills,previous.skills);
    assert.equal(failed.checked,true);
    assert.ok(failed.error);
    assert.deepEqual(localSkillChoices(failed.skills,selected).map((skill:{path:string})=>skill.path),[available.path,selected[0].path]);
    for(const locale of ['en','zh-CN']){
      const html=render(failed,locale),details=html.indexOf('<details>');
      assert.ok(html.includes(available.path));assert.ok(html.includes(selected[0].path));
      assert.equal((html.match(/checked=""/g)??[]).length,1);
      assert.ok(html.includes(locale==='en'?'Existing selections are retained.':'已保留原有选择。'));
      assert.ok(html.indexOf('Synthetic discovery failed.')>details);
      assert.equal(html.slice(0,details).includes('Synthetic discovery failed.'),false);
    }
    assert.deepEqual(selected,[{name:'Synthetic saved skill',path:'/synthetic/project/skills/saved/SKILL.md'}]);
  });

  await t.test('a successful empty discovery cannot clear configured files or call them available',async()=>{
    const result=await discoverLocalRoleSkills('synthetic-project',{checked:false,skills:[]},async()=>({skills:[]}));
    assert.equal(result.checked,true);assert.deepEqual(result.skills,[]);assert.equal(result.error,undefined);
    const html=render(result);
    assert.ok(html.includes(selected[0].path));assert.equal((html.match(/checked=""/g)??[]).length,1);
    assert.ok(html.includes('Saved selection; availability has not been confirmed.'));
    const choices=localSkillChoices([available,{...available,description:'Current discovery metadata.'}],selected);
    assert.equal(choices.length,2);assert.equal(choices[0].description,'Current discovery metadata.');
  });

  await t.test('malformed responses preserve prior discovery and report the read failure',async()=>{
    const previous={checked:true,skills:[available]};
    const result=await discoverLocalRoleSkills('synthetic-project',previous,async()=>({skills:[{path:available.path,name:null}]}));
    assert.equal(result.skills,previous.skills);assert.equal(result.checked,true);assert.ok(result.error);
    assert.ok(render(result).includes('Could not read local skills.'));
  });
});
