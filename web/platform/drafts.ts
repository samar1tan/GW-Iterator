type DraftStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;

/** Tab-local text only; unavailable browser storage still preserves in-tab navigation. */
export function textDrafts(storage:()=>DraftStorage|undefined) {
  const memory=new Map<string,string>();
  const listeners=new Map<string,Set<()=>void>>();
  const key=(scope:string)=>'gwi.draft.v1.'+scope;
  return {
    read(scope:string):string {
      if(memory.has(scope))return memory.get(scope)!;
      let value='';try{value=storage()?.getItem(key(scope))??'';}catch{}
      memory.set(scope,value);return value;
    },
    write(scope:string,value:string) {
      memory.set(scope,value);
      try{if(value)storage()?.setItem(key(scope),value);else storage()?.removeItem(key(scope));}catch{}
      for(const listener of [...(listeners.get(scope)??[])])listener();
    },
    clear(scope:string,expected:string):boolean {
      if(this.read(scope)!==expected)return false;
      this.write(scope,'');return true;
    },
    subscribe(scope:string,listener:()=>void):()=>void {
      const scoped=listeners.get(scope)??new Set<()=>void>();scoped.add(listener);listeners.set(scope,scoped);
      return()=>{scoped.delete(listener);if(!scoped.size)listeners.delete(scope);};
    },
  };
}
