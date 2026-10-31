import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {Engine} from '../src/engine.ts';
import {Store} from '../src/store.ts';
import {Workspaces} from '../src/workspaces.ts';
import {defaultRoles} from '../src/defaults.ts';
import {DeliveryReviewService} from '../src/delivery-review.ts';
import type {DeliveryRequest} from '../src/delivery-review.ts';
import type {Pipeline,Project,Run,TaskOutput} from '../src/contracts.ts';
import type {AgentExecutionInput,CodexAdapter,GithubAdapter} from '../src/adapters/types.ts';

const execute=promisify(execFile),at='2026-01-01T00:00:00Z',OWNER={name:'Synthetic review owner',kind:'human' as const},AGENT={name:'Synthetic technical reviewer',kind:'agent' as const};
const output:TaskOutput={outcome:'done',summary:'Synthetic prepared behavior.',artifacts:[{label:'Synthetic new source',path:'new-feature.ts'}],observations:['One independent synthetic check was reported; publication remains unobserved.']};
const code=(value:string)=>(error:unknown)=>(error as {code?:string}).code===value;
async function fixture(t:TestContext,ownerGate=true){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-delivery-review-')),workspace=path.join(directory,'source');await mkdir(workspace);
  await writeFile(path.join(workspace,'existing.txt'),'Synthetic committed input.\n');await writeFile(path.join(workspace,'deleted.txt'),'Synthetic deleted input.\n');
  await execute('git',['init',workspace]);await execute('git',['-C',workspace,'add','.']);await execute('git',['-C',workspace,'-c','user.name=Synthetic review','-c','user.email=review@example.invalid','commit','-m','Synthetic committed input']);
  const store=new Store(path.join(directory,'state')),codex={close:async()=>{},info:async()=>({available:true,connected:true,authenticated:true,models:[{id:'synthetic-model',name:'Synthetic',efforts:['max']}]})} as unknown as CodexAdapter,engine=new Engine(store,codex,{} as GithubAdapter),workspaces=new Workspaces(store,path.join(directory,'executions'));
  const calls:{input:AgentExecutionInput;finish:(value:TaskOutput)=>void}[]=[];
  engine.agentExecutor={start:async input=>{let finish!:(value:TaskOutput)=>void;const completion=new Promise<{output:TaskOutput}>((resolve,reject)=>{finish=output=>resolve({output});input.signal.addEventListener('abort',()=>reject(new Error('Synthetic stopped preparation.')),{once:true});});calls.push({input,finish});return{ref:{provider:'multica'},completion};},steer:async()=>{}};
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  const project:Project={id:'synthetic-project',revision:1,name:'Synthetic delivery',description:'Independently authored review fixture.',workspace,repository:'synthetic/review',roles:defaultRoles().map(role=>({...role,model:'synthetic-model'})),knowledgeSources:[],createdAt:at,updatedAt:at};
  const role=project.roles.find(role=>role.id==='lead')!;role.tools.push('run.start','knowledge.write','pipeline.write','browser.use');role.browser={origins:['http://127.0.0.1:4567']};role.skills=[{name:'synthetic-write-skill',path:workspace}];role.multica={skillIds:['synthetic-write-skill'],mcpServerIds:['synthetic-write-server']};store.put('project',project);
  const pipeline:Pipeline={id:'synthetic-flow',projectId:project.id,revision:1,name:'Synthetic legacy delivery',description:'A frozen workflow with no packaging step.',roleId:'lead',policy:{},updatedAt:at,stages:[{id:'implement',name:'Prepared implementation',roleId:'development',executor:'codex',dependsOn:[],prompt:'Prepare the actual synthetic input.',review:false},{id:'verify',name:'Independent QA',roleId:'qa',executor:'codex',executionPurpose:'review',dependsOn:['implement'],prompt:'Check synthetic input.',review:false},{id:'delivery',name:'Delivery decision',roleId:'lead',executor:'manual',dependsOn:['verify'],prompt:'Inspect actual evidence before deciding.',review:false,...(ownerGate?{ownerGate:true}:{}),reworkTo:'implement'}]};store.put('pipeline',pipeline);
  const run:Run={id:'synthetic-parent',projectId:project.id,pipelineId:pipeline.id,goal:'Inspect the prepared synthetic change.',baseline:'Committed synthetic input.',trigger:{kind:'human',actor:OWNER.name},status:'waiting',iteration:1,mode:'once',createdAt:at,updatedAt:at,dependsOnRunIds:[],idempotencyKey:'synthetic-parent',inputHash:'synthetic-parent',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:pipeline.stages.map((stage,index)=>({stageId:stage.id,status:index===2?'waiting':'completed',attempts:[{id:'synthetic-attempt-'+stage.id,number:1,iteration:1,status:index===2?'waiting':'completed',startedAt:at,...(index<2?{endedAt:at,output:{...output,summary:index===0?'Prepared source is retained.':'Independent synthetic check passed.'}}:{})}]}))};store.put('run',run);
  const checkout=await workspaces.ensure(project,run.id);await writeFile(path.join(checkout.path,'existing.txt'),'Synthetic candidate changed.\n');await rm(path.join(checkout.path,'deleted.txt'));await writeFile(path.join(checkout.path,'new-feature.ts'),'export const syntheticFeature = true;\n');
  const service=new DeliveryReviewService(engine,{changes:id=>workspaces.changes(id)});
  const request=async(key='synthetic-review-request'):Promise<DeliveryRequest>=>{const bundle=await service.bundle(run.id,'delivery',OWNER);return{idempotencyKey:key,bundleKey:bundle.key,attemptId:'synthetic-attempt-delivery',controlRevision:0};};
  const pump=async(check:()=>boolean)=>{for(let i=0;i<60;i++){await engine.tick();await immediate();if(check())return;}assert.fail('Synthetic delivery did not reach its expected state.');};
  return{directory,workspace,store,engine,workspaces,project,pipeline,run,checkout,service,calls,request,pump};
}

