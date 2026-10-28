import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {TemplateService,portablePipeline,portableRole,validateTemplateDefinition} from '../src/templates.ts';
import type {Actor,Pipeline,Project,RoleProfile} from '../src/contracts.ts';
import type {CodexAdapter,GithubAdapter} from '../src/adapters/types.ts';
import type {PipelineTemplateDefinition,RoleTemplateDefinition,TemplateRoleWriter} from '../src/template-types.ts';

const OWNER:Actor={name:'synthetic-owner',kind:'human'};
const code=(value:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===value;
async function fixture(t:test.TestContext,saveRole?:TemplateRoleWriter){
  const root=await mkdtemp(path.join(os.tmpdir(),'gwi-template-test-'));
  const codex={async close(){},async start(){assert.fail('Template maintenance must not dispatch model work.')}} as unknown as CodexAdapter;
  const engine=new Engine(new Store(path.join(root,'state')),codex,{} as GithubAdapter),templates=new TemplateService(engine,{saveRole});
  const project=await engine.createProject({name:'Synthetic template project',workspace:root},OWNER);
  t.after(async()=>{await engine.close();await rm(root,{recursive:true,force:true})});
  const source=(kind:'role'|'pipeline',id:string)=>({projectId:project.id,kind,id,expectedProjectRevision:engine.project(project.id).revision,...(kind==='pipeline'?{expectedPipelineRevision:engine.pipeline(id).revision}:{})});
  const flow=engine.createPipeline({projectId:project.id,roleId:'development',template:'focused',name:'Synthetic focused workflow'},OWNER);
  const manual=engine.updatePipeline(flow.id,flow.revision,{...flow,stages:flow.stages.map(stage=>({...stage,executor:'manual',executionPurpose:undefined,review:false}))},OWNER);
  return{root,engine,templates,project,source,flow:manual};
}

test('template source is explicit, portable and private to authorized bindings',async t=>{
  const h=await fixture(t),current=h.engine.project(h.project.id),role=current.roles.find(value=>value.id==='qa')!;
  const native={...role,multica:{agentId:'synthetic-private-agent',runtimeId:'synthetic-private-runtime',mcpServerIds:['synthetic-private-server']},skills:[{name:'Synthetic local skill',path:'/synthetic/private/SKILL.md'}]};
  const definition=portableRole(native);validateTemplateDefinition(definition);
  const serialized=JSON.stringify(definition);assert.ok(!serialized.includes('synthetic-private'));assert.ok(!serialized.includes('/synthetic/private'));assert.ok(!('sandbox' in definition));assert.ok(!('tools' in definition));assert.deepEqual(definition.requirements,{sandbox:role.sandbox,tools:role.tools});
  assert.throws(()=>validateTemplateDefinition({...definition,multica:native.multica}),code('INVALID_TEMPLATE'));
  const created=h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-create'},OWNER);
  assert.equal(created.revision.changeSummary,'Saved from '+role.name+'.');
  assert.equal(created.revision.origin.kind,'copy');assert.equal(h.engine.project(current.id).roles.find(value=>value.id===role.id)?.templateBindingId,undefined);
  const agent:Actor={name:'synthetic-project-worker',kind:'agent',projectId:current.id,tools:['pipeline.propose']};
  assert.deepEqual(h.templates.list(agent),[]);assert.throws(()=>h.templates.revision(created.template.id,1,agent),code('PROJECT_SCOPE'));
  assert.throws(()=>h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-agent-create'},agent),code('OWNER_REQUIRED'));
  const altered=await h.engine.updateProject(current.id,current.revision,{...current,roles:current.roles.map(item=>item.id===role.id?{...item,origin:{kind:'template',template:{id:'forged',revision:1,hash:'forged'}},templateBindingId:'forged-binding'}:item)},OWNER);
  assert.deepEqual(altered.roles.find(item=>item.id===role.id)?.origin,role.origin);assert.equal(altered.roles.find(item=>item.id===role.id)?.templateBindingId,undefined);
  const pipeline=h.engine.updatePipeline(h.flow.id,h.flow.revision,{...h.flow,origin:{kind:'template',template:{id:'forged',revision:1,hash:'forged'}},templateBindingId:'forged'},OWNER);
  assert.deepEqual(pipeline.origin,h.flow.origin);assert.equal(pipeline.templateBindingId,undefined);
});

test('template revisions are immutable, idempotent and retired without deleting pins',async t=>{
  const h=await fixture(t),input={source:h.source('pipeline',h.flow.id),idempotencyKey:'synthetic-create'},created=h.templates.create(input,OWNER);
  assert.deepEqual(h.templates.create(input,OWNER),created);
  assert.throws(()=>h.templates.create({...input,purpose:'A different request'},OWNER),code('IDEMPOTENCY_CONFLICT'));
  const changed={...created.revision.definition,description:'A reviewed second purpose.'};
  const next=h.templates.revise(created.template.id,{expectedRecordRevision:1,definition:changed,changeSummary:'Clarify the purpose.',idempotencyKey:'synthetic-revise'},OWNER);
  assert.equal(next.revision.revision,2);assert.deepEqual(h.templates.revision(created.template.id,1,OWNER),created.revision);
  assert.throws(()=>h.templates.revise(created.template.id,{expectedRecordRevision:1,definition:changed,changeSummary:'Stale update.',idempotencyKey:'synthetic-stale'},OWNER),code('REVISION_CONFLICT'));
  h.templates.retire(created.template.id,{expectedRecordRevision:next.template.recordRevision,retired:true},OWNER);
  assert.deepEqual(h.templates.revision(created.template.id,1,OWNER),created.revision);
  assert.throws(()=>h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},expectedProjectRevision:h.project.revision},OWNER),code('TEMPLATE_RETIRED'));
});

