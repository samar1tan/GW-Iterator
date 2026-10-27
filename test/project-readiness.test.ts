import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Actor,Pipeline,Project,Run,TaskOutput} from '../src/contracts.ts';
import type {CodexAdapter} from '../src/adapters/types.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {inspectWorkspace,requireWorkspaceReady,Workspaces} from '../src/workspaces.ts';
import {pipelineNeedsModel,projectReadiness} from '../src/project-readiness.ts';
import {AppError} from '../src/validation.ts';

const execute=promisify(execFile),OWNER:Actor={kind:'human',name:'Synthetic setup reviewer'};
const output:TaskOutput={outcome:'done',summary:'Synthetic task ended.',artifacts:[],observations:[]};
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;
async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-readiness-test-')),workspace=path.join(directory,'source');await mkdir(workspace);
  await writeFile(path.join(workspace,'README.md'),'# Synthetic source\nMain content.\n## Details\nFocused content.\n');await writeFile(path.join(workspace,'other.md'),'# Unrelated source\nUnrelated synthetic content.\n');
  const calls={worker:0,goal:0};
  const codex:CodexAdapter={async info(){return{available:true,connected:true,models:[]};},async skills(){return[];},async start(){calls.worker++;return{ref:{threadId:'synthetic-thread',turnId:'synthetic-turn'},completion:Promise.resolve({output,usage:{input:0,output:0,total:0}})};},async startGoal(){calls.goal++;throw new Error('A synthetic native goal must be rejected before this adapter.');},async steer(){},async interrupt(){},async close(){}};
  const store=new Store(path.join(directory,'state')),engine=new Engine(store,codex,{async info(){return{available:true,authenticated:true};},async observe(){throw new Error('No CI in readiness tests.');},async dispatch(){throw new Error('No CI in readiness tests.');}});
  const project=await engine.createProject({name:'Synthetic setup project',workspace},OWNER);
  const git=(...args:string[])=>execute('git',['-C',workspace,'-c','core.hooksPath=/dev/null','-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid',...args],{env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  const commit=async()=>{await git('init','--template=');await git('add','--','README.md','other.md');await git('commit','-m','Commit synthetic input');return(await git('rev-parse','HEAD')).stdout.trim();};
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  return{directory,workspace,engine,store,project,calls,git,commit};
}
async function until(condition:()=>boolean){for(let count=0;count<100;count++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Synthetic state did not settle.');}
function manualFlow(h:Awaited<ReturnType<typeof fixture>>):Pipeline{
  const created=h.engine.createPipeline({projectId:h.project.id,roleId:'lead'},OWNER);
  return h.engine.updatePipeline(created.id,created.revision,{...created,stages:[{id:'owner',name:'Synthetic manual evidence',roleId:'lead',executor:'manual',dependsOn:[],prompt:'Record synthetic evidence.',review:false}]},OWNER);
}
function start(h:Awaited<ReturnType<typeof fixture>>,flow:Pipeline,key:string):Run{return h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Inspect synthetic setup.',baseline:'Synthetic committed input.',idempotencyKey:key},OWNER);}

test('readiness requires the selected Git root and a committed HEAD without changing source',async t=>{
  const h=await fixture(t);
  assert.equal((await inspectWorkspace(h.workspace)).code,'GIT_REPOSITORY_REQUIRED');
  assert.equal((await inspectWorkspace(path.join(h.directory,'missing'))).code,'WORKSPACE_UNAVAILABLE');
  await h.git('init','--template=');assert.equal((await inspectWorkspace(h.workspace)).code,'GIT_COMMIT_REQUIRED');
  const commit=await h.commit();await writeFile(path.join(h.workspace,'README.md'),'Uncommitted synthetic edit.');
  assert.deepEqual(await inspectWorkspace(h.workspace),{status:'ready',code:'READY',sourceCommit:commit});
  assert.equal(await readFile(path.join(h.workspace,'README.md'),'utf8'),'Uncommitted synthetic edit.');
  const nested=path.join(h.workspace,'nested');await mkdir(nested);assert.equal((await inspectWorkspace(nested)).code,'GIT_ROOT_MISMATCH');
  const workspaces=new Workspaces(h.store,path.join(h.directory,'executions'));
  await assert.rejects(workspaces.ensure({...h.project,workspace:nested},'synthetic-child-root'),code('GIT_ROOT_MISMATCH'));
  assert.equal(h.store.list('execution-workspace').length,0);assert.deepEqual(h.calls,{worker:0,goal:0});
});

test('nested human workflows bypass the model boundary while unresolved or recursive children stay conservative',async t=>{
  const h=await fixture(t),leaf=manualFlow(h),parent={...leaf,id:'synthetic-parent',stages:[{...leaf.stages[0],executor:'pipeline' as const,options:{pipelineId:leaf.id}}]};
  assert.equal(pipelineNeedsModel(parent,[parent,leaf]),false);
  assert.equal(pipelineNeedsModel(parent,[parent]),true);
  assert.equal(pipelineNeedsModel({...parent,stages:[{...parent.stages[0],options:{pipelineId:parent.id}}]},[parent]),true);
  assert.equal(pipelineNeedsModel({...leaf,stages:[{...leaf.stages[0],executor:'codex'}]},[leaf]),true);
  h.engine.executionReadiness=requireWorkspaceReady;const run=start(h,leaf,'synthetic-manual');await until(()=>h.engine.run(run.id).status==='waiting');
  h.engine.completeManual(run.id,'owner',output,OWNER);assert.equal(h.engine.run(run.id).status,'completed');assert.equal(h.calls.worker,0);
});

test('binding saves retain source and role data and reject stale or expanded writes',async t=>{
  const h=await fixture(t),configured=await h.engine.updateProject(h.project.id,h.project.revision,{...h.project,roles:h.project.roles.map(role=>({...role,instructions:role.instructions+'\nSynthetic preserved guidance.'})),knowledgeSources:[{id:'source',path:path.join(h.workspace,'README.md'),kind:'document',roles:[]}]},OWNER);
  const saved=await h.engine.updateBindings(configured.id,configured.revision,{name:'Synthetic renamed project',description:'Narrow binding change.'},OWNER);
  assert.deepEqual(saved.roles,configured.roles);assert.deepEqual(saved.knowledgeSources,configured.knowledgeSources);
  await assert.rejects(h.engine.updateBindings(saved.id,configured.revision,{name:'Stale synthetic name'},OWNER),code('REVISION_CONFLICT'));
  await assert.rejects(h.engine.updateBindings(saved.id,saved.revision,{roles:[]} as never,OWNER),code('INVALID_PROJECT_BINDINGS'));
  await assert.rejects(h.engine.updateBindings(saved.id,saved.revision,{name:'Cross-scope'}, {...OWNER,projectId:'another-project'}),code('PROJECT_SCOPE'));
  assert.deepEqual(h.engine.project(saved.id),saved);
});

test('index receipts distinguish no sources, not indexed sources, indexed empty directories and errors',async t=>{
  const h=await fixture(t);assert.equal((await projectReadiness(h.project,h.store)).knowledge.status,'not_configured');
  const empty=path.join(h.workspace,'empty');await mkdir(empty);
  let project=await h.engine.updateProject(h.project.id,h.project.revision,{...h.project,knowledgeSources:[{id:'empty-source',kind:'document',path:empty,roles:[]}]},OWNER);
  assert.equal((await projectReadiness(project,h.store)).knowledge.status,'not_indexed');await h.engine.sync(project.id,OWNER);
  const indexed=(await projectReadiness(project,h.store)).knowledge;assert.equal(indexed.status,'indexed');assert.equal(indexed.indexedSources,1);assert.equal(indexed.currentEntries,0);assert.ok(indexed.lastSyncedAt);
  project=await h.engine.updateProject(project.id,project.revision,{...project,knowledgeSources:[{...project.knowledgeSources[0],path:path.join(h.workspace,'missing.md')}]},OWNER);
  await h.engine.sync(project.id,OWNER);const failed=(await projectReadiness(project,h.store)).knowledge;assert.equal(failed.status,'issues');assert.equal(failed.missingEntries,1);assert.equal(failed.indexedSources,0);
  assert.deepEqual(h.calls,{worker:0,goal:0});
});

test('source configuration edits invalidate only affected new knowledge and preserve frozen work',async t=>{
  for(const change of ['path','section','roles','kind','remove'] as const)await t.test(change,async child=>{
    const h=await fixture(child),flow=manualFlow(h);
    let project=await h.engine.updateProject(h.project.id,h.project.revision,{...h.project,knowledgeSources:[{id:'changed-source',kind:'document',path:path.join(h.workspace,'README.md'),roles:['development']},{id:'unchanged-source',kind:'document',path:path.join(h.workspace,'other.md'),roles:[]}]},OWNER);
    await h.engine.sync(project.id,OWNER);const lesson=h.engine.lesson(project.id,{title:'Synthetic lesson',content:'Keep verified synthetic lessons.'},OWNER),old=start(h,flow,'synthetic-before-'+change);
    const changed={...project.knowledgeSources[0],...(change==='path'?{path:path.join(h.workspace,'other.md')}:change==='section'?{section:'Details'}:change==='roles'?{roles:['qa']}:change==='kind'?{kind:'memory' as const}:{})};
    project=await h.engine.updateProject(project.id,project.revision,{...project,knowledgeSources:change==='remove'?project.knowledgeSources.slice(1):[changed,project.knowledgeSources[1]]},OWNER);
    const entries=h.engine.detail(project.id,OWNER).knowledge,invalid=entries.find(entry=>entry.sourceId==='changed-source')!;
    assert.equal(invalid.status,'error');assert.equal(invalid.errorCode,'SOURCE_CONFIGURATION_CHANGED');assert.equal(invalid.content,old.snapshot.knowledge.find(entry=>entry.id===invalid.id)!.content);
    assert.equal(entries.find(entry=>entry.sourceId==='unchanged-source')!.status,'current');assert.equal(entries.find(entry=>entry.id===lesson.id)!.status,'current');
    const fresh=start(h,flow,'synthetic-after-'+change);assert.equal(fresh.snapshot.knowledge.some(entry=>entry.sourceId==='changed-source'),false);assert.equal(h.engine.run(old.id).snapshot.knowledge.find(entry=>entry.id===invalid.id)!.status,'current');
    await h.engine.sync(project.id,OWNER);const after=h.engine.detail(project.id,OWNER).knowledge.find(entry=>entry.sourceId==='changed-source')!;assert.equal(after.status,change==='remove'?'missing':'current');assert.equal(after.errorCode,undefined);if(change==='roles')assert.deepEqual(after.roles,['qa']);
  });
});

test('production worker readiness rejects before dispatch and permits a bounded retry after a real commit',async t=>{
  const h=await fixture(t);h.engine.executionReadiness=requireWorkspaceReady;
  const flow=h.engine.detail(h.project.id,OWNER).pipelines[0],run=start(h,flow,'synthetic-guarded-worker');await until(()=>h.engine.run(run.id).status==='failed');
  const failed=h.engine.run(run.id).stages[0].attempts[0];assert.equal(failed.failureCode,'GIT_REPOSITORY_REQUIRED');assert.equal(failed.nativeDispatchState,'not_dispatched');assert.equal(failed.nativeCleanupConfirmed,true);assert.deepEqual(h.calls,{worker:0,goal:0});
  await h.commit();h.engine.retry(run.id,flow.stages[0].id,'A committed synthetic baseline is now present.',OWNER);await until(()=>h.calls.worker===1);assert.equal(h.engine.run(run.id).snapshot.project.revision,run.snapshot.project.revision);
});

test('production native-goal fallback readiness failure is known not dispatched and remains recoverable',async t=>{
  const h=await fixture(t);h.engine.executionReadiness=requireWorkspaceReady;const intake=new IntakeService(h.engine);
  const goal=intake.create(h.project.id,{request:'Inspect a synthetic first goal.',idempotencyKey:'synthetic-goal-guard'},OWNER);
  await until(()=>intake.list(h.project.id)[0].status==='failed');const current=intake.list(h.project.id)[0],attempt=h.engine.run(goal.routerRunId).stages[0].attempts[0];
  assert.equal(attempt.nativeDispatchState,'not_dispatched');assert.equal(attempt.nativeCleanupConfirmed,true);assert.equal(current.canRetry,true);assert.deepEqual(h.calls,{worker:0,goal:0});
});