test('a model-free bundle includes new files, deletions, scoped evidence and honest missing publication',async t=>{
  const h=await fixture(t),before=structuredClone(h.run);
  h.store.put('browser-session',{id:'synthetic-attempt-verify',projectId:h.project.id,runId:h.run.id,stageId:'verify',updatedAt:at,screenshot:'/synthetic/private/screenshot.png'});
  h.store.put('browser-session',{id:'foreign-attempt',projectId:'foreign-project',runId:'foreign-run',stageId:'verify',updatedAt:at,screenshot:'/synthetic/private/foreign.png'});
  const bundle=await h.service.bundle(h.run.id,'delivery',OWNER);assert.equal(h.calls.length,0);assert.deepEqual(h.engine.run(h.run.id),before);
  assert.equal(bundle.upstream.length,2);assert.equal(bundle.screenshots.length,1);assert.equal(bundle.screenshots[0].url,'/api/runs/synthetic-parent/browser-evidence/synthetic-attempt-verify');assert.equal(JSON.stringify(bundle).includes('/synthetic/private'),false);
  assert.equal(bundle.source.status,'observed');if(bundle.source.status==='observed'){assert.match(bundle.source.value.diff,/deleted file mode/);assert.deepEqual(bundle.source.value.untracked.map(file=>file.path),['new-feature.ts']);assert.match(bundle.source.value.untracked[0].content!,/syntheticFeature/);assert.ok(bundle.source.value.manifestHash);}
  assert.deepEqual(bundle.publications,[]);assert.ok(bundle.gaps.includes('publication'));
});