test('independent workflow stage edits merge, while conflicting changes and deletion require a choice',async t=>{
  const h=await fixture(t),created=h.templates.create({source:h.source('pipeline',h.flow.id),idempotencyKey:'synthetic-workflow-template'},OWNER);
  const first=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'pipeline',id:h.flow.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:h.flow.revision},OWNER);
  assert.equal(first.state,'ready');const installed=await h.templates.apply(h.project.id,first.id,{previewKey:first.key,idempotencyKey:'synthetic-install'},OWNER);
  const baseline=installed.pipeline!,local=h.engine.updatePipeline(baseline.id,baseline.revision,{...baseline,stages:baseline.stages.map(stage=>stage.id==='implement'?{...stage,prompt:'Retain the project-specific implementation boundary.'}:stage)},OWNER);
  const definition=structuredClone(created.revision.definition) as PipelineTemplateDefinition;definition.stages.find(stage=>stage.id==='verify')!.prompt='Check the reviewed independent evidence.';
  const next=h.templates.revise(created.template.id,{expectedRecordRevision:created.template.recordRevision,definition,changeSummary:'Improve independent verification.',idempotencyKey:'synthetic-v2'},OWNER);
  const input={template:{id:created.template.id,revision:2},target:{kind:'pipeline' as const,id:local.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:local.revision};
  const preview=h.templates.preview(h.project.id,input,OWNER);assert.equal(preview.state,'ready');
  const candidate=preview.candidate as Pipeline;assert.equal(candidate.stages.find(stage=>stage.id==='implement')?.prompt,local.stages.find(stage=>stage.id==='implement')?.prompt);assert.equal(candidate.stages.find(stage=>stage.id==='verify')?.prompt,definition.stages.find(stage=>stage.id==='verify')?.prompt);
  const conflict=structuredClone(definition);conflict.stages.find(stage=>stage.id==='implement')!.prompt='Upstream changes the same instruction.';
  const third=h.templates.revise(created.template.id,{expectedRecordRevision:next.template.recordRevision,definition:conflict,changeSummary:'Change the implementation boundary.',idempotencyKey:'synthetic-v3'},OWNER);
  const conflicted=h.templates.preview(h.project.id,{...input,template:{id:created.template.id,revision:third.revision.revision}},OWNER);
  assert.equal(conflicted.state,'conflicts');assert.ok(conflicted.changes.some(change=>change.path==='/stages/implement/prompt'&&change.conflict&&change.resolution==='unresolved'));
  await assert.rejects(h.templates.apply(h.project.id,conflicted.id,{previewKey:conflicted.key,idempotencyKey:'synthetic-conflict-apply'},OWNER),code('TEMPLATE_PREVIEW_BLOCKED'));
  const resolved=h.templates.preview(h.project.id,{...conflicted.input,resolutions:{'/stages/implement/prompt':'project'}},OWNER);assert.equal(resolved.state,'ready');
  const deleted=structuredClone(conflict);deleted.stages=deleted.stages.filter(stage=>stage.id!=='implement').map(stage=>({...stage,dependsOn:stage.dependsOn.filter(id=>id!=='implement'),reworkTo:stage.reworkTo==='implement'?undefined:stage.reworkTo}));
  const fourth=h.templates.revise(created.template.id,{expectedRecordRevision:third.template.recordRevision,definition:deleted,changeSummary:'Remove the old implementation step.',idempotencyKey:'synthetic-v4'},OWNER);
  const deletion=h.templates.preview(h.project.id,{...input,template:{id:created.template.id,revision:fourth.revision.revision}},OWNER);assert.ok(deletion.changes.some(change=>change.path==='/stages/implement'&&change.conflict));
  assert.throws(()=>h.templates.preview(h.project.id,{...input,resolutions:{'/not-listed':'template'}},OWNER),code('INVALID_TEMPLATE_RESOLUTION'));
});

