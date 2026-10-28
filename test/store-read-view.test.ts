import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {setImmediate as immediate} from 'node:timers/promises';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {IntakeService} from '../src/intake.ts';
import {defaultRoles} from '../src/defaults.ts';
import type {Intake,Pipeline,Project,Run} from '../src/contracts.ts';
import type {CodexAdapter,GithubAdapter} from '../src/adapters/types.ts';

type Row={id:string;revision:number;state:{status:string;values:string[]}};
const row=(id='synthetic-one',revision=1):Row=>({id,revision,state:{status:'completed',values:['original']}});
const code=(expected:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===expected);
async function fixture(t:TestContext){const directory=await mkdtemp(path.join(tmpdir(),'gwi-read-view-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});return{store,directory};}

test('a read view decodes each row once and shares its kind/id index across nested reads',async t=>{
  const {store}=await fixture(t);store.put('run',row());store.put('run',row('synthetic-two'));store.put('project',row());
  const parse=JSON.parse;let decodes=0;JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{decodes++;return parse(...args);};
  try{
    store.withReadView(()=>{
      const first=store.get<Row>('run','synthetic-one')!;assert.equal(decodes,1);
      const listed=store.list<Row>('run');assert.equal(decodes,2);assert.equal(listed[0],first);
      listed.reverse();assert.deepEqual(store.list<Row>('run').map(value=>value.id),['synthetic-one','synthetic-two']);
      store.withReadView(()=>{assert.equal(store.get('run','synthetic-two'),listed[0]);assert.equal(store.get('run','missing'),null);assert.equal(store.get('run','missing'),null);});
      assert.equal(decodes,2);assert.notEqual(store.get('project','synthetic-one'),first);assert.equal(decodes,3);
    });
    assert.equal(store.get<Row>('run','synthetic-one')!.revision,1);assert.equal(decodes,4);
  }finally{JSON.parse=parse;}
});

test('borrowed records cannot be mutated and array edits cannot poison another observation',async t=>{
  const {store}=await fixture(t);store.put('run',row());
  const observed=store.withReadView(()=>{
    const value=store.list<Row>('run')[0];assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.state));assert.ok(Object.isFrozen(value.state.values));
    assert.throws(()=>{value.state.status='running';},TypeError);assert.throws(()=>value.state.values.push('changed'),TypeError);
    const list=store.list<Row>('run');list.splice(0);assert.equal(store.list('run').length,1);assert.equal(store.get<Row>('run',value.id)!.state.status,'completed');return value;
  });
  assert.throws(()=>{observed.revision=20;},TypeError);
  const fresh=store.get<Row>('run',observed.id)!;assert.notEqual(fresh,observed);fresh.state.values.push('local DTO edit');
  assert.deepEqual(store.withReadView(()=>store.get<Row>('run',observed.id)!.state.values),['original']);
});

test('nested view errors keep the outer observation intact and final exceptions discard the cache',async t=>{
  const {store}=await fixture(t);store.put('run',row());
  assert.throws(()=>store.withReadView(()=>{const before=store.get('run','synthetic-one');assert.throws(()=>store.withReadView(()=>{throw new Error('synthetic inner error');}),/synthetic inner error/);assert.equal(store.get('run','synthetic-one'),before);throw new Error('synthetic outer error');}),/synthetic outer error/);
  store.put('run',row('synthetic-one',2));assert.equal(store.withReadView(()=>store.get<Row>('run','synthetic-one')!.revision),2);
});

test('pure observations reject every Store write without beginning a partial mutation',async t=>{
  const {store}=await fixture(t);store.put('run',row());let transactionCalled=false;
  store.withReadView(()=>{
    for(const write of [()=>store.put('run',row('synthetic-one',2)),()=>store.delete('run','synthetic-one'),()=>store.transaction(()=>{transactionCalled=true;}),()=>store.event({projectId:null,runId:null,stageId:null,type:'synthetic',actor:'Synthetic owner',message:'Synthetic event'}),()=>store.close()])assert.throws(write,code('READ_VIEW_WRITE'));
    assert.equal(store.get<Row>('run','synthetic-one')!.revision,1);assert.equal(store.events().length,0);
  });
  assert.equal(transactionCalled,false);store.put('run',row('synthetic-one',3));assert.equal(store.get<Row>('run','synthetic-one')!.revision,3);
});

test('next views see writes, deletes and rollback while nested read views never commit an outer transaction',async t=>{
  const {store}=await fixture(t);store.put('run',row());store.withReadView(()=>assert.equal(store.get<Row>('run','synthetic-one')!.revision,1));
  store.put('run',row('synthetic-one',2));store.withReadView(()=>assert.equal(store.get<Row>('run','synthetic-one')!.revision,2));
  assert.throws(()=>store.transaction(()=>{store.put('run',row('synthetic-one',3));store.withReadView(()=>assert.equal(store.get<Row>('run','synthetic-one')!.revision,3));store.put('run',row('synthetic-one',4));throw new Error('synthetic rollback');}),/synthetic rollback/);
  store.withReadView(()=>assert.equal(store.get<Row>('run','synthetic-one')!.revision,2));
  store.delete('run','synthetic-one');store.withReadView(()=>{assert.equal(store.get('run','synthetic-one'),null);assert.deepEqual(store.list('run'),[]);});
  store.put('run',row('synthetic-one',5));store.withReadView(()=>assert.equal(store.get<Row>('run','synthetic-one')!.revision,5));
});

test('a second connection cannot mix revisions into an observation and the next view reads its commit',async t=>{
  const {store,directory}=await fixture(t),other=new Store(directory);t.after(()=>other.close());store.put('run',row());
  store.withReadView(()=>{
    assert.equal(store.get<Row>('run','synthetic-one')!.revision,1);assert.equal(store.get('run','synthetic-new'),null);
    other.put('run',row('synthetic-one',2));other.put('run',row('synthetic-new',2));other.put('project',row('synthetic-project',2));
    assert.deepEqual(store.list<Row>('run').map(value=>value.revision),[1]);assert.equal(store.get('project','synthetic-project'),null);
  });
  store.withReadView(()=>{assert.deepEqual(store.list<Row>('run').map(value=>value.revision),[2,2]);assert.equal(store.get<Row>('project','synthetic-project')!.revision,2);});
});

test('async callbacks are rejected before invocation and thenable misuse cannot retain a read scope',async t=>{
  const {store}=await fixture(t);store.put('run',row());let invoked=false,thenCalled=false;
  assert.throws(()=>store.withReadView(async()=>{invoked=true;await immediate();store.delete('run','synthetic-one');}),code('READ_VIEW_ASYNC'));assert.equal(invoked,false);
  assert.throws(()=>store.withReadView(()=>({then(){thenCalled=true;}})),code('READ_VIEW_ASYNC'));assert.equal(thenCalled,false);
  assert.throws(()=>store.withReadView(()=>Promise.reject(new Error('synthetic already started promise'))),code('READ_VIEW_ASYNC'));await immediate();
  store.put('run',row('synthetic-one',2));assert.equal(store.withReadView(()=>store.get<Row>('run','synthetic-one')!.revision),2);
});

test('legacy intake normalization produces a fresh DTO without modifying frozen stored history',async t=>{
  const {store,directory}=await fixture(t),stamp='2026-01-01T00:00:00.000Z';
  const never=async()=>{throw new Error('Synthetic test forbids provider calls.');};
  const codex={start:never,startGoal:never,close:async()=>{}} as unknown as CodexAdapter,github={start:never} as unknown as GithubAdapter,engine=new Engine(store,codex,github),intake=new IntakeService(engine);
  const project:Project={id:'synthetic-project',revision:1,name:'Synthetic project',description:'',workspace:directory,repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:stamp,updatedAt:stamp};
  const pipeline:Pipeline={id:'synthetic-flow',projectId:project.id,revision:1,name:'Synthetic completed work',description:'',roleId:'lead',stages:[{id:'supervise',name:'Synthetic supervisor',roleId:'lead',executor:'codex',dependsOn:[],prompt:'Synthetic historical record.',review:false}],policy:{concurrency:1,maxAttempts:1,maxIterations:1,timeoutSeconds:30,tokenBudget:1000},updatedAt:stamp};
  const run:Run={id:'synthetic-run',projectId:project.id,pipelineId:pipeline.id,executionKind:'native-goal',goal:'Synthetic completed goal',baseline:'',trigger:{kind:'human',actor:'Synthetic owner'},status:'completed',iteration:1,mode:'once',createdAt:stamp,updatedAt:stamp,endedAt:stamp,dependsOnRunIds:[],idempotencyKey:'synthetic-run',inputHash:'synthetic',snapshot:{project,pipeline,pipelines:[pipeline],knowledge:[]},stages:[{stageId:'supervise',status:'completed',attempts:[]}]};
  const goal:Intake={id:'synthetic-goal',projectId:project.id,request:'Synthetic completed goal',baseline:'',status:'completed',createdAt:stamp,updatedAt:stamp,routerRunId:run.id,targetRunIds:[],rounds:[],idempotencyKey:'synthetic-goal',policy:{maxRounds:1,maxParallel:1,maxTotalTokens:1000,maxElapsedSeconds:30}};
  store.put('project',project);store.put('run',run);store.put('intake',goal);
  store.withReadView(()=>{const observed=intake.list(project.id)[0];assert.equal(observed.basisRevision,1);assert.deepEqual(observed.supervisorRunIds,[run.id]);observed.supervisorRunIds!.push('synthetic-local-edit');assert.deepEqual(intake.list(project.id)[0].supervisorRunIds,[run.id]);});
  assert.equal(store.get<Intake>('intake',goal.id)!.basisRevision,undefined);assert.equal(store.get<Intake>('intake',goal.id)!.supervisorRunIds,undefined);
});