test('explicit material preparation pins one protected child without changing accepted work or accepting its parent',async t=>{
  const h=await fixture(t),before=structuredClone(h.run),source=await h.workspaces.changes(h.run.id),input=await h.request();
  const [first,second]=await Promise.all([h.service.prepare(h.run.id,'delivery',input,OWNER),h.service.prepare(h.run.id,'delivery',{...input},OWNER)]);assert.equal(first.id,second.id);
  await h.pump(()=>h.calls.length===1);const child=h.engine.run(first.id),role=h.calls[0].input.role;
  assert.deepEqual(child.reviewSupport?.upstream.map(item=>item.stageId),['implement','verify']);assert.equal(child.reviewSupport?.runId,h.run.id);assert.equal(child.reviewSupport?.sourceManifestHash,source.manifestHash);assert.equal(child.parentRunId,h.run.id);
  assert.equal(role.sandbox,'read-only');assert.deepEqual(role.skills,[]);assert.deepEqual(role.multica?.skillIds,[]);assert.deepEqual(role.multica?.mcpServerIds,[]);assert.equal(role.browser,undefined);assert.deepEqual(role.tools,['context.read','knowledge.search','pipeline.read','run.read']);assert.match(h.calls[0].input.prompt,/Independent synthetic check passed/);
  await assert.rejects(h.calls[0].input.onTool!('run.start',{projectId:h.project.id}),code('TOOL_NOT_ALLOWED'));await assert.rejects(h.calls[0].input.onTool!('knowledge.write',{title:'Forbidden preparation write'}),code('TOOL_NOT_ALLOWED'));
  assert.deepEqual(h.engine.run(h.run.id),before);assert.equal((await h.workspaces.changes(h.run.id)).manifestHash,source.manifestHash);
  h.calls[0].finish({...output,summary:'Review the actual candidate; CI and publication are still missing.'});await h.pump(()=>h.engine.run(child.id).status==='completed');
  const bundle=await h.service.bundle(h.run.id,'delivery',OWNER);assert.equal(bundle.preparations[0].current,true);assert.equal(bundle.preparations[0].status,'completed');assert.deepEqual(h.engine.run(h.run.id),before);
  const again=await h.service.prepare(h.run.id,'delivery',input,OWNER);assert.equal(again.id,child.id);assert.equal(h.calls.length,1);
  const fresh=await h.request('synthetic-new-click');assert.equal((await h.service.prepare(h.run.id,'delivery',fresh,OWNER)).id,child.id);assert.equal(h.calls.length,1);
});

test('real owner acceptance is separate, idempotent and bound to the observed source',async t=>{
  const h=await fixture(t),input={...await h.request(),decision:'accept' as const};
  await assert.rejects(h.service.decide(h.run.id,'delivery',input,AGENT),code('OWNER_REQUIRED'));
  await writeFile(path.join(h.checkout.path,'new-feature.ts'),'export const changedAfterObservation = true;\n');
  await assert.rejects(h.service.decide(h.run.id,'delivery',input,OWNER),code('REVIEW_CONFLICT'));assert.equal(h.engine.run(h.run.id).status,'waiting');assert.equal(h.store.list('delivery-decision').length,0);
  const current={...await h.request('synthetic-current-decision'),decision:'accept' as const};const [one,two]=await Promise.all([h.service.decide(h.run.id,'delivery',current,OWNER),h.service.decide(h.run.id,'delivery',{...current},OWNER)]);
  assert.equal(one.status,'completed');assert.deepEqual(one,two);assert.equal(h.store.list('delivery-decision').length,1);assert.deepEqual(h.engine.run(h.run.id).stages.slice(0,2),h.run.stages.slice(0,2));assert.equal(h.calls.length,0);
  assert.deepEqual(await h.service.decide(h.run.id,'delivery',current,OWNER),one);
  await assert.rejects(h.service.decide(h.run.id,'delivery',{...current,note:'Different decision content.'},OWNER),code('IDEMPOTENCY_CONFLICT'));
});

test('preparation obeys owner scope, active execution and Stop instead of bypassing a human gate',async t=>{
  const h=await fixture(t),input=await h.request();await assert.rejects(h.service.prepare(h.run.id,'delivery',input,AGENT),code('OWNER_REQUIRED'));
  await assert.rejects(h.service.bundle(h.run.id,'delivery',{...AGENT,projectId:'foreign-project'}),code('PROJECT_SCOPE'));
  const child=await h.service.prepare(h.run.id,'delivery',input,OWNER);await h.pump(()=>h.calls.length===1);
  await assert.rejects(h.service.decide(h.run.id,'delivery',{...await h.request('synthetic-during-preparation'),decision:'accept'},OWNER),code('REVIEW_PREPARATION_ACTIVE'));
  await h.engine.cancel(h.run.id,'Stop the synthetic parent delivery.',OWNER);await h.pump(()=>h.engine.run(child.id).status==='cancelled');
  assert.equal(h.calls[0].input.signal.aborted,true);assert.equal(h.engine.run(h.run.id).status,'cancelled');assert.deepEqual(h.engine.run(h.run.id).stages.slice(0,2),h.run.stages.slice(0,2));
  await assert.rejects(h.service.decide(h.run.id,'delivery',{...input,decision:'accept'},OWNER),code('REVIEW_CLOSED'));
});

