import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import test from 'node:test';
import type {TestContext} from 'node:test';
import sharp from 'sharp';
import {Attachments,attachmentDigest} from '../src/attachments.ts';
import {ATTACHMENT_FILE_LIMIT,ATTACHMENT_TOTAL_LIMIT} from '../src/attachment-types.ts';
import type {Actor,GoalAttachment,Intake,Run} from '../src/contracts.ts';
import type {CodexAdapter,CodexExecutionInput,CodexGoalInput,GithubAdapter} from '../src/adapters/types.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';

const owner:Actor={kind:'human',name:'Synthetic attachment owner'};
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;
async function fixture(t:TestContext,projectLocalState=false){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-attachment-')),workspace=path.join(directory,'workspace');await mkdir(workspace);
  execFileSync('git',['init','--quiet',workspace]);await writeFile(path.join(workspace,'.gitignore'),'.local/\n');
  const calls:CodexExecutionInput[]=[],codex:CodexAdapter={info:async()=>({available:true,connected:true,authenticated:true,models:[]}),skills:async()=>[],start:async input=>{calls.push(input);return{ref:{threadId:'synthetic-input-read'},completion:Promise.resolve({output:{outcome:'done',summary:'Synthetic adapter completed; no provider was called.',artifacts:[],observations:[]},usage:{input:0,output:0,total:0}})};},steer:async()=>{},interrupt:async()=>{},close:async()=>{}};
  const store=new Store(projectLocalState?path.join(workspace,'.local','state'):path.join(directory,'state')),engine=new Engine(store,codex,{} as GithubAdapter),attachments=engine.attachments;
  const project=await engine.createProject({name:'Authored attachment project',workspace},owner),other=await engine.createProject({name:'Other authored project',workspace},owner);
  t.after(async()=>{await engine.close();await rm(directory,{recursive:true,force:true});});
  const upload=(name:string,bytes:Buffer,key:string=randomUUID(),projectId=project.id)=>attachments.upload(projectId,{key,draft:'synthetic-draft',name,bytes},owner);
  return{directory,workspace,store,engine,attachments,project,other,upload,calls};
}