test('model defaults preserve sticky project ownership, including coincident values',async t=>{
  const h=await fixture(t),role=h.project.roles.find(value=>value.id==='qa')!,definition={...portableRole(role),model:'synthetic-model-a'};
  const created=h.templates.create({source:h.source('role',role.id),definition,idempotencyKey:'synthetic-role-template'},OWNER);
  const initial=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'role',id:role.id},expectedProjectRevision:h.project.revision},OWNER);assert.equal((initial.candidate as RoleProfile).model,null);assert.ok(initial.binding.projectOwnedPaths.includes('/model'));
  const installed=await h.templates.apply(h.project.id,initial.id,{previewKey:initial.key,idempotencyKey:'synthetic-role-install'},OWNER);
  const next=h.templates.revise(created.template.id,{expectedRecordRevision:1,definition:{...definition,model:'synthetic-model-b'},changeSummary:'Change the optional model default.',idempotencyKey:'synthetic-role-v2'},OWNER);
  const input={template:{id:created.template.id,revision:next.revision.revision},target:{kind:'role' as const,id:role.id},expectedProjectRevision:installed.project.revision};
  const kept=h.templates.preview(h.project.id,input,OWNER);assert.equal((kept.candidate as RoleProfile).model,null);
  const released=h.templates.preview(h.project.id,{...input,releaseOwnedPaths:['/model']},OWNER);assert.equal((released.candidate as RoleProfile).model,'synthetic-model-b');
  const accepted=await h.templates.apply(h.project.id,released.id,{previewKey:released.key,idempotencyKey:'synthetic-adopt-default'},OWNER);
  const edited=await h.engine.updateProject(h.project.id,accepted.project.revision,{...accepted.project,roles:accepted.project.roles.map(value=>value.id===role.id?{...value,model:'synthetic-model-c'}:value)},OWNER);
  const sameValue=h.templates.revise(created.template.id,{expectedRecordRevision:next.template.recordRevision,definition:{...definition,model:'synthetic-model-c'},changeSummary:'Use the coincident model.',idempotencyKey:'synthetic-role-v3'},OWNER);
  const coincident=h.templates.preview(h.project.id,{...input,template:{id:created.template.id,revision:sameValue.revision.revision},expectedProjectRevision:edited.revision},OWNER);assert.equal(coincident.state,'ready');const third=await h.templates.apply(h.project.id,coincident.id,{previewKey:coincident.key,idempotencyKey:'synthetic-coincident'},OWNER);assert.ok(third.binding.projectOwnedPaths.includes('/model'));
  const fourth=h.templates.revise(created.template.id,{expectedRecordRevision:sameValue.template.recordRevision,definition:{...definition,model:'synthetic-model-d'},changeSummary:'Another optional default.',idempotencyKey:'synthetic-role-v4'},OWNER);
  const stable=h.templates.preview(h.project.id,{...input,template:{id:created.template.id,revision:fourth.revision.revision},expectedProjectRevision:third.project.revision},OWNER);assert.equal((stable.candidate as RoleProfile).model,'synthetic-model-c');
});