test('changed candidates make old material stale and missing original source never falls back to project HEAD',async t=>{
  const h=await fixture(t),child=await h.service.prepare(h.run.id,'delivery',await h.request(),OWNER);await h.pump(()=>h.calls.length===1);
  h.calls[0].finish(output);await h.pump(()=>h.engine.run(child.id).status==='completed');
  await writeFile(path.join(h.checkout.path,'new-feature.ts'),'export const newerCandidate = true;\n');assert.equal((await h.service.bundle(h.run.id,'delivery',OWNER)).preparations[0].current,false);
  await rm(h.checkout.path,{recursive:true,force:true});const bundle=await h.service.bundle(h.run.id,'delivery',OWNER);assert.equal(bundle.source.status,'unavailable');
  await assert.rejects(h.service.prepare(h.run.id,'delivery',{...await h.request('synthetic-missing-source')},OWNER),code('REVIEW_SOURCE_UNAVAILABLE'));assert.equal(h.calls.length,1);assert.equal(await readFile(path.join(h.workspace,'existing.txt'),'utf8'),'Synthetic committed input.\n');
});

test('legacy technical manual results remain distinct from explicit owner acceptance',async t=>{
  const h=await fixture(t,false),input={...await h.request(),decision:'accept' as const,note:'Actual synthetic technical review was completed.'};
  await h.service.decide(h.run.id,'delivery',input,AGENT);assert.equal(h.engine.run(h.run.id).status,'completed');const receipt=h.store.list<{actor:{kind:string};bundle:{ownerGate:boolean}}>('delivery-decision')[0];assert.equal(receipt.actor.kind,'agent');assert.equal(receipt.bundle.ownerGate,false);
});

test('candidate commits remain visible against the frozen source baseline',async t=>{
  const h=await fixture(t);await execute('git',['-C',h.checkout.path,'add','-A']);await execute('git',['-C',h.checkout.path,'-c','user.name=Synthetic review','-c','user.email=review@example.invalid','commit','-m','Commit the synthetic candidate']);
  const changes=await h.workspaces.changes(h.run.id);assert.equal(changes.status,'');assert.notEqual(changes.sourceCommit,changes.preparedCommit);assert.match(changes.diff,/syntheticFeature/);assert.match(changes.diff,/deleted file mode/);assert.deepEqual(changes.untracked,[]);
});

test('source changes during a cold publication observation cannot accept an earlier bundle',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id),url='https://github.com/synthetic/review/pull/1';run.stages[1].attempts[0].output!.artifacts.push({label:'Synthetic reported PR',url});h.store.put('run',run);
  const publication={url,status:'observed' as const,headSha:'a'.repeat(40),state:'OPEN',checks:[{name:'Synthetic CI',status:'COMPLETED',conclusion:'SUCCESS'}]};
  const first=new DeliveryReviewService(h.engine,{changes:id=>h.workspaces.changes(id),publication:async()=>publication}),bundle=await first.bundle(h.run.id,'delivery',OWNER);
  let release!:(value:typeof publication)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  const second=new DeliveryReviewService(h.engine,{changes:id=>h.workspaces.changes(id),publication:()=>{started();return new Promise(resolve=>{release=resolve;});}});
  const pending=second.decide(h.run.id,'delivery',{idempotencyKey:'synthetic-cold-publication',bundleKey:bundle.key,attemptId:'synthetic-attempt-delivery',controlRevision:0,decision:'accept'},OWNER),rejected=assert.rejects(pending,code('REVIEW_CONFLICT'));
  await ready;await writeFile(path.join(h.checkout.path,'existing.txt'),'Changed while publication was observed.\n');release(publication);await rejected;assert.equal(h.engine.run(h.run.id).status,'waiting');assert.equal(h.store.list('delivery-decision').length,0);
});