test('uploads are durable and idempotent with server digests, metadata conflicts and project ownership',async t=>{
  const h=await fixture(t),key=randomUUID(),bytes=Buffer.from('Independent attachment evidence.');
  const [first,repeat]=await Promise.all([h.upload('证据.txt',bytes,key),h.upload('证据.txt',bytes,key)]);assert.deepEqual(first,repeat);assert.equal(first.sha256,attachmentDigest(bytes));
  assert.deepEqual(h.attachments.receipt(h.project.id,key,owner),first);assert.deepEqual(h.attachments.content(h.project.id,first.id,owner),bytes);
  await assert.rejects(h.upload('different.txt',bytes,key),code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(h.upload('证据.txt',Buffer.from('Different evidence.'),key),code('IDEMPOTENCY_CONFLICT'));
  assert.throws(()=>h.attachments.get(h.other.id,first.id,owner),code('ATTACHMENT_NOT_FOUND'));
  const worker:Actor={name:'Synthetic scoped worker',kind:'agent',projectId:h.project.id,tools:['context.read']};
  assert.deepEqual(h.attachments.content(h.project.id,first.id,worker),bytes);
  assert.throws(()=>h.attachments.content(h.other.id,first.id,worker),code('PROJECT_SCOPE'));
  await assert.rejects(h.attachments.upload(h.project.id,{key:randomUUID(),draft:'draft',name:'extra.txt',bytes},worker),code('OWNER_REQUIRED'));
  assert.throws(()=>h.attachments.get(h.project.id,first.id,{...worker,tools:[]}),code('TOOL_NOT_ALLOWED'));
  await assert.rejects(h.upload('../unsafe.txt',bytes),code('INVALID_ATTACHMENT'));
  const restored=new Attachments(h.store);assert.deepEqual(restored.receipt(h.project.id,key,owner),first);
});

test('previews decode supported raster content and keep active, malformed and binary input inert',async t=>{
  const h=await fixture(t);
  for(const format of ['png','jpeg','gif','webp'] as const){
    const bytes=await sharp({create:{width:3,height:2,channels:3,background:'#426389'}}).toFormat(format).toBuffer(),item=await h.upload('misleading.svg',bytes);
    assert.equal(item.preview.kind,'image');assert.equal(item.mediaType,'image/'+format);const decoded=await sharp(h.attachments.preview(h.project.id,item.id,owner)).metadata();assert.equal(decoded.format,'png');assert.equal(decoded.width,3);
  }
  const active=await h.upload('unsafe.png',Buffer.from('<svg onload="alert(1)"><script>privateExample()</script></svg>'));
  assert.equal(active.mediaType,'text/plain');assert.equal(active.preview.kind,'text');assert.throws(()=>h.attachments.preview(h.project.id,active.id,owner),code('ATTACHMENT_PREVIEW_UNAVAILABLE'));
  const empty=await h.upload('empty.txt',Buffer.alloc(0));assert.deepEqual(empty.preview,{kind:'text',excerpt:'',truncated:false});
  const long=await h.upload('long.txt',Buffer.from('字'.repeat(4001)));assert.equal(long.preview.kind,'text');if(long.preview.kind==='text'){assert.equal(long.preview.excerpt.length,4000);assert.equal(long.preview.truncated,true);}
  for(const bytes of [Buffer.from([0xff,0xfe,0x12]),Buffer.from('%PDF-1.7\nSynthetic.'),Buffer.from('PK\x03\x04Synthetic.')]){const item=await h.upload('binary.dat',bytes);assert.equal(item.preview.kind,'file');assert.deepEqual(h.attachments.content(h.project.id,item.id,owner),bytes);}
  const malformed=await h.upload('broken.png',Buffer.from([137,80,78,71,13,10,26,10]));assert.deepEqual(malformed.preview,{kind:'file',reason:'decode_failed'});
  const oversized=await sharp({create:{width:5000,height:4001,channels:3,background:'#ffffff'}}).png().toBuffer(),large=await h.upload('large.png',oversized);assert.equal(large.preview.kind,'file');assert.equal(h.attachments.content(h.project.id,large.id,owner).length,oversized.length);
});

test('actual file and aggregate bytes are enforced across separate uploads and manifests',async t=>{
  const h=await fixture(t),max=Buffer.alloc(ATTACHMENT_FILE_LIMIT),items:GoalAttachment[]=[];
  await assert.rejects(h.upload('over.bin',Buffer.alloc(ATTACHMENT_FILE_LIMIT+1)),code('ATTACHMENT_TOO_LARGE'));
  for(let i=0;i<3;i++)items.push(await h.upload(`part-${i}.bin`,max));
  const remainder=await h.upload('remainder.bin',Buffer.alloc(ATTACHMENT_TOTAL_LIMIT-3*ATTACHMENT_FILE_LIMIT));items.push(remainder);
  assert.equal(h.attachments.pin(h.project.id,items.map(item=>item.id)).reduce((sum,item)=>sum+item.size,0),ATTACHMENT_TOTAL_LIMIT);
  const extra=await h.upload('extra.txt',Buffer.from('x'));
  assert.throws(()=>h.attachments.pin(h.project.id,[...items.map(item=>item.id),extra.id]),code('ATTACHMENT_TOTAL_TOO_LARGE'));
  await assert.rejects(h.attachments.upload(h.project.id,{key:randomUUID(),draft:'batch',name:'extra.txt',bytes:Buffer.from('x'),selectedIds:items.map(item=>item.id)},owner),code('ATTACHMENT_TOTAL_TOO_LARGE'));
  assert.throws(()=>h.attachments.pin(h.project.id,[extra.id,extra.id]),code('INVALID_ATTACHMENTS'));
});

test('missing, corrupt and symlinked originals block handoff; private copies never use filenames',async t=>{
  const h=await fixture(t),bytes=Buffer.from('Exact private bytes.'),item=await h.upload('instruction.txt',bytes),original=path.join(h.directory,'state','attachments',h.project.id,item.id,'original');
  const prompt=await h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','synthetic-attempt'),manifest=JSON.parse(prompt.split('Attached input manifest:\n')[1]);
  assert.equal(manifest[0].sha256,item.sha256);assert.equal(path.basename(manifest[0].path),item.id);assert.deepEqual(await readFile(manifest[0].path),bytes);assert.match(prompt,/untrusted task data/);
  await writeFile(original,'Corrupt bytes.');await assert.rejects(h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','later-attempt'),code('ATTACHMENT_CORRUPT'));
  await rm(original);await symlink(path.join(h.workspace,'.gitignore'),original);assert.throws(()=>h.attachments.content(h.project.id,item.id,owner),code('ATTACHMENT_UNSAFE_PATH'));
  await rm(original);await writeFile(original,bytes);
  const otherWorkspace=path.join(h.directory,'without-ignore');await mkdir(otherWorkspace);execFileSync('git',['init','--quiet',otherWorkspace]);
  const otherPrompt=await h.attachments.handoff(h.project.id,[item],otherWorkspace,'synthetic-run','new-attempt'),otherManifest=JSON.parse(otherPrompt.split('Attached input manifest:\n')[1]);assert.notEqual(otherManifest[0].path,manifest[0].path);
  assert.ok(!manifest[0].path.startsWith(await realpath(h.workspace)+path.sep));assert.ok(manifest[0].path.startsWith(path.join(await realpath(h.store.directory),'attachment-inputs',h.project.id)+path.sep));
  const malicious=path.join(path.dirname(path.dirname(manifest[0].path)),'symlink-attempt');await symlink(h.directory,malicious);
  await assert.rejects(h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','symlink-attempt'),code('ATTACHMENT_UNSAFE_PATH'));
});

test('a worker parent replacement between inspection and write cannot redirect host handoff bytes',async t=>{
  const h=await fixture(t),bytes=Buffer.from('Only harmless synthetic handoff bytes.'),item=await h.upload('note.txt',bytes),outside=path.join(h.directory,'synthetic-outside');await mkdir(outside);
  const attack=path.join(h.workspace,'.local','gwi-inputs','synthetic-run','raced-attempt');
  const target=h.attachments as unknown as {directory:(root:string,parts:string[])=>string},directory=target.directory.bind(h.attachments);
  // A controlled worker action at the former check/write boundary, using disposable targets only.
  t.mock.method(target,'directory',(root:string,parts:string[])=>{const folder=directory(root,parts);mkdirSync(path.dirname(attack),{recursive:true});rmSync(attack,{recursive:true,force:true});symlinkSync(outside,attack);return folder;});
  let prompt='',failure:unknown;try{prompt=await h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','raced-attempt');}catch(error){failure=error;}
  assert.deepEqual(await readdir(outside),[],'No host-created file may reach the worker-selected target, even when handoff later rejects.');if(failure)throw failure;
  const manifest=JSON.parse(prompt.split('Attached input manifest:\n')[1]);assert.deepEqual(await readFile(manifest[0].path),bytes);
  const repeated=await h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','raced-attempt');assert.equal(repeated,prompt);
});

test('application state inside a worker writable root blocks before creating handoff copies',async t=>{
  const h=await fixture(t),item=await h.upload('note.txt',Buffer.from('Synthetic scope boundary.'));
  await assert.rejects(h.attachments.handoff(h.project.id,[item],h.directory,'synthetic-run','overlap-attempt'),code('ATTACHMENT_HANDOFF_UNAVAILABLE'));
  await assert.rejects(h.attachments.handoff(h.project.id,[item],h.workspace,'synthetic-run','temporary-root-attempt',{writableRoots:[h.workspace,h.directory]}),code('ATTACHMENT_HANDOFF_UNAVAILABLE'));
  assert.equal((await readdir(h.store.directory)).includes('attachment-inputs'),false);
});

test('a direct run pins input, supplies readable bytes to a model-free adapter and rejects cross-project injection',async t=>{
  const h=await fixture(t),item=await h.upload('synthetic-note.txt',Buffer.from('A precise authored request.'));
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'development'},owner),pipeline=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'inspect',name:'Inspect input',roleId:'development',executor:'codex',dependsOn:[],prompt:'Inspect input.',review:false}]},owner);
  const input={projectId:h.project.id,pipelineId:pipeline.id,goal:'Inspect the attached note.',baseline:'Authored test input.',idempotencyKey:'synthetic-start',attachmentIds:[item.id]};
  const run=h.engine.startRun(input,owner);assert.deepEqual(run.snapshot.attachments,[item]);await immediate();
  assert.equal(h.calls.length,1);const manifest=JSON.parse(h.calls[0].prompt.split('Attached input manifest:\n')[1]);assert.equal((await readFile(manifest[0].path)).toString(),'A precise authored request.');
  assert.equal(h.engine.startRun(input,owner).id,run.id);assert.equal(h.calls.length,1);
  const other=await h.upload('other.txt',Buffer.from('Other project.'),randomUUID(),h.other.id);
  assert.throws(()=>h.engine.startRun({...input,idempotencyKey:'cross-project',attachmentIds:[other.id]},owner),code('ATTACHMENT_NOT_FOUND'));
  assert.throws(()=>h.engine.startRun({...input,attachmentIds:[]},owner),code('IDEMPOTENCY_CONFLICT'));
});

