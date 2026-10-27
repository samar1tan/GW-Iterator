import assert from 'node:assert/strict';
import test from 'node:test';
import {requestEnterAction} from '../web/platform/requestKeys.ts';

test('ordinary Enter sends, while Shift+Enter and Alt+Enter retain native editing',()=>{
  for(const modifiers of [{},{ctrlKey:true},{metaKey:true}])assert.equal(requestEnterAction({key:'Enter',...modifiers}),'submit');
  for(const modifiers of [{shiftKey:true},{shiftKey:true,ctrlKey:true},{shiftKey:true,metaKey:true},{altKey:true}])assert.equal(requestEnterAction({key:'Enter',...modifiers}),'native');
  assert.equal(requestEnterAction({key:'a'}),'native');
});

test('composition confirmation remains native and held Enter cannot submit repeatedly',()=>{
  assert.equal(requestEnterAction({key:'Enter',isComposing:true}),'native');
  assert.equal(requestEnterAction({key:'Enter',keyCode:229,isComposing:false}),'native');
  assert.equal(requestEnterAction({key:'Enter'},true),'native');
  assert.equal(requestEnterAction({key:'Process',keyCode:229}),'native');
  assert.equal(requestEnterAction({key:'Enter',repeat:true}),'suppress');
  assert.equal(requestEnterAction({key:'Enter',repeat:true,isComposing:true}),'native');
  assert.equal(requestEnterAction({key:'Enter',repeat:true,shiftKey:true}),'native');
  assert.equal(requestEnterAction({key:'Enter'}),'submit');
});
