import test from 'node:test';
import assert from 'node:assert/strict';
import {textDrafts} from '../web/platform/drafts.ts';
import {recordWorkStart,submittedDraftKey} from '../web/platform/workStart.ts';
import {appendedStageContext,freeStagePosition} from '../web/platform/stagePlacement.ts';
import type {Stage} from '../src/contracts.ts';

test('unsent text survives reopening without crossing projects, workflows or attempts',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}};
  const first=textDrafts(()=>storage);
  const scope='outcome:example';
  first.write(scope,'Inspect the guide.\nKeep the existing behavior.');
  assert.equal(first.read('outcome:another'),'');
  assert.equal(first.read('pipeline:example:flow'),'');
  assert.equal(textDrafts(()=>storage).read(scope),'Inspect the guide.\nKeep the existing behavior.');
  first.write('review:run:step:attempt-one','Please verify the actual file.');
  assert.equal(first.read('review:run:step:attempt-two'),'');
  first.write(scope,'');
  assert.equal(textDrafts(()=>storage).read(scope),'');
  assert.equal(first.read('review:run:step:attempt-one'),'Please verify the actual file.');
});

test('unavailable session storage keeps navigation drafts usable without throwing',()=>{
  const drafts=textDrafts(()=>{throw new Error('Storage unavailable')});
  drafts.write('outcome:example','An unsent request');
  assert.equal(drafts.read('outcome:example'),'An unsent request');
  drafts.write('outcome:example','');
  assert.equal(drafts.read('outcome:example'),'');
});

test('a late receipt clears only the submitted text, preserving a newer unsent draft and retry identity',()=>{
  const drafts=textDrafts(()=>undefined);
  drafts.write('outcome:example','Submitted text');
  drafts.write('outcome:example','New unsent text');
  assert.equal(drafts.clear('outcome:example','Submitted text'),false);
  assert.equal(drafts.read('outcome:example'),'New unsent text');
  drafts.write('outcome-key:example','New submission identity');
  assert.equal(drafts.clear('outcome-key:example','Earlier submission identity'),false);
  assert.equal(drafts.clear('outcome:example','New unsent text'),true);
  assert.equal(drafts.read('outcome-key:example'),'New submission identity');
});

test('a remounted field observes a late receipt for its own scope without notifying another project',()=>{
  const drafts=textDrafts(()=>undefined);let observed='',unrelated=0;
  drafts.write('outcome:example','Submitted text');
  const unsubscribe=drafts.subscribe('outcome:example',()=>{observed=drafts.read('outcome:example')});
  const other=drafts.subscribe('outcome:other',()=>{unrelated++});
  assert.equal(drafts.clear('outcome:example','Submitted text'),true);
  assert.equal(observed,'');assert.equal(unrelated,0);
  unsubscribe();other();
});

test('a confirmed start records identity before a failed refresh and does not repeat the write',async()=>{
  const calls:string[]=[];let writes=0;const receipt={id:'recorded-work'};
  const actual=await recordWorkStart(async()=>{writes++;calls.push('write');return receipt},value=>{assert.equal(value,receipt);calls.push('record')},async()=>{calls.push('observe');throw new Error('Observation unavailable')},error=>{assert.match(String(error),/Observation unavailable/);calls.push('observation-error')});
  assert.equal(actual,receipt);
  assert.equal(writes,1);
  assert.deepEqual(calls,['write','record','observe','observation-error']);
});

test('a rejected start retains its draft and has no created identity or observation',async()=>{
  let recorded=false,observed=false;
  await assert.rejects(recordWorkStart(async()=>{throw new Error('Start rejected')},()=>{recorded=true},async()=>{observed=true},()=>assert.fail('No refresh started')),/Start rejected/);
  assert.equal(recorded,false);assert.equal(observed,false);
});

test('a lost start response preserves unchanged retry identity while an edited request is not permanently conflicted',()=>{
  let keys=0;const create=()=>`example-key-${++keys}`;
  const first=submittedDraftKey('Inspect the guide.','',create);
  const persisted=JSON.stringify(first);
  assert.deepEqual(submittedDraftKey('Inspect the guide.',persisted,create),first);
  const edited=submittedDraftKey('Inspect the guide and its links.',persisted,create);
  assert.notEqual(edited.key,first.key);
  assert.deepEqual(submittedDraftKey(edited.request,JSON.stringify(edited),create),edited);
  assert.equal(keys,2);
});

const step=(id:string,x:number,y:number):Stage=>({id,name:id,roleId:'example',executor:'manual',prompt:'Inspect the prepared evidence.',review:false,dependsOn:[],position:{x,y}});
test('new stages follow the selected step and occupy free space without moving existing work',()=>{
  const stages=[step('first',35,35),step('existing-parallel',369,35),step('other',369,357)];
  const before=structuredClone(stages);
  const added=appendedStageContext(stages,'first');
  assert.deepEqual(added.dependsOn,['first']);
  assert.deepEqual(added.position,{x:369,y:679});
  assert.deepEqual(stages,before);
  assert.deepEqual(appendedStageContext(stages).dependsOn,['other']);
  assert.deepEqual(appendedStageContext([]),{dependsOn:[],position:{x:35,y:35}});
  const duplicate=freeStagePosition(stages,{x:35,y:35});
  assert.ok(duplicate.y>=357);
});