test('native Intake coordination reads synthetic attachments with ordinary project-local private state',async t=>{
  const h=await fixture(t,true),bytes=Buffer.from('Synthetic native coordination evidence.'),item=await h.upload('coordination.txt',bytes),goals:CodexGoalInput[]=[],seen:Buffer[]=[];
  let finished!:()=>void;const adapterFinished=new Promise<void>(resolve=>{finished=resolve;});
  h.engine.codex.startGoal=async input=>{
    try{
      goals.push(input);const manifest=JSON.parse(input.prompt.split('Attached input manifest:\n')[1]);seen.push(await readFile(manifest[0].path));
      await input.onTool!('intake.route',{action:'answer',response:'Synthetic adapter read the authored input; no provider was called.',rationale:'Model-free native handoff regression.',expectedGain:'Check the actual Intake path.',tasks:[]});
      return{ref:{threadId:'synthetic-native-attachment-goal'},completion:Promise.resolve({status:'complete' as const,summary:'Model-free native coordination completed.'})};
    }finally{finished();}
  };
  const intakes=new IntakeService(h.engine),input={request:'Read the attached coordination note.',attachmentIds:[item.id],idempotencyKey:'synthetic-native-intake'},created=await intakes.createWithAccount(h.project.id,input,owner);await immediate();await immediate();
  assert.equal(goals.length,1,intakes.list(h.project.id).find(goal=>goal.id===created.id)?.error);await adapterFinished;await immediate();
  const current=intakes.list(h.project.id).find(goal=>goal.id===created.id)!;
  assert.equal(goals.length,1,current.error);assert.equal(goals[0].workspace,h.project.workspace);assert.equal(goals[0].role.sandbox,'read-only');assert.deepEqual(seen,[bytes]);assert.equal(current.status,'completed',current.error);
  assert.deepEqual(h.engine.run(current.routerRunId).snapshot.attachments,[item]);assert.equal(intakes.create(h.project.id,input,owner).id,current.id);assert.equal(goals.length,1);
});

