import {useCallback,useSyncExternalStore} from 'react';
import {textDrafts} from './drafts';

const drafts=textDrafts(()=>typeof window==='undefined'?undefined:window.sessionStorage);
export function useTextDraft(scope:string):[string,(value:string)=>void,(expected:string,guard?:()=>boolean)=>boolean] {
  const subscribe=useCallback((listener:()=>void)=>drafts.subscribe(scope,listener),[scope]);
  const read=useCallback(()=>drafts.read(scope),[scope]);
  const value=useSyncExternalStore(subscribe,read,()=> '');
  const set=useCallback((text:string)=>drafts.write(scope,text),[scope]);
  const clear=useCallback((expected:string,guard?:()=>boolean)=>{if(drafts.read(scope)!==expected||guard&&!guard())return false;return drafts.clear(scope,expected);},[scope]);
  return [value,set,clear];
}
