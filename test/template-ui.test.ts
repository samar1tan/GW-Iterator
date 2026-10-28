import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {RoleTemplateDefinition,TemplateChangePreview,TemplateRevision} from '../src/template-types.ts';

test('template context reuses ordinary editors and exposes explicit project choices in both locales',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx'),{RoleEditor}=await vite.ssrLoadModule('/web/platform/TeamWorkspace.tsx'),{PipelineEditor}=await vite.ssrLoadModule('/web/platform/PipelineEditor.tsx'),{templateEditorObjects,roleTemplateDraft,pipelineTemplateDraft}=await vite.ssrLoadModule('/web/platform/templateDefinition.ts'),{TemplatePreviewChanges}=await vite.ssrLoadModule('/web/platform/TemplateChangeDialog.tsx'),{DefinitionGovernance}=await vite.ssrLoadModule('/web/platform/DefinitionGovernance.tsx');
  const definition:RoleTemplateDefinition={kind:'role',name:'Synthetic evidence reviewer',description:'Review a bounded synthetic change.',instructions:'Inspect the supplied independent evidence.',checks:['Report an actual finding.'],requirements:{sandbox:'read-only',tools:['context.read']}};
  const objects=templateEditorObjects(definition),revision:TemplateRevision={id:'synthetic-template@1',templateId:'synthetic-template',revision:1,hash:'synthetic-hash',kind:'role',definition,purpose:definition.description,changeSummary:'Synthetic initial contract.',origin:{kind:'builtin',key:'synthetic',revision:1},createdAt:'2026-01-01T00:00:00Z'};
  const binding={id:'synthetic-binding',revision:1,projectId:objects.project.id,target:{kind:'role' as const,id:objects.role.id},template:{id:revision.templateId,revision:1,hash:revision.hash},baseline:definition,mappings:{roles:{},external:{}},projectOwnedPaths:['/model','/effort'],appliedAt:'2026-01-01T00:00:00Z'};
  const preview:TemplateChangePreview={id:'synthetic-preview',key:'synthetic-preview-key',projectId:objects.project.id,state:'ready',target:binding.target,template:binding.template,expectedProjectRevision:1,candidate:objects.role,binding,changes:[],checks:[],input:{template:{id:revision.templateId,revision:1},target:binding.target,expectedProjectRevision:1},createdAt:'2026-01-01T00:00:00Z'};
  const render=(element:ReturnType<typeof createElement>,locale:string)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},element));

  await t.test('role contract forms retain six native effort names and omit project binding controls',()=>{
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(RoleEditor,{role:objects.role,project:objects.project,team:objects.team,models:[{id:'synthetic-model',name:'Synthetic model',efforts:['low','medium','high','xhigh','max','ultra'],isDefault:true}],onClose(){},onChanged:async()=>{},templateContext:{definition,onSave:async()=>{},embedded:true}}),locale);
      assert.ok(html.includes('Synthetic evidence reviewer'));assert.ok(html.includes(locale==='en'?'Publish template revision':'发布模板版本'));assert.ok(html.includes(locale==='en'?'Required project access':'所需项目访问范围'));
      for(const effort of ['Light','Medium','High','Extra High','Max','Ultra'])assert.ok(html.includes(`>${effort}</option>`));
      assert.ok(!html.includes(locale==='en'?'Local Codex skill context':'本地 Codex 技能上下文'));assert.ok(!html.includes('name="multica"'));assert.ok(!html.includes('synthetic-private-runtime'));
    }
    const draft=roleTemplateDraft({...objects.role,multica:{runtimeId:'synthetic-private-runtime'},skills:[{name:'Synthetic local context',path:'/synthetic/local/SKILL.md'}]},false,false);
    assert.equal(Object.hasOwn(draft,'model'),false);assert.equal(Object.hasOwn(draft,'effort'),false);assert.ok(!JSON.stringify(draft).includes('synthetic-private-runtime'));assert.ok(!JSON.stringify(draft).includes('/synthetic/local'));
  });

  await t.test('coincident model choices retain a usable return-to-template action without a fake content diff',()=>{
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(TemplatePreviewChanges,{preview,revision,resolutions:{},onResolve(){},onRelease(){}}),locale);
      assert.ok(html.includes(locale==='en'?'No working-content changes':'工作内容没有变化'));assert.ok(html.includes(locale==='en'?'Fields kept by this project':'由项目保留的字段'));assert.equal((html.match(/<button/g)??[]).length,2);assert.ok(html.includes(locale==='en'?'Let the template manage Model':'将模型交回模板管理'));
    }
  });

  await t.test('kept fields show configured project values rather than inferred effective values',()=>{
    const candidate={...objects.role,model:'synthetic-unconfirmed-effective-model',effort:'ultra'},different={...preview,candidate};
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(TemplatePreviewChanges,{project:objects.project,preview:different,revision,resolutions:{},onResolve(){},onRelease(){}}),locale);
      assert.ok(html.includes(locale==='en'?'Inherit default':'继承默认值'));assert.ok(html.includes('>Max</small>'));assert.ok(!html.includes('synthetic-unconfirmed-effective-model'));assert.ok(!html.includes('>Ultra</small>'));
    }
  });

  await t.test('creation notes name the actual source and revision notes remain neutral',async()=>{
    const{TemplateDefinitionEditor}=await vite.ssrLoadModule('/web/platform/TemplateDefinitionEditor.tsx');
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(TemplateDefinitionEditor,{source:{projectId:objects.project.id,kind:'role',id:objects.role.id,expectedProjectRevision:1},sourceName:'Synthetic source role',description:definition.description,onClose(){},onSaved(){},renderEditor(){return createElement('p',null,'Synthetic maintained editor')}}),locale);
      assert.ok(html.includes(locale==='en'?'Saved from Synthetic source role.':'保存自Synthetic source role。'));assert.ok(!html.includes('Reviewed working-contract update'));
      const updated=render(createElement(TemplateDefinitionEditor,{revision,head:{recordRevision:1},description:definition.description,onClose(){},onSaved(){},renderEditor(){return createElement('p',null,'Synthetic maintained editor')}}),locale);
      assert.ok(updated.includes(locale==='en'?'Contract updated.':'工作契约已更新。'));
    }
  });

  await t.test('pipeline authoring uses stage controls and named logical roles rather than requiring JSON',()=>{
    const pipelineDefinition={kind:'pipeline',name:'Synthetic workflow',description:'Prepare and review synthetic evidence.',ownerRoleSlot:'work-role',roleSlots:[{id:'work-role',name:'Synthetic implementation'}],bindingSlots:[],policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:30,tokenBudget:1000},stages:[{id:'prepare',name:'Prepare synthetic result',roleSlot:'work-role',executor:'manual',dependsOn:[],prompt:'Prepare a bounded result.',review:false},{id:'review',name:'Review synthetic result',roleSlot:'work-role',executor:'manual',dependsOn:['prepare'],prompt:'Inspect the prepared evidence.',review:false}]};
    const context=templateEditorObjects(pipelineDefinition);
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(PipelineEditor,{pipeline:context.pipeline,project:context.project,pipelines:[],runs:[],onBack(){},onChanged:async()=>{},templateContext:{definition:pipelineDefinition,onSave:async()=>{}}}),locale);
      assert.ok(html.includes('Prepare synthetic result'));assert.ok(html.includes('Synthetic implementation'));assert.ok(html.includes(locale==='en'?'Publish template revision':'发布模板版本'));assert.ok(html.includes(locale==='en'?'Role slots':'角色职责'));assert.ok(!/<textarea[^>]*required[^>]*class="code-editor"/.test(html));
    }
    const portable=pipelineTemplateDraft(context.pipeline,context.project);assert.equal(portable.stages[1].roleSlot,'work-role');assert.equal(Object.hasOwn(portable.stages[1],'roleId'),false);
  });

  await t.test('source rows show actual unknown or pinned state and a deliberate update action',()=>{
    const head={id:revision.templateId,kind:'role',name:definition.name,purpose:definition.description,latestRevision:2,recordRevision:2,status:'active',updatedAt:'2026-01-01T00:01:00Z'},governance={bindings:[binding],templates:[head],loading:false,refresh(){}};
    for(const locale of ['en','zh-CN']){
      const props={project:objects.project,kind:'role',object:{...objects.role,origin:{kind:'builtin',key:'synthetic-start',revision:1},templateBindingId:binding.id},models:[],onChanged:async()=>{},onSaveAs(){}};
      const source=(html:string)=>html.match(/class="pf-definition-source">([\s\S]*?)<\/div>/)?.[1]??'';
      const html=render(createElement(DefinitionGovernance,{...props,governance}),locale),primary=source(html);
      assert.ok(primary.includes(locale==='en'?'Reusable template':'可复用模板'));assert.ok(!primary.includes(locale==='en'?'Built-in starting contract':'内置起始契约'));assert.ok(html.includes(locale==='en'?'Original creation source':'最初创建来源'));assert.ok(html.includes(locale==='en'?'Built-in starting contract':'内置起始契约'));assert.ok(html.includes(locale==='en'?'View update':'查看更新'));assert.ok(primary.includes(locale==='en'?'2 project choices':'2 项项目选择'));
      const missingHead=render(createElement(DefinitionGovernance,{...props,governance:{...governance,templates:[]}}),locale);assert.ok(source(missingHead).includes(definition.name));
      const historical={...binding,id:'synthetic-historical-binding',revision:12,baseline:{...definition,name:'Synthetic obsolete template'}},active=render(createElement(DefinitionGovernance,{...props,governance:{...governance,bindings:[historical,binding]}}),locale);assert.ok(!source(active).includes('Synthetic obsolete template'));assert.ok(source(active).includes(definition.name));
      const onlyHistory=render(createElement(DefinitionGovernance,{...props,governance:{...governance,bindings:[historical],loading:true}}),locale);assert.ok(source(onlyHistory).includes(locale==='en'?'Reading bound template':'正在读取关联模板'));assert.ok(!source(onlyHistory).includes('Synthetic obsolete template'));
      for(const loading of [true,false]){
        const unknown=render(createElement(DefinitionGovernance,{...props,governance:{bindings:[],templates:[],loading,error:loading?undefined:new Error('Synthetic source read failure'),refresh(){}}}),locale),text=source(unknown);
        assert.ok(text.includes(locale==='en'?(loading?'Reading bound template':'Bound template could not be confirmed'):(loading?'正在读取关联模板':'暂时无法确认已关联的模板')));assert.ok(!text.includes(locale==='en'?'Built-in starting contract':'内置起始契约'));
      }
      const legacy=render(createElement(DefinitionGovernance,{...props,object:objects.role,governance:{bindings:[],templates:[],loading:false,refresh(){}}}),locale);assert.ok(source(legacy).includes(locale==='en'?'Origin was not recorded':'未记录创建来源'));
    }
  });

  await t.test('library stage summaries omit long prompts and retain named role and check counts',async()=>{
    const{TemplateStageSummary}=await vite.ssrLoadModule('/web/platform/TemplateLibrary.tsx');
    const pipeline={id:'synthetic-compact',projectId:objects.project.id,revision:1,name:'Synthetic compact preview',description:'One bounded review.',roleId:objects.role.id,policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:30,tokenBudget:1000},updatedAt:'',stages:[{id:'review',name:'Inspect synthetic evidence',roleId:objects.role.id,executor:'manual',dependsOn:[],prompt:'Synthetic full contract that should only appear after deliberate expansion. '.repeat(40),checks:['Inspect the actual result.'],review:false}]};
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(TemplateStageSummary,{pipeline,roles:objects.project.roles,onSelect(){}}),locale);assert.ok(html.includes('Inspect synthetic evidence'));assert.ok(html.includes('Synthetic evidence reviewer'));assert.ok(html.includes(locale==='en'?'1 check':'1 项检查'));assert.ok(!html.includes('Synthetic full contract'));
    }
  });

  await t.test('role preview separates purpose, responsibility and actual optional defaults',async()=>{
    const{TemplateRoleDetails}=await vite.ssrLoadModule('/web/platform/TemplateLibrary.tsx');
    for(const locale of ['en','zh-CN']){
      const omitted=render(createElement(TemplateRoleDetails,{definition,purpose:definition.description}),locale);
      assert.equal((omitted.match(/Not specified by template|模板未指定/g)??[]).length,2);assert.ok(!omitted.includes(definition.description));
      const explicit=render(createElement(TemplateRoleDetails,{definition:{...definition,description:'Synthetic evidence handoff',model:null,effort:'high'},purpose:definition.description}),locale);
      assert.ok(explicit.includes('Synthetic evidence handoff'));assert.ok(explicit.includes(locale==='en'?'Inherit default':'继承默认值'));assert.ok(explicit.includes('>High</dd>'));assert.ok(!explicit.includes('Not specified by template'));
      const chosen=render(createElement(TemplateRoleDetails,{definition:{...definition,model:'synthetic-explicit-model',effort:'max'},purpose:definition.description}),locale);
      assert.ok(chosen.includes('synthetic-explicit-model'));assert.ok(chosen.includes('>Max</dd>'));
    }
  });

  await t.test('a role responsibility conflict is not mislabeled as the separate template purpose',()=>{
    const conflict={...preview,state:'conflicts',changes:[{path:'/description',kind:'change',base:'Original responsibility',project:'Project responsibility',template:'Evidence handoff',resolution:'unresolved',conflict:true}]};
    for(const locale of ['en','zh-CN']){
      const html=render(createElement(TemplatePreviewChanges,{project:objects.project,preview:conflict,revision,resolutions:{},onResolve(){},onRelease(){}}),locale);
      assert.ok(html.includes(locale==='en'?'<summary>Responsibility':'<summary>职责'));assert.ok(!html.includes(locale==='en'?'<summary>Purpose':'<summary>用途'));
    }
  });

  await t.test('resolved conflicts move to the chosen bucket instead of still demanding resolution',()=>{
    for(const resolution of ['project','template'] as const)for(const locale of ['en','zh-CN']){
      const resolved={...preview,state:'ready',changes:[{path:'/description',kind:'change',base:'Initial responsibility',project:'Project responsibility',template:'Template responsibility',resolution,conflict:true}]};
      const html=render(createElement(TemplatePreviewChanges,{project:objects.project,preview:resolved,revision,resolutions:{'/description':resolution},onResolve(){},onRelease(){}}),locale),expected=resolution==='project'?(locale==='en'?'Project choices to keep':'保留的项目选择'):(locale==='en'?'Changes to apply':'将应用的变更');
      assert.ok(html.includes('<h3>'+expected));assert.ok(!html.includes(locale==='en'?'<h3>Conflicts to resolve':'<h3>需要处理的冲突'));assert.equal((html.match(/class="pf-template-change"/g)??[]).length,1);assert.ok(html.includes(locale==='en'?'<summary>Responsibility':'<summary>职责'));
    }
  });

  await t.test('structured governance errors localize the useful reason and disclose original diagnostics on demand',async()=>{
    const{ErrorNotice}=await vite.ssrLoadModule('/web/components.tsx'),{governanceError}=await vite.ssrLoadModule('/web/governanceErrorMessages.ts');
    for(const[code,key]of [['TEMPLATE_PREVIEW_STALE','templateStaleError'],['KNOWLEDGE_SCOPE','knowledgeScopeError']] as const)for(const locale of ['en','zh-CN']){
      const diagnostic='SYNTHETIC_TECHNICAL_DIAGNOSTIC',html=render(createElement(ErrorNotice,{error:governanceError(diagnostic,code)}),locale),disclosure=html.indexOf('<details>');
      assert.ok(html.includes(makeI18n(locale).t(key)));assert.ok(disclosure>=0);assert.ok(!html.slice(0,disclosure).includes(diagnostic));assert.ok(html.slice(disclosure).includes(diagnostic));assert.ok(!html.includes('<details open'));
    }
  });
});