test('native Engine handoff honors the frozen role with project-local state and no external executor',async t=>{
  for(const writable of [false,true])await t.test(writable?'writable stage needs an independent boundary':'read-only stage receives its input',async sub=>{
    const h=await fixture(sub,true),item=await h.upload('stage.txt',Buffer.from('Synthetic native stage input.')),roleId=writable?'development':'lead';
    const base=h.engine.createPipeline({projectId:h.project.id,roleId},owner),flow=h.engine.updatePipeline(base.id,base.revision,{...base,stages:[{id:'inspect',name:'Native handoff',roleId,executor:'codex',dependsOn:[],prompt:'Read the supplied input.',review:false}]},owner);
    const run=h.engine.startRun({projectId:h.project.id,pipelineId:flow.id,goal:'Inspect synthetic input.',baseline:'Authored context.',idempotencyKey:'synthetic-native-stage',attachmentIds:[item.id]},owner);await immediate();
    const current=h.engine.run(run.id);
    if(writable){assert.equal(h.calls.length,0);assert.equal(current.status,'failed');assert.equal(current.stages[0].attempts[0].nativeDispatchState,'not_dispatched');assert.match(current.stages[0].attempts[0].error!,/GWI_DATA_DIR|independent private directory/);}
    else{assert.equal(h.calls.length,1,current.stages[0].attempts[0].error);assert.equal(h.calls[0].role.sandbox,'read-only');const manifest=JSON.parse(h.calls[0].prompt.split('Attached input manifest:\n')[1]);assert.equal((await readFile(manifest[0].path)).toString(),'Synthetic native stage input.');}
    assert.deepEqual(current.snapshot.attachments,[item]);assert.equal(h.engine.agentExecutor,undefined);
  });
});

