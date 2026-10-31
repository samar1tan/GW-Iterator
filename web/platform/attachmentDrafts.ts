import type {GoalAttachment} from '../../src/attachment-types.ts';
import {ATTACHMENT_FILE_LIMIT,ATTACHMENT_TOTAL_LIMIT} from '../../src/attachment-types.ts';

export type AttachmentItem={key:string;name:string;size:number;ordinal:number;state:'preparing'|'uploading'|'checking'|'ready'|'failed'|'interrupted';sha256?:string;attachment?:GoalAttachment;error?:string};
export type AttachmentDraft={items:AttachmentItem[];nextOrdinal:number;storageFailed:boolean};
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Transport={upload:(projectId:string,scope:string,key:string,file:File,selected:string[])=>Promise<GoalAttachment>;receipt:(projectId:string,key:string)=>Promise<GoalAttachment>;check:(projectId:string,id:string)=>Promise<GoalAttachment>};
const empty:AttachmentDraft={items:[],nextOrdinal:1,storageFailed:false};

/** Keep only scoped references in tab storage. File objects never leave this in-tab map. */
export function attachmentDrafts(storage:()=>StorageLike|undefined,transport:Transport,createKey:()=>string,digest:(bytes:ArrayBuffer)=>Promise<string>){
  const memory=new Map<string,AttachmentDraft>(),listeners=new Map<string,Set<()=>void>>(),files=new Map<string,File>(),operations=new Map<string,symbol>();
  const storageKey=(scope:string)=>'gwi.attachments.v1.'+scope;
  function read(scope:string):AttachmentDraft{
    const known=memory.get(scope);if(known)return known;
    let value=empty;
    try{const raw=storage()?.getItem(storageKey(scope));if(raw){const stored=JSON.parse(raw) as AttachmentDraft;if(Array.isArray(stored.items)&&Number.isSafeInteger(stored.nextOrdinal)){value={items:stored.items.map(item=>({...item,state:item.state==='ready'&&item.attachment?'checking':'interrupted'})),nextOrdinal:stored.nextOrdinal,storageFailed:false};}}}
    catch{value={...empty,storageFailed:true};}
    memory.set(scope,value);return value;
  }
  function write(scope:string,value:AttachmentDraft){
    try{const target=storage();if(!target)throw new Error('Storage unavailable');target.setItem(storageKey(scope),JSON.stringify({...value,items:value.items.map(item=>({...item,...(item.attachment?{attachment:{...item.attachment,preview:{kind:'file'}}}:{})})),storageFailed:false}));value={...value,storageFailed:false};}catch{value={...value,storageFailed:true};}
    memory.set(scope,value);listeners.get(scope)?.forEach(listener=>listener());
  }
  const begin=(key:string)=>{const token=Symbol();operations.set(key,token);return token;};
  const active=(scope:string,key:string,token:symbol)=>operations.get(key)===token?read(scope).items.find(item=>item.key===key):undefined;
  function patch(scope:string,key:string,change:(item:AttachmentItem)=>AttachmentItem,token?:symbol){const current=read(scope);if((token!==undefined&&!active(scope,key,token))||!current.items.some(item=>item.key===key))return;write(scope,{...current,items:current.items.map(item=>item.key===key?change(item):item)});}
  function remove(scope:string,key:string){const value=read(scope);operations.delete(key);files.delete(key);write(scope,{...value,items:value.items.filter(item=>item.key!==key)});}
  async function upload(projectId:string,scope:string,key:string,token:symbol){
    const file=files.get(key),item=active(scope,key,token);if(!file||!item)return;
    if(read(scope).items.reduce((sum,item)=>sum+item.size,0)>ATTACHMENT_TOTAL_LIMIT){patch(scope,key,item=>({...item,state:'failed',error:'ATTACHMENT_TOTAL_TOO_LARGE'}),token);return;}
    patch(scope,key,item=>({...item,state:'uploading',error:undefined}),token);
    try{
      let saved:GoalAttachment;
      try{saved=await transport.receipt(projectId,key);}catch(error){if(!active(scope,key,token))return;if((error as {status?:number}).status!==404&&!['ATTACHMENT_MISSING','ATTACHMENT_CORRUPT'].includes((error as {code?:string}).code??''))throw error;saved=await transport.upload(projectId,scope,key,file,read(scope).items.flatMap(item=>item.attachment?[item.attachment.id]:[]));}
      const current=active(scope,key,token);if(!current)return;
      if(saved.projectId!==projectId||saved.name!==current.name||saved.size!==current.size||saved.sha256!==current.sha256)throw new Error('ATTACHMENT_CORRUPT');
      patch(scope,key,item=>({...item,state:'ready',attachment:saved,error:undefined}),token);
    }catch(error){patch(scope,key,item=>({...item,state:'failed',error:(error as {code?:string}).code??'ATTACHMENT_UPLOAD_FAILED'}),token);}
  }
  async function prepare(projectId:string,scope:string,key:string,token:symbol,deduplicate=false,mismatchState:AttachmentItem['state']='interrupted'){
    const file=files.get(key),item=active(scope,key,token);if(!file||!item)return;
    try{
      if(file.size>ATTACHMENT_FILE_LIMIT){patch(scope,key,item=>({...item,state:'failed',error:'ATTACHMENT_TOO_LARGE'}),token);return;}
      const bytes=await file.arrayBuffer();if(!active(scope,key,token))return;
      const sha256=await digest(bytes);if(!active(scope,key,token))return;
      if(item.sha256&&item.sha256!==sha256){files.delete(key);patch(scope,key,item=>({...item,state:mismatchState,error:'ATTACHMENT_RESELECT_MISMATCH'}),token);return;}
      if(deduplicate){
        const duplicates=read(scope).items.filter(other=>other.key!==key&&other.name===file.name&&other.sha256===sha256);
        if(duplicates.some(other=>other.ordinal<item.ordinal)){remove(scope,key);return;}
        for(const other of duplicates)remove(scope,other.key);
      }
      patch(scope,key,item=>({...item,sha256}),token);await upload(projectId,scope,key,token);
    }catch{patch(scope,key,item=>({...item,state:'failed',error:'ATTACHMENT_UPLOAD_FAILED'}),token);}
  }
  return{
    read,
    subscribe(scope:string,listener:()=>void){const set=listeners.get(scope)??new Set<()=>void>();set.add(listener);listeners.set(scope,set);return()=>{set.delete(listener);};},
    remove,
    async add(projectId:string,scope:string,selected:File[],replaceKey?:string){
      if(!selected.length)return;
      const current=read(scope);
      if(replaceKey){
        const file=selected[0],previous=current.items.find(item=>item.key===replaceKey);if(!previous)return;
        if(previous.name!==file.name||previous.size!==file.size){patch(scope,replaceKey,item=>({...item,error:'ATTACHMENT_RESELECT_MISMATCH'}));return;}
        const token=begin(replaceKey);files.set(replaceKey,file);patch(scope,replaceKey,item=>({...item,state:'preparing',error:undefined}),token);
        await prepare(projectId,scope,replaceKey,token,false,previous.state);return;
      }
      // Register the complete selection before any asynchronous preparation or transfer.
      const batch=selected.map((file,index)=>{const key=createKey(),token=begin(key);files.set(key,file);return{token,item:{key,name:file.name,size:file.size,ordinal:current.nextOrdinal+index,state:'preparing'} satisfies AttachmentItem};});
      write(scope,{...current,items:[...current.items,...batch.map(row=>row.item)],nextOrdinal:current.nextOrdinal+batch.length});
      for(const {item,token} of batch)await prepare(projectId,scope,item.key,token,true);
    },
    async retry(projectId:string,scope:string,key:string){if(!files.has(key)||!read(scope).items.some(item=>item.key===key))return;const token=begin(key);patch(scope,key,item=>({...item,state:'preparing',error:undefined}),token);await prepare(projectId,scope,key,token);},
    hasBytes:(key:string)=>files.has(key),
    async restore(projectId:string,scope:string){
      for(const item of read(scope).items.filter(item=>item.state==='checking'&&item.attachment)){
        if(!read(scope).items.some(current=>current.key===item.key&&current.state==='checking'))continue;const token=begin(item.key);
        try{const saved=await transport.check(projectId,item.attachment!.id);if(saved.projectId!==projectId||saved.sha256!==item.attachment!.sha256)throw new Error('ATTACHMENT_CORRUPT');patch(scope,item.key,current=>({...current,state:'ready',attachment:saved}),token);}
        catch(error){patch(scope,item.key,current=>({...current,state:'interrupted',error:(error as {code?:string}).code??'ATTACHMENT_MISSING'}),token);}
      }
    },
    clear(scope:string,expected:AttachmentDraft){if(read(scope)!==expected)return false;for(const item of expected.items){operations.delete(item.key);files.delete(item.key);}write(scope,{...empty});return true;},
  };
}

export function attachmentSelection(value:AttachmentDraft){const ids=value.items.flatMap(item=>item.state==='ready'&&item.attachment?[item.attachment.id]:[]),over=value.items.reduce((sum,item)=>sum+item.size,0)>ATTACHMENT_TOTAL_LIMIT;return{ids,blocked:over||ids.length!==value.items.length,over};}