test('a terminal preparation with unconfirmed external cleanup blocks another preparation',async t=>{
  const h=await fixture(t),child=await h.service.prepare(h.run.id,'delivery',await h.request(),OWNER);await h.pump(()=>h.calls.length===1);h.calls[0].finish(output);await h.pump(()=>h.engine.run(child.id).status==='completed');
  const failed=h.engine.run(child.id);failed.status='failed';failed.stages[0].status='failed';h.store.put('run',failed);h.store.put('multica-execution',{id:failed.stages[0].attempts[0].id,runId:failed.id,projectId:failed.projectId,stageId:'prepare-review',status:'unknown',cleanupConfirmed:false});
  assert.equal(h.engine.recovery(child.id,'prepare-review').code,'EXTERNAL_RECONCILIATION_REQUIRED');
  await assert.rejects(h.service.prepare(h.run.id,'delivery',{...await h.request('synthetic-after-unknown-cleanup'),note:'Organize one additional concrete finding.'},OWNER),code('REVIEW_PREPARATION_ACTIVE'));assert.equal(h.calls.length,1);assert.equal(h.store.list<Run>('run').filter(run=>run.reviewSupport).length,1);
});

test('pausing the parent blocks new material preparation, including during delayed evidence observation',async t=>{
  const h=await fixture(t),input=await h.request();h.engine.pause(h.run.id,'Pause this synthetic delivery.',OWNER);
  await assert.rejects(h.service.prepare(h.run.id,'delivery',input,OWNER),code('RUN_PAUSED'));assert.equal(h.calls.length,0);h.engine.resume(h.run.id,OWNER);
  let release!:()=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const delayed=new DeliveryReviewService(h.engine,{changes:async id=>{const value=await h.workspaces.changes(id);started();await new Promise<void>(resolve=>{release=resolve;});return value;}});
  const pending=delayed.prepare(h.run.id,'delivery',input,OWNER),rejected=assert.rejects(pending,code('RUN_PAUSED'));await ready;h.engine.pause(h.run.id,'Pause while evidence is being read.',OWNER);release();await rejected;assert.equal(h.calls.length,0);assert.equal(h.store.list<Run>('run').filter(run=>run.reviewSupport).length,0);
});

test('a standalone worker review includes its own result, PR and screenshot and requires its actual candidate',async t=>{
  const h=await fixture(t),run=h.engine.run(h.run.id),stage=run.snapshot.pipeline.stages[0],state=run.stages[0];run.snapshot.pipeline.stages=[{...stage,review:true}];run.stages=[{...state,status:'review'}];run.status='review';run.stages[0].attempts[0].output={...output,artifacts:[{label:'Synthetic current PR',url:'https://github.com/synthetic/review/pull/2'}]};h.store.put('run',run);
  h.store.put('browser-session',{id:run.stages[0].attempts[0].id,projectId:run.projectId,runId:run.id,stageId:stage.id,updatedAt:at,screenshot:'/synthetic/private/subject.png'});
  let observations=0;const service=new DeliveryReviewService(h.engine,{changes:id=>h.workspaces.changes(id),publication:async(_repo,url)=>{observations++;return{url,status:'observed',headSha:'c'.repeat(40)};}}),bundle=await service.bundle(run.id,stage.id,OWNER);
  assert.equal(bundle.upstream.length,0);assert.equal(bundle.subject?.output?.artifacts[0].url,'https://github.com/synthetic/review/pull/2');assert.equal(bundle.artifacts.length,1);assert.equal(bundle.screenshots.length,1);assert.equal(bundle.publications.length,1);assert.equal(observations,1);assert.equal(bundle.sourceRequired,true);
  const child=await service.prepare(run.id,stage.id,{idempotencyKey:'synthetic-subject-preparation',bundleKey:bundle.key,attemptId:state.attempts[0].id,controlRevision:0},OWNER);await h.pump(()=>h.calls.length===1);assert.equal(child.reviewSupport?.upstream[0].output?.artifacts[0].url,'https://github.com/synthetic/review/pull/2');h.calls[0].finish(output);await h.pump(()=>h.engine.run(child.id).status==='completed');
  await rm(h.checkout.path,{recursive:true,force:true});const missing=await service.bundle(run.id,stage.id,OWNER);await assert.rejects(service.decide(run.id,stage.id,{idempotencyKey:'synthetic-missing-subject',bundleKey:missing.key,attemptId:state.attempts[0].id,controlRevision:0,decision:'accept'},OWNER),code('REVIEW_SOURCE_UNAVAILABLE'));assert.equal(h.engine.run(run.id).status,'review');
});

