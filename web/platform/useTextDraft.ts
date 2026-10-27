import {useCallback,useSyncExternalStore} from 'react';
import {textDrafts} from './drafts';

const drafts=textDrafts(()=>typeof window==='undefined'?undefined:window.sessionStorage);
export function useTextDraft(scope:string):[string,(value:string)=>void,(expected:string)=>void] {
  const subscribe=useCallback((listener:()=>void)=>drafts.subscribe(scope,listener),[scope]);
  const read=useCallback(()=>drafts.read(scope),[scope]);
  const value=useSyncExternalStore(subscribe,read,()=> '');
  const set=useCallback((text:string)=>drafts.write(scope,text),[scope]);
  const clear=useCallback((expected:string)=>{drafts.clear(scope,expected);},[scope]);
  return [value,set,clear];
}