test('stage continuation pins supplements only to the affected attempt, with a durable idempotent receipt',async t=>{
  const h=await fixture(t);t.mock.method(h.engine,'tick',async()=>{});
  const initial=h.engine.createPipeline({projectId:h.project.id,roleId:'development'},owner),pipeline=h.engine.updatePipeline(initial.id,initial.revision,{...initial,stages:[{id:'first',name:'Accepted',roleId:'development',executor:'manual',dependsOn:[],prompt:'Keep output.',review:false},{id:'second',name:'Failed',roleId:'development',executor:'manual',dependsOn:['first'],prompt:'Continue here.',review:false}]},owner);
  const original=await h.upload('original.txt',Buffer.from('Original.')),supplement=await h.upload('additional.txt',Buffer.from('New finding.'));
  const run=h.engine.startRun({projectId:h.project.id,pipelineId:pipeline.id,goal:'Inspect evidence.',baseline:'Authored input.',attachmentIds:[original.id],idempotencyKey:'synthetic-original'},owner);
  const ended=new Date().toISOString();run.status='failed';run.stages[0]={stageId:'first',status:'completed',attempts:[{id:'accepted',number:1,iteration:1,status:'completed',startedAt:ended,endedAt:ended}]};run.stages[1]={stageId:'second',status:'failed',attempts:[{id:'failed',number:1,iteration:1,status:'failed',startedAt:ended,endedAt:ended}]};h.store.put('run',run);
  const input={stageId:'second',attemptId:'failed',controlRevision:0,idempotencyKey:'synthetic-continue',note:'Use the new finding.',attachmentIds:[supplement.id]},result=await h.engine.resolveWaiting(run.id,input,owner);
  assert.equal(result.status,'continued');assert.deepEqual(h.engine.run(run.id).snapshot,run.snapshot);assert.deepEqual(h.engine.run(run.id).stages[0],run.stages[0]);assert.equal(h.engine.run(run.id).stages[1].attempts[0].attachments,undefined);
  assert.deepEqual(h.attachments.forStage(h.engine.run(run.id),'second'),[original,supplement]);assert.deepEqual(h.attachments.forStage(h.engine.run(run.id),'first'),[original]);
  assert.deepEqual(await h.engine.resolveWaiting(run.id,input,owner),result);
  await assert.rejects(h.engine.resolveWaiting(run.id,{...input,attachmentIds:[]},owner),code('IDEMPOTENCY_CONFLICT'));
});