test('new role installation never grants source capabilities or native bindings',async t=>{
  const h=await fixture(t),role=h.project.roles.find(value=>value.id==='development')!,created=h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-write-role'},OWNER);
  const blocked=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},expectedProjectRevision:h.project.revision},OWNER);assert.equal(blocked.state,'blocked');assert.ok(blocked.checks.some(check=>check.code==='CAPABILITY_REQUIREMENT'));assert.equal((blocked.candidate as RoleProfile).sandbox,'read-only');assert.equal((blocked.candidate as RoleProfile).multica,undefined);
  const safe=h.templates.revise(created.template.id,{expectedRecordRevision:1,definition:{...created.revision.definition,requirements:{sandbox:'read-only',tools:[]}} as RoleTemplateDefinition,changeSummary:'Require only the new-role baseline.',idempotencyKey:'synthetic-safe-role'},OWNER);
  const preview=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:safe.revision.revision},expectedProjectRevision:h.project.revision},OWNER);assert.equal(preview.state,'ready');const installed=await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-new-role'},OWNER);const saved=installed.project.roles.find(value=>value.id===preview.target.id)!;assert.equal(saved.sandbox,'read-only');assert.deepEqual(saved.skills,[]);assert.equal(saved.origin?.kind,'template');
});

test('Apply receipts deduplicate writes and reject stale project, workflow and binding bases',async t=>{
  const h=await fixture(t),created=h.templates.create({source:h.source('pipeline',h.flow.id),idempotencyKey:'synthetic-receipt-template'},OWNER),input={template:{id:created.template.id,revision:1},target:{kind:'pipeline' as const,id:h.flow.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:h.flow.revision};
  const preview=h.templates.preview(h.project.id,input,OWNER),receipt=await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-apply'},OWNER);
  const count=h.engine.store.events({projectId:h.project.id,limit:1000}).filter(event=>event.type==='template.applied').length;
  assert.deepEqual(await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-apply'},OWNER),receipt);
  assert.deepEqual(await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-repeat-key'},OWNER),receipt);
  assert.equal(h.engine.pipeline(h.flow.id).revision,receipt.pipeline?.revision);assert.equal(h.engine.store.events({projectId:h.project.id,limit:1000}).filter(event=>event.type==='template.applied').length,count);
  const stale=h.templates.preview(h.project.id,{...input,expectedPipelineRevision:receipt.pipeline!.revision},OWNER);h.engine.updatePipeline(h.flow.id,receipt.pipeline!.revision,{...receipt.pipeline!,description:'A concurrent project edit.'},OWNER);
  await assert.rejects(h.templates.apply(h.project.id,stale.id,{previewKey:stale.key,idempotencyKey:'synthetic-stale-apply'},OWNER),error=>code('TEMPLATE_PREVIEW_STALE')(error)||code('REVISION_CONFLICT')(error));
});

test('an owner can release existing model and effort choices in the first binding preview',async t=>{
  const h=await fixture(t),role=h.project.roles.find(value=>value.id==='qa')!;
  const created=h.templates.create({source:h.source('role',role.id),definition:{...portableRole(role),model:'synthetic-template-default',effort:'ultra'},idempotencyKey:'synthetic-first-owned'},OWNER);
  const input={template:{id:created.template.id,revision:1},target:{kind:'role' as const,id:role.id},expectedProjectRevision:h.project.revision};
  const kept=h.templates.preview(h.project.id,input,OWNER);assert.equal((kept.candidate as RoleProfile).model,null);assert.equal((kept.candidate as RoleProfile).effort,'max');
  const released=h.templates.preview(h.project.id,{...input,releaseOwnedPaths:['/model','/effort']},OWNER);assert.equal(released.state,'ready');assert.equal((released.candidate as RoleProfile).model,'synthetic-template-default');assert.equal((released.candidate as RoleProfile).effort,'ultra');assert.ok(!released.binding.projectOwnedPaths.includes('/model'));
  const receipt=await h.templates.apply(h.project.id,released.id,{previewKey:released.key,idempotencyKey:'synthetic-first-adopt'},OWNER);assert.equal(receipt.project.roles.find(value=>value.id===role.id)?.model,'synthetic-template-default');
});

test('unchanged coincident fields remain explicitly project owned and releasable',async t=>{
  const h=await fixture(t),role=h.project.roles.find(value=>value.id==='qa')!,created=h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-coincident-template'},OWNER);
  const input={template:{id:created.template.id,revision:1},target:{kind:'role' as const,id:role.id},expectedProjectRevision:h.project.revision},preview=h.templates.preview(h.project.id,input,OWNER);
  assert.ok(!preview.changes.some(change=>change.path==='/model'));assert.ok(preview.binding.projectOwnedPaths.includes('/model'));
  const receipt=await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-coincident-apply'},OWNER);
  const released=h.templates.preview(h.project.id,{...input,expectedProjectRevision:receipt.project.revision,releaseOwnedPaths:['/model']},OWNER);assert.equal(released.state,'ready');assert.ok(!released.binding.projectOwnedPaths.includes('/model'));
});

test('asynchronous role preparation cannot apply over a concurrent project change',async t=>{
  let engine!:Engine,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
  const writer:TemplateRoleWriter=async(projectId,expectedRevision,value,actor,roleId,checkpoint,mutation)=>{await gate;const project=engine.project(projectId),id=roleId??value.id!;return engine.updateProject(projectId,expectedRevision,{...project,roles:project.roles.map(role=>role.id===id?{...role,...value}:role)},actor,checkpoint,{roleOrigins:mutation?.origin?{[id]:mutation.origin}:undefined,roleBindingIds:mutation?.bindingId?{[id]:mutation.bindingId}:undefined,managed:true});};
  const h=await fixture(t,writer);engine=h.engine;const role=h.project.roles.find(value=>value.id==='qa')!,created=h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-deferred-template'},OWNER),preview=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'role',id:role.id},expectedProjectRevision:h.project.revision},OWNER);
  const pending=h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-deferred-apply'},OWNER);
  await h.engine.updateBindings(h.project.id,h.project.revision,{description:'A concurrent owner change.'},OWNER);release();
  await assert.rejects(pending,code('REVISION_CONFLICT'));assert.equal(h.templates.bindings(h.project.id,OWNER).length,0);assert.equal(h.engine.project(h.project.id).roles.find(value=>value.id===role.id)?.templateBindingId,undefined);
});

test('a committed role receipt survives a later preparation-bookkeeping error',async t=>{
  let engine!:Engine;
  const writer:TemplateRoleWriter=async(projectId,expectedRevision,value,actor,roleId,checkpoint,mutation)=>{const project=engine.project(projectId),id=roleId??value.id!;await engine.updateProject(projectId,expectedRevision,{...project,roles:project.roles.map(role=>role.id===id?{...role,...value}:role)},actor,checkpoint,{roleBindingIds:mutation?.bindingId?{[id]:mutation.bindingId}:undefined,managed:true});throw new Error('Synthetic metadata observation failed after local commit.');};
  const h=await fixture(t,writer);engine=h.engine;const role=h.project.roles.find(value=>value.id==='qa')!,created=h.templates.create({source:h.source('role',role.id),idempotencyKey:'synthetic-commit-template'},OWNER),preview=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'role',id:role.id},expectedProjectRevision:h.project.revision},OWNER);
  const receipt=await h.templates.apply(h.project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-commit-apply'},OWNER);assert.equal(receipt.project.roles.find(value=>value.id===role.id)?.templateBindingId,receipt.binding.id);assert.equal(h.templates.bindings(h.project.id,OWNER).length,1);
});

test('GitHub observation remains observation and frozen work retains its original definition',async t=>{
  const h=await fixture(t),project=await h.engine.updateBindings(h.project.id,h.project.revision,{repository:'synthetic/repository'},OWNER);
  const github=h.engine.updatePipeline(h.flow.id,h.flow.revision,{...h.flow,stages:[{id:'inspect-ci',name:'Observe synthetic CI',executor:'github',roleId:'qa',dependsOn:[],prompt:'',review:false,options:{mode:'observe',repository:project.repository,runId:42}}]},OWNER);
  const ci=h.templates.create({source:h.source('pipeline',github.id),idempotencyKey:'synthetic-ci-template'},OWNER),definition=ci.revision.definition as PipelineTemplateDefinition;assert.equal(definition.stages[0].githubMode,'observe');assert.ok(!JSON.stringify(definition).includes('synthetic/repository'));
  const check=h.templates.preview(project.id,{template:{id:ci.template.id,revision:1},target:{kind:'pipeline',id:github.id},expectedProjectRevision:project.revision,expectedPipelineRevision:github.revision},OWNER);assert.equal(check.state,'ready');assert.equal((check.candidate as Pipeline).stages[0].options?.mode,'observe');
  const direct=h.engine.createPipeline({projectId:project.id,roleId:'qa',name:'Synthetic frozen manual workflow'},OWNER),manual=h.engine.updatePipeline(direct.id,direct.revision,{...direct,stages:[{id:'work',name:'Wait for synthetic input',executor:'manual',roleId:'qa',dependsOn:[],prompt:'Old frozen instruction.',review:false}]},OWNER),run=h.engine.startRun({projectId:project.id,pipelineId:manual.id,goal:'Synthetic frozen work',baseline:'synthetic-baseline',idempotencyKey:'synthetic-frozen-run'},OWNER),snapshot=structuredClone(run.snapshot);
  const reusable=h.templates.create({source:h.source('pipeline',manual.id),idempotencyKey:'synthetic-frozen-template'},OWNER),changed=structuredClone(reusable.revision.definition) as PipelineTemplateDefinition;changed.stages[0].prompt='New instruction for future work.';const next=h.templates.revise(reusable.template.id,{expectedRecordRevision:1,definition:changed,changeSummary:'Improve future instructions.',idempotencyKey:'synthetic-frozen-next'},OWNER),preview=h.templates.preview(project.id,{template:{id:next.template.id,revision:2},target:{kind:'pipeline',id:manual.id},expectedProjectRevision:project.revision,expectedPipelineRevision:manual.revision},OWNER);await h.templates.apply(project.id,preview.id,{previewKey:preview.key,idempotencyKey:'synthetic-frozen-apply'},OWNER);assert.deepEqual(h.engine.run(run.id).snapshot,snapshot);
});

test('many logical roles may share one project role without losing stage or owner slot identity',async t=>{
  const h=await fixture(t),created=h.templates.create({source:h.source('pipeline',h.flow.id),idempotencyKey:'synthetic-shared-role-template'},OWNER);
  const first=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'pipeline',id:h.flow.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:h.flow.revision,mappings:{roles:{development:'development',qa:'development'}}},OWNER);
  assert.equal(first.state,'ready');const receipt=await h.templates.apply(h.project.id,first.id,{previewKey:first.key,idempotencyKey:'synthetic-shared-role-install'},OWNER);
  assert.equal(receipt.pipeline?.roleId,'development');assert.equal(receipt.pipeline?.stages.find(stage=>stage.id==='verify')?.roleId,'development');
  const next=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'pipeline',id:h.flow.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:receipt.pipeline!.revision,mappings:{roles:{qa:'qa'}}},OWNER),candidate=next.candidate as Pipeline;
  assert.equal(next.state,'ready');assert.equal(candidate.roleId,'development');assert.equal(candidate.stages.find(stage=>stage.id==='implement')?.roleId,'development');assert.equal(candidate.stages.find(stage=>stage.id==='verify')?.roleId,'qa');assert.ok(!next.binding.projectOwnedPaths.some(path=>path==='/ownerRoleSlot'||path==='/stages/implement/roleSlot'));assert.ok(next.changes.some(change=>change.path==='/bindings/roles/qa'));
  const updated=await h.templates.apply(h.project.id,next.id,{previewKey:next.key,idempotencyKey:'synthetic-remap-only-review'},OWNER);assert.equal(updated.pipeline?.roleId,'development');assert.equal(updated.pipeline?.stages.find(stage=>stage.id==='implement')?.roleId,'development');assert.equal(updated.pipeline?.stages.find(stage=>stage.id==='verify')?.roleId,'qa');
});

