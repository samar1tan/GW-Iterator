import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {GoalAttachment} from '../src/contracts.ts';
import {attachmentDrafts,attachmentSelection} from '../web/platform/attachmentDrafts.ts';

const hash=(bytes:ArrayBuffer)=>Promise.resolve(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return{promise,resolve};}
function fixture(){
  const values=new Map<string,string>(),uploads:GoalAttachment[]=[],receipts=new Map<string,GoalAttachment>(),uploadCalls:string[]=[],uploadStarted=deferred(),receiptStarted=deferred();let next=0,fail=false,lose=false,storageFail=false;
  const storage={getItem:(key:string)=>{if(storageFail)throw new Error('Synthetic storage error.');return values.get(key)??null;},setItem:(key:string,value:string)=>{if(storageFail)throw new Error('Synthetic storage error.');values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  let block:Promise<void>|undefined,receiptBlock:Promise<void>|undefined;
  const transport={async upload(projectId:string,_scope:string,key:string,file:File){uploadCalls.push(file.name);uploadStarted.resolve();await block;if(fail)throw{code:'SYNTHETIC_UPLOAD_FAILURE'};const bytes=await file.arrayBuffer(),item:GoalAttachment={id:'synthetic-file-'+uploads.length,projectId,name:file.name,size:file.size,sha256:await hash(bytes),mediaType:'text/plain',preview:{kind:'text',excerpt:'Private preview stays in memory.',truncated:false}};uploads.push(item);receipts.set(key,item);if(lose)throw new Error('Synthetic lost response.');return item;},async receipt(project:string,key:string){receiptStarted.resolve();await receiptBlock;const saved=receipts.get(key);if(!saved||saved.projectId!==project)throw{status:404};return saved;},async check(project:string,id:string){const saved=uploads.find(item=>item.id===id&&item.projectId===project);if(!saved)throw{status:404};return saved;}};
  const make=(digest=hash)=>attachmentDrafts(()=>storage,transport,()=>`synthetic-key-${++next}`,digest),drafts=make();
  return{drafts,make,values,uploads,uploadCalls,uploadStarted,receiptStarted,setFail:(value:boolean)=>{fail=value;},lose:()=>{lose=true;},storageFail:()=>{storageFail=true;},block:(promise:Promise<void>)=>{block=promise;},blockReceipt:(promise:Promise<void>)=>{receiptBlock=promise;}};
}

test('a whole selected batch blocks submission synchronously through a delayed first upload',async()=>{
  const h=fixture(),gate=deferred();h.block(gate.promise);
  const pending=h.drafts.add('a','scope',[new File(['first'],'first.txt'),new File(['second'],'second.txt')]);
  assert.deepEqual(h.drafts.read('scope').items.map(item=>item.name),['first.txt','second.txt']);
  assert.equal(attachmentSelection(h.drafts.read('scope')).blocked,true);
  await h.uploadStarted.promise;
  assert.deepEqual(h.drafts.read('scope').items.map(item=>item.state),['uploading','preparing']);
  gate.resolve();await pending;
  assert.deepEqual(h.uploads.map(item=>item.name),['first.txt','second.txt']);
  assert.equal(attachmentSelection(h.drafts.read('scope')).blocked,false);
});

test('clearing a delayed batch retains a newer draft and never registers its queued files later',async()=>{
  const h=fixture(),gate=deferred();h.block(gate.promise);
  const pending=h.drafts.add('a','scope',[new File(['first'],'first.txt'),new File(['second'],'second.txt')]);
  await h.uploadStarted.promise;
  const old=h.drafts.read('scope');assert.equal(h.drafts.clear('scope',old),true);
  const newer=h.drafts.add('a','scope',[new File(['newer'],'newer.txt')]);
  gate.resolve();await Promise.all([pending,newer]);
  assert.deepEqual(h.drafts.read('scope').items.map(item=>item.name),['newer.txt']);
  assert.deepEqual(h.uploadCalls,['first.txt','newer.txt']);
  for(const item of old.items)assert.equal(h.drafts.hasBytes(item.key),false);
});

test('a queued batch item can be removed before its preparation or upload starts',async()=>{
  const h=fixture(),gate=deferred();h.block(gate.promise);
  const pending=h.drafts.add('a','scope',[new File(['first'],'first.txt'),new File(['second'],'second.txt')]);
  await h.uploadStarted.promise;
  const queued=h.drafts.read('scope').items.find(item=>item.name==='second.txt');assert.ok(queued);
  h.drafts.remove('scope',queued.key);gate.resolve();await pending;
  assert.deepEqual(h.uploadCalls,['first.txt']);assert.equal(h.drafts.hasBytes(queued.key),false);
  assert.equal(attachmentSelection(h.drafts.read('scope')).blocked,false);
});

test('removal during receipt lookup prevents a new upload after a missing receipt',async()=>{
  const h=fixture(),gate=deferred();h.blockReceipt(gate.promise);
  const pending=h.drafts.add('a','scope',[new File(['pending'],'pending.txt')]);
  await h.receiptStarted.promise;h.drafts.remove('scope',h.drafts.read('scope').items[0].key);
  gate.resolve();await pending;assert.deepEqual(h.uploadCalls,[]);assert.equal(h.drafts.read('scope').items.length,0);
});

test('removed or cleared reselection cannot restore bytes after delayed preparation',async()=>{
  for(const action of ['remove','clear']){
    const h=fixture();h.setFail(true);await h.drafts.add('a','scope',[new File(['original'],'note.txt')]);h.setFail(false);
    const started=deferred(),gate=deferred(),restored=h.make(async bytes=>{started.resolve();await gate.promise;return hash(bytes);}),key=restored.read('scope').items[0].key;
    const pending=restored.add('a','scope',[new File(['original'],'note.txt')],key);await started.promise;
    if(action==='remove')restored.remove('scope',key);else assert.equal(restored.clear('scope',restored.read('scope')),true);
    gate.resolve();await pending;
    assert.equal(restored.read('scope').items.length,0);assert.equal(restored.hasBytes(key),false);assert.equal(h.uploadCalls.length,1);
  }
});

test('mixed add, same-name/content deduplication and independent project scopes preserve selection order',async()=>{
  const h=fixture();await h.drafts.add('a','scope-a',[new File(['first'],'同名.txt'),new File(['other'],'同名.txt'),new File(['first'],'同名.txt')]);
  const value=h.drafts.read('scope-a');assert.equal(value.items.length,2);assert.deepEqual(value.items.map(item=>item.ordinal),[1,2]);assert.equal(h.uploads.length,2);assert.equal(attachmentSelection(value).blocked,false);
  assert.equal(h.drafts.read('scope-b').items.length,0);h.drafts.remove('scope-a',value.items[0].key);assert.equal(h.drafts.read('scope-a').items[0].ordinal,2);
  assert.equal(h.drafts.clear('scope-a',value),false,'A late receipt cannot clear a newer selection.');
  assert.equal([...h.values.values()].some(value=>value.includes('Private preview stays in memory.')),false);
});

test('partial failure blocks work, retains ready siblings and reuses an uncertain upload identity',async()=>{
  const h=fixture();await h.drafts.add('a','scope',[new File(['ready'],'ready.txt')]);h.setFail(true);await h.drafts.add('a','scope',[new File(['retry'],'retry.txt')]);
  assert.deepEqual(h.drafts.read('scope').items.map(item=>item.state),['ready','failed']);assert.equal(attachmentSelection(h.drafts.read('scope')).blocked,true);
  h.setFail(false);h.lose();const key=h.drafts.read('scope').items[1].key;await h.drafts.retry('a','scope',key);assert.equal(h.uploads.length,2);assert.equal(h.drafts.read('scope').items[1].state,'failed');
  await h.drafts.retry('a','scope',key);assert.equal(h.uploads.length,2);assert.equal(h.drafts.read('scope').items[1].state,'ready');
});

test('removal while uploading cannot reinsert a file into the same or another draft',async()=>{
  const h=fixture();let release!:()=>void;h.block(new Promise(resolve=>{release=resolve;}));const pending=h.drafts.add('a','scope-a',[new File(['pending'],'pending.txt')]);await Promise.resolve();await Promise.resolve();
  const key=h.drafts.read('scope-a').items[0].key;h.drafts.remove('scope-a',key);release();await pending;
  assert.equal(h.drafts.read('scope-a').items.length,0);assert.equal(h.drafts.read('scope-b').items.length,0);
});

test('reload verifies ready files, interrupts incomplete transfers and reports storage failure',async()=>{
  const h=fixture();await h.drafts.add('a','scope',[new File(['ready'],'ready.txt')]);h.setFail(true);await h.drafts.add('a','scope',[new File(['incomplete'],'incomplete.txt')]);
  const restored=h.make();assert.deepEqual(restored.read('scope').items.map(item=>item.state),['checking','interrupted']);assert.equal(attachmentSelection(restored.read('scope')).blocked,true);await restored.restore('a','scope');assert.equal(restored.read('scope').items[0].state,'ready');assert.equal(restored.hasBytes(restored.read('scope').items[1].key),false);
  h.storageFail();await h.drafts.add('a','new-scope',[new File(['retained'],'retained.txt')]);assert.equal(h.drafts.read('new-scope').storageFailed,true);assert.equal(h.drafts.read('new-scope').items.length,1);
});

test('restored interrupted uploads require the same bytes for the retained identity',async()=>{
  const h=fixture();h.setFail(true);await h.drafts.add('a','scope',[new File(['original'],'note.txt')]);const restored=h.make(),key=restored.read('scope').items[0].key;
  h.setFail(false);await restored.add('a','scope',[new File(['different'],'note.txt')],key);assert.equal(restored.read('scope').items.length,1);assert.equal(restored.read('scope').items[0].state,'interrupted');
  await restored.add('a','scope',[new File(['original'],'note.txt')],key);assert.equal(restored.read('scope').items[0].state,'ready');assert.equal(restored.read('scope').items[0].key,key);
});