test('later-stage continuation supplements reach tool-started children with server-bound ancestry',async t=>{
  const h=await fixture(t),tick=t.mock.method(h.engine,'tick',async()=>{});
  const project=await h.engine.updateProject(h.project.id,h.project.revision,{...h.project,roles:h.project.roles.map(role=>role.id==='development'?{...role,tools:[...role.tools,'run.start']}:role)},owner);
  const childBase=h.engine.createPipeline({projectId:project.id,roleId:'development'},owner),childFlow=h.engine.updatePipeline(childBase.id,childBase.revision,{...childBase,stages:[{id:'child',name:'Child manual work',roleId:'development',executor:'manual',dependsOn:[],prompt:'Read the submitted files.',review:false}]},owner);
  const parentBase=h.engine.createPipeline({projectId:project.id,roleId:'development'},owner),parentFlow=h.engine.updatePipeline(parentBase.id,parentBase.revision,{...parentBase,stages:[{id:'first',name:'Accepted',roleId:'development',executor:'manual',dependsOn:[],prompt:'Keep output.',review:false},{id:'later',name:'Continued coordinator',roleId:'development',executor:'codex',dependsOn:['first'],prompt:'Delegate the continued work.',review:false}]},owner);
  const original=await h.upload('original.txt',Buffer.from('Original task data.')),supplement=await h.upload('supplement.txt',Buffer.from('Later-stage continuation evidence.'));
  const parent=h.engine.startRun({projectId:project.id,pipelineId:parentFlow.id,goal:'Delegate the attached task.',baseline:'Authored context.',idempotencyKey:'synthetic-parent',attachmentIds:[original.id]},owner),ended=new Date().toISOString();
  parent.status='failed';parent.stages[0]={stageId:'first',status:'completed',attempts:[{id:'accepted',number:1,iteration:1,status:'completed',startedAt:ended,endedAt:ended}]};parent.stages[1]={stageId:'later',status:'failed',attempts:[{id:'failed',number:1,iteration:1,status:'failed',startedAt:ended,endedAt:ended}]};h.store.put('run',parent);
  const continued=await h.engine.resolveWaiting(parent.id,{stageId:'later',attemptId:'failed',controlRevision:0,idempotencyKey:'synthetic-later-continue',attachmentIds:[supplement.id]},owner);assert.equal(continued.status,'continued');
  const children:Run[]=[];let toolError:unknown,finished!:()=>void;const toolsFinished=new Promise<void>(resolve=>{finished=resolve;});
  t.mock.method(h.engine.codex,'start',async(input:CodexExecutionInput)=>{
    h.calls.push(input);
    try{
      for(const [index,ancestry] of [{},{parentStageId:'first',parentRunId:'caller-forged-parent'}].entries())children.push(await input.onTool!('run.start',{...ancestry,pipelineId:childFlow.id,goal:'Use the continued input.',baseline:'Authored child context.',idempotencyKey:'synthetic-tool-child-'+index}) as Run);
      await assert.rejects(input.onTool!('run.start',{projectId:h.other.id,pipelineId:childFlow.id,goal:'Cross project.',baseline:'Synthetic.',idempotencyKey:'synthetic-forbidden-child'}),code('PROJECT_SCOPE'));
    }catch(error){toolError=error;}finally{finished();}
    return{ref:{threadId:'synthetic-tool-parent'},completion:Promise.resolve({output:{outcome:'done' as const,summary:'Model-free control callback check.',artifacts:[],observations:[]}})};
  });
  tick.mock.restore();await h.engine.tick();await toolsFinished;if(toolError)throw toolError;
  assert.equal(children.length,2);
  for(const child of children){assert.equal(child.parentRunId,parent.id);assert.equal(child.parentStageId,'later');assert.deepEqual(child.snapshot.attachments,[original,supplement]);}
  assert.deepEqual(h.engine.run(parent.id).snapshot,parent.snapshot);assert.deepEqual(h.engine.run(parent.id).stages[0],parent.stages[0]);assert.equal(h.engine.run(parent.id).stages[1].attempts[0].attachments,undefined);
  assert.equal(h.calls[0].role.sandbox,project.roles.find(role=>role.id==='development')!.sandbox);
});

test('goals, clarification, follow-up and recovery receipts retain exact frozen manifests',async t=>{
  const h=await fixture(t),seen:GoalAttachment[][]=[];let calls=0;
  h.engine.goalPlanner={start:async input=>{calls++;seen.push(input.attachments??[]);h.store.put('multica-execution',{id:'synthetic-planner-'+calls,projectId:input.project.id,runId:input.executionId,stageId:'decision-1',taskId:'synthetic-task-'+calls,issueId:'synthetic-planner-'+calls,status:'completed',cleanupConfirmed:true});return{ref:{provider:'multica',issueId:'synthetic-planner-'+calls},completion:Promise.resolve({decision:{action:'clarify',rationale:'Synthetic clarification.',expectedGain:'Inspect the next material.',question:'Which reference?',tasks:[]},usage:{input:0,output:0,total:0}})};}};
  const intakes=new IntakeService(h.engine),original=await h.upload('request.txt',Buffer.from('Original context.')),extra=await h.upload('reply.txt',Buffer.from('Clarification data.'));
  const created=intakes.create(h.project.id,{request:'Inspect synthetic input.',attachmentIds:[original.id],idempotencyKey:'synthetic-intake'},owner);await immediate();
  const goal=intakes.list(h.project.id).find(item=>item.id===created.id)!;assert.equal(goal.status,'clarification',goal.error);assert.deepEqual(seen[0],[original]);
  const before=structuredClone(h.engine.run(goal.routerRunId).snapshot),input={note:'Use the extra material.',attachmentIds:[extra.id],idempotencyKey:'synthetic-reply',recoveryKey:goal.recoveryKey};
  const [receipt,repeat]=await Promise.all([intakes.retry(goal.id,input,owner),intakes.retry(goal.id,input,owner)]);await immediate();assert.deepEqual(receipt,repeat);assert.deepEqual(await intakes.retry(goal.id,input,owner),receipt);assert.equal(calls,2);
  assert.deepEqual(h.engine.run(goal.routerRunId).snapshot,before);assert.deepEqual(h.engine.run(receipt.routerRunId).snapshot.attachments,[original,extra]);assert.deepEqual(h.store.get<Intake>('intake',goal.id)?.recoveryHistory?.at(-1)?.attachments,[extra]);
  assert.deepEqual(h.store.get<{document:{attachments:GoalAttachment[]}}>('intake-basis-revision',goal.id+'@1')?.document.attachments,[original]);assert.equal(receipt.basisRevision,2);
  await assert.rejects(intakes.retry(goal.id,{...input,attachmentIds:[]},owner),code('IDEMPOTENCY_CONFLICT'));
  const parent=h.store.get<Intake>('intake',goal.id)!;parent.status='completed';parent.outcome='Synthetic accepted answer.';h.store.put('intake',parent);
  const child=intakes.create(h.project.id,{request:'Follow up on this synthetic context.',parentIntakeId:parent.id,idempotencyKey:'synthetic-followup'},owner);await immediate();assert.deepEqual(h.engine.run(child.routerRunId).snapshot.attachments,[original,extra]);assert.equal(child.parentIntakeId,parent.id);
  assert.deepEqual(h.store.get<Intake>('intake',goal.id)?.attachments,[original]);
});