test('a local child target edit survives an unrelated template update until a reviewed mapping replaces it',async t=>{
  const h=await fixture(t),childA=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic child A'},OWNER),childB=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic child B'},OWNER);
  const parent=h.engine.updatePipeline(h.flow.id,h.flow.revision,{...h.flow,stages:[{id:'delegate',name:'Delegate synthetic work',roleId:'development',executor:'pipeline',dependsOn:[],prompt:'',review:false,options:{pipelineId:childA.id}}]},OWNER);
  const created=h.templates.create({source:h.source('pipeline',parent.id),idempotencyKey:'synthetic-external-template'},OWNER),first=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'pipeline',id:parent.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:parent.revision},OWNER),receipt=await h.templates.apply(h.project.id,first.id,{previewKey:first.key,idempotencyKey:'synthetic-external-install'},OWNER);
  const local=h.engine.updatePipeline(parent.id,receipt.pipeline!.revision,{...receipt.pipeline!,stages:receipt.pipeline!.stages.map(stage=>({...stage,options:{pipelineId:childB.id}}))},OWNER);assert.equal(h.templates.bindings(h.project.id,OWNER)[0].mappings.external.delegate.pipelineId,childB.id);
  const definition={...created.revision.definition,name:'Synthetic renamed parent'},next=h.templates.revise(created.template.id,{expectedRecordRevision:1,definition,changeSummary:'Clarify the parent name only.',idempotencyKey:'synthetic-parent-name'},OWNER);
  const input={template:{id:created.template.id,revision:next.revision.revision},target:{kind:'pipeline' as const,id:local.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:local.revision},preview=h.templates.preview(h.project.id,input,OWNER);
  assert.equal(preview.state,'ready');assert.equal((preview.candidate as Pipeline).stages[0].options?.pipelineId,childB.id);assert.ok(!preview.changes.some(change=>change.path.endsWith('/target')));
  const explicit=h.templates.preview(h.project.id,{...input,mappings:{external:{delegate:{pipelineId:childA.id}}}},OWNER);assert.equal(explicit.state,'ready');assert.equal((explicit.candidate as Pipeline).stages[0].options?.pipelineId,childA.id);assert.ok(explicit.changes.some(change=>change.path==='/stages/delegate/target'));
});

