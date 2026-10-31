import assert from 'node:assert/strict';
import test from 'node:test';
import {recordWorkStart} from '../web/platform/workStart.ts';
import {createStageControl} from '../web/platform/stageControl.ts';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('a received write unlocks Stop while its observation is still pending and old errors cannot replace Stop',async()=>{
  const control=createStageControl(),read=deferred<void>(),cancel=deferred<string>();let busy:string|null='rework',receipt='',cancelPosts=0,observationErrors=0;
  const initial=control.begin()!;const repair=recordWorkStart(async()=>'repair accepted',saved=>{receipt=saved;assert.equal(control.release(initial),true);busy=null;},()=>read.promise,()=>{if(control.current(initial))observationErrors++;});
  await Promise.resolve();await Promise.resolve();assert.equal(receipt,'repair accepted');assert.equal(busy,null);assert.equal(control.blocked,false);
  const stopping=control.begin()!;busy='stop';const stop=recordWorkStart(async()=>{cancelPosts++;return cancel.promise;},saved=>{receipt=saved;control.release(stopping,true);busy=null;},async()=>{},()=>{});
  assert.equal(control.begin(),undefined,'A second Stop cannot submit while the first write is pending.');read.reject(new Error('Older observation failed.'));await repair;assert.equal(observationErrors,0);assert.equal(control.release(initial),false,'The older action cannot release the pending Stop.');assert.equal(busy,'stop');
  cancel.resolve('stop accepted');await stop;assert.equal(receipt,'stop accepted');assert.equal(cancelPosts,1);assert.equal(control.begin(),undefined,'A confirmed Stop cannot submit again during a later observation.');
});

test('an unconfirmed Stop releases only its own write and can be explicitly tried again',async()=>{
  const control=createStageControl(),read=deferred<void>();const initial=control.begin()!;let error:unknown=null,cancelPosts=0;
  const repair=recordWorkStart(async()=>'accepted',()=>control.release(initial),()=>read.promise,()=>{});await Promise.resolve();await Promise.resolve();
  const stopping=control.begin()!;try{cancelPosts++;throw new Error('Synthetic cancellation request failed.');}catch(value){if(control.current(stopping))error=value;}finally{control.release(stopping);}
  assert.match(String(error),/cancellation request failed/);assert.equal(control.blocked,false);const retry=control.begin();assert.notEqual(retry,undefined);cancelPosts++;control.release(retry!,true);assert.equal(cancelPosts,2);assert.equal(control.begin(),undefined);
  read.resolve();await repair;assert.equal(control.release(initial),false);assert.equal(control.blocked,true);
});