test('ordinary goal recovery records its attachments once and supplies them to the next coordinator',async t=>{
  const h=await fixture(t);let calls=0;
  h.engine.goalPlanner={start:async input=>{calls++;const identity='synthetic-recovery-'+calls;h.store.put('multica-execution',{id:identity,projectId:h.project.id,runId:input.executionId,stageId:'decision-1',taskId:identity,issueId:identity,status:'completed',cleanupConfirmed:true});return{ref:{provider:'multica',issueId:identity},completion:Promise.resolve({decision:{action:'answer',response:'Synthetic model-free result.',rationale:'Authored result.',expectedGain:'Retain the input.',tasks:[]},usage:{input:0,output:0,total:0}})};}};
  const intakes=new IntakeService(h.engine),goal=intakes.create(h.project.id,{request:'Inspect synthetic recovery.',idempotencyKey:'synthetic-recovery-goal'},owner);await immediate();
  const failed=h.store.get<Intake>('intake',goal.id)!;failed.status='failed';delete failed.outcome;h.store.put('intake',failed);
  const item=await h.upload('recovery.txt',Buffer.from('Keep the earlier accepted material.')),current=intakes.list(h.project.id)[0],input={note:'Read the retained supplement.',attachmentIds:[item.id],idempotencyKey:'synthetic-recovery-input',recoveryKey:current.recoveryKey};
  const receipt=intakes.continueWork(goal.id,owner,input);assert.deepEqual(intakes.continueWork(goal.id,owner,input),receipt);assert.equal(receipt.workRecoveryHistory?.length,1);assert.deepEqual(receipt.workRecoveryHistory?.[0].attachments,[item]);
  assert.throws(()=>intakes.continueWork(goal.id,owner,{...input,note:'Different continuation.'}),code('IDEMPOTENCY_CONFLICT'));
  await immediate();const continued=intakes.list(h.project.id)[0];assert.notEqual(continued.routerRunId,goal.routerRunId);assert.deepEqual(h.engine.run(continued.routerRunId).snapshot.attachments,[item]);assert.equal(calls,2);
});

test('receipt reconciliation survives a missing original while new work still blocks and exact reselection restores it',async t=>{
  const h=await fixture(t),key='synthetic-restoration-key',bytes=Buffer.from('Restore only these exact bytes.'),item=await h.upload('restore.txt',bytes,key);
  const pipeline=h.engine.createPipeline({projectId:h.project.id,roleId:'development'},owner);t.mock.method(h.engine,'tick',async()=>{});
  const input={projectId:h.project.id,pipelineId:pipeline.id,goal:'Retain the accepted upload.',baseline:'Authored receipt.',idempotencyKey:'synthetic-retained-receipt',attachmentIds:[item.id]},run=h.engine.startRun(input,owner),original=path.join(h.directory,'state','attachments',h.project.id,item.id,'original');
  await rm(original);assert.equal(h.engine.startRun(input,owner).id,run.id);assert.throws(()=>h.engine.startRun({...input,idempotencyKey:'new-work'},owner),code('ATTACHMENT_MISSING'));
  assert.deepEqual(await h.upload('restore.txt',bytes,key),item);assert.deepEqual(h.attachments.content(h.project.id,item.id,owner),bytes);
});