test('an external slot identity independent of its stage ID survives local edits and explicit remapping',async t=>{
  const h=await fixture(t),childA=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic logical child A'},OWNER),childB=h.engine.createPipeline({projectId:h.project.id,roleId:'qa',name:'Synthetic logical child B'},OWNER),parent=h.engine.updatePipeline(h.flow.id,h.flow.revision,{...h.flow,stages:[{id:'delegate',name:'Delegate a named target',roleId:'development',executor:'pipeline',dependsOn:[],prompt:'',review:false,options:{pipelineId:childA.id}}]},OWNER);
  const definition=portablePipeline(parent,h.project);definition.stages[0].bindingSlot='logical-child-target';definition.bindingSlots=[{id:'logical-child-target',kind:'pipeline'}];
  const created=h.templates.create({source:h.source('pipeline',parent.id),definition,idempotencyKey:'synthetic-logical-target-template'},OWNER),first=h.templates.preview(h.project.id,{template:{id:created.template.id,revision:1},target:{kind:'pipeline',id:parent.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:parent.revision,mappings:{external:{'logical-child-target':{pipelineId:childA.id}}}},OWNER);
  assert.equal(first.state,'ready');const receipt=await h.templates.apply(h.project.id,first.id,{previewKey:first.key,idempotencyKey:'synthetic-logical-target-install'},OWNER),local=h.engine.updatePipeline(parent.id,receipt.pipeline!.revision,{...receipt.pipeline!,stages:receipt.pipeline!.stages.map(stage=>({...stage,options:{pipelineId:childB.id}}))},OWNER);
  const next=h.templates.revise(created.template.id,{expectedRecordRevision:1,definition:{...definition,name:'Renamed logical target parent'},changeSummary:'Rename only.',idempotencyKey:'synthetic-logical-target-next'},OWNER),input={template:{id:created.template.id,revision:next.revision.revision},target:{kind:'pipeline' as const,id:parent.id},expectedProjectRevision:h.project.revision,expectedPipelineRevision:local.revision},preview=h.templates.preview(h.project.id,input,OWNER);
  assert.equal(preview.state,'ready');assert.equal((preview.candidate as Pipeline).stages[0].options?.pipelineId,childB.id);assert.ok(!preview.binding.projectOwnedPaths.includes('/stages/delegate/bindingSlot'));
  const remapped=h.templates.preview(h.project.id,{...input,mappings:{external:{'logical-child-target':{pipelineId:childA.id}}}},OWNER);assert.equal(remapped.state,'ready');assert.equal((remapped.candidate as Pipeline).stages[0].options?.pipelineId,childA.id);assert.ok(remapped.changes.some(change=>change.path==='/stages/delegate/target'));
});