test('source observation exposes changes hidden by Git index flags without changing that index',async t=>{
  const h=await fixture(t);await execute('git',['-C',h.checkout.path,'add','-A']);await execute('git',['-C',h.checkout.path,'-c','user.name=Synthetic review','-c','user.email=review@example.invalid','commit','-m','Commit synthetic input']);
  await execute('git',['-C',h.checkout.path,'update-index','--assume-unchanged','existing.txt']);await execute('git',['-C',h.checkout.path,'update-index','--skip-worktree','new-feature.ts']);
  await writeFile(path.join(h.checkout.path,'existing.txt'),'A hidden candidate edit.\n');await writeFile(path.join(h.checkout.path,'new-feature.ts'),'export const hiddenCandidate = true;\n');
  assert.equal((await execute('git',['-C',h.checkout.path,'status','--short'])).stdout,'');const flags=(await execute('git',['-C',h.checkout.path,'ls-files','-v'])).stdout;
  const changes=await h.workspaces.changes(h.run.id);assert.match(changes.status,/existing\.txt/);assert.match(changes.status,/new-feature\.ts/);assert.match(changes.diff,/hidden candidate edit/);assert.match(changes.diff,/hiddenCandidate/);
  assert.equal((await execute('git',['-C',h.checkout.path,'ls-files','-v'])).stdout,flags);
});

test('retained screenshots identify a matched or earlier verification input without inventing capture time',async t=>{
  const h=await fixture(t),source=await h.workspaces.changes(h.run.id);
  h.store.put('browser-session',{id:'synthetic-attempt-verify',projectId:h.project.id,runId:h.run.id,stageId:'verify',updatedAt:at,screenshot:'/synthetic/private/evidence.png'});
  h.store.put('multica-execution',{id:'synthetic-attempt-verify',projectId:h.project.id,runId:h.run.id,verification:{manifestHash:source.manifestHash,check:{unchanged:true}}});
  const first=(await h.service.bundle(h.run.id,'delivery',OWNER)).screenshots[0];assert.equal(first.candidate,'matched');assert.equal(first.screenshotAt,undefined);assert.equal(first.observedAt,at);
  await writeFile(path.join(h.checkout.path,'existing.txt'),'Synthetic source changed after QA.\n');assert.equal((await h.service.bundle(h.run.id,'delivery',OWNER)).screenshots[0].candidate,'earlier');
});

test('manual work with a separate review routes its second decision correctly and retains owner authority',async t=>{
  for(const decision of ['accept','revise'] as const){
    const h=await fixture(t),run=h.engine.run(h.run.id);run.snapshot.pipeline.stages[2].review=true;h.store.put('run',run);
    await h.service.decide(h.run.id,'delivery',{...await h.request('synthetic-first-'+decision),decision:'accept'},OWNER);assert.equal(h.engine.run(h.run.id).stages[2].status,'review');
    assert.throws(()=>h.engine.review(h.run.id,'delivery','accept','Synthetic forbidden agent approval.',AGENT),code('OWNER_REQUIRED'));
    await h.service.decide(h.run.id,'delivery',{...await h.request('synthetic-second-'+decision),decision,note:decision==='revise'?'Synthetic concrete correction is required.':'Synthetic owner reviewed both stages.'},OWNER);
    assert.equal(h.engine.run(h.run.id).stages[2].status,decision==='accept'?'completed':'queued');
  }
});
