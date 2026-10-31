import {useCallback,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import type {GoalAttachment,Intake,Run} from '../../src/contracts';
import {APIError,api,uid} from '../api';
import {Button} from '../components';
import {useCopy} from './copy';
import {attachmentDrafts,attachmentSelection} from './attachmentDrafts';
import type {AttachmentDraft} from './attachmentDrafts';
import './attachments.css';

const base=(project:string)=>`/api/projects/${encodeURIComponent(project)}/attachments/`;
const drafts=attachmentDrafts(()=>typeof window==='undefined'?undefined:window.sessionStorage,{
  async upload(projectId,scope,key,file,selected){const query=new URLSearchParams({draft:scope,name:file.name});selected.forEach(id=>query.append('selected',id));const response=await fetch(base(projectId)+'uploads/'+encodeURIComponent(key)+'?'+query,{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/octet-stream'},body:file});const body=await response.json();if(!response.ok)throw new APIError(response.status,body.error?.code??'ATTACHMENT_UPLOAD_FAILED',body.error?.message??'Upload failed.');return body;},
  receipt:(project,key)=>api<GoalAttachment>(base(project)+'uploads/'+encodeURIComponent(key)),
  check:(project,id)=>api<GoalAttachment>(base(project)+encodeURIComponent(id)),
},uid,async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''));
const serverSnapshot:AttachmentDraft={items:[],nextOrdinal:1,storageFailed:false};
export const goalInstructionScope=(goal:Intake)=>`instruction:${goal.projectId}:${goal.id}:${goal.routerRunId}:${goal.controlRevision??0}:${goal.recoveryKey??''}`;
export const stageAttachmentScope=(run:Run,stageId:string)=>`resolution:${run.projectId}:${run.id}:${stageId}:${run.stages.find(stage=>stage.stageId===stageId)?.attempts.at(-1)?.id??'none'}:${run.controlRevision??0}`;
export function useGoalAttachments(projectId:string,scope:string){
  const subscribe=useCallback((listener:()=>void)=>drafts.subscribe(scope,listener),[scope]),read=useCallback(()=>drafts.read(scope),[scope]);
  const value=useSyncExternalStore(subscribe,read,()=>serverSnapshot);
  useEffect(()=>{void drafts.restore(projectId,scope);},[projectId,scope]);
  return{value,...attachmentSelection(value),add:(files:File[],replace?:string)=>drafts.add(projectId,scope,files,replace),retry:(key:string)=>drafts.retry(projectId,scope,key),remove:(key:string)=>drafts.remove(scope,key),clear:(expected:AttachmentDraft)=>drafts.clear(scope,expected),hasBytes:drafts.hasBytes};
}
export type GoalAttachmentDraft=ReturnType<typeof useGoalAttachments>;
function fileURL(item:GoalAttachment,kind:'preview'|'content'){return base(item.projectId)+encodeURIComponent(item.id)+'/'+kind;}
function Preview({item}:{item:GoalAttachment}){const{p}=useCopy(),[failed,setFailed]=useState(false);return item.preview.kind==='image'&&!failed?<img className="pf-attachment-thumb" src={fileURL(item,'preview')} alt={item.name} onError={()=>setFailed(true)}/>:item.preview.kind==='text'?<details className="pf-attachment-text"><summary>{p('attachmentTextPreview')}</summary><pre>{item.preview.excerpt||p('attachmentEmpty')}</pre>{item.preview.truncated&&<span>{p('attachmentTruncated')}</span>}</details>:<span className="hint">{p('attachmentPreviewUnavailable')}</span>;}

export function AttachmentArea({draft,disabled,onText,children}:{draft:GoalAttachmentDraft;disabled?:boolean;onText:(text:string)=>void;children:ReactNode}){
  const{p}=useCopy(),[drag,setDrag]=useState(false),[message,setMessage]=useState(''),depth=useRef(0);
  const isFile=(event:React.DragEvent)=>event.dataTransfer.types.includes('Files');
  return <div className={'pf-attachment-area'+(drag?' is-dragging':'')} onDragEnter={event=>{if(!disabled&&isFile(event)){event.preventDefault();depth.current++;setDrag(true);}}} onDragOver={event=>{if(isFile(event)){event.preventDefault();event.dataTransfer.dropEffect=disabled?'none':'copy';}}} onDragLeave={event=>{if(isFile(event)&&--depth.current<=0){depth.current=0;setDrag(false);}}} onDrop={event=>{if(!isFile(event))return;event.preventDefault();depth.current=0;setDrag(false);if(disabled)return;const items=Array.from(event.dataTransfer.items);if(items.some(item=>item.webkitGetAsEntry?.()?.isDirectory)){setMessage(p('attachmentNoFolders'));return;}setMessage('');void draft.add(Array.from(event.dataTransfer.files));}} onPaste={event=>{
    if(!(event.target instanceof HTMLTextAreaElement)||disabled)return;
    const files=Array.from(event.clipboardData.files);if(!files.length){if(event.clipboardData.getData('text/html').toLowerCase().includes('<img'))setMessage(p('attachmentClipboardUnavailable'));return;}
    event.preventDefault();setMessage('');const field=event.target,start=field.selectionStart,available=field.maxLength<0?Infinity:Math.max(0,field.maxLength-field.value.length+field.selectionEnd-start),text=event.clipboardData.getData('text/plain').slice(0,available);
    if(text){onText(field.value.slice(0,start)+text+field.value.slice(field.selectionEnd));requestAnimationFrame(()=>field.setSelectionRange(start+text.length,start+text.length));}void draft.add(files);
  }}>{children}{drag&&<span className="pf-attachment-drop" aria-live="polite">{p('attachmentDrop')}</span>}{message&&<p role="status" className="hint">{message}</p>}</div>;
}

export function AttachmentControls({draft,disabled,id}:{draft:GoalAttachmentDraft;disabled?:boolean;id?:string}){
  const{p}=useCopy(),generated=useId(),listId=id??generated,input=useRef<HTMLInputElement>(null),replace=useRef<string|undefined>(undefined),controls=useRef<HTMLDivElement>(null);
  const remove=(key:string,index:number)=>{const buttons=controls.current?.querySelectorAll<HTMLButtonElement>('[data-attachment-remove]');const target=buttons?.[index+1]??buttons?.[index-1];draft.remove(key);requestAnimationFrame(()=>{if(target?.isConnected)target.focus();else controls.current?.querySelector<HTMLButtonElement>('[data-attachment-add]')?.focus();});};
  return <div className="pf-attachments" ref={controls} id={listId} tabIndex={-1} role="group" aria-label={p('attachmentSelected',{count:draft.value.items.length})}>
    {draft.value.items.length>0&&<ul className="pf-attachment-list">{draft.value.items.map((item,index)=>{const collision=draft.value.items.some(other=>other.key!==item.key&&other.name===item.name&&other.size===item.size),name=item.name+(collision?' · '+p('attachmentFileNumber',{number:item.ordinal}):'');return <li className="pf-attachment" key={item.key}>
      <div className="pf-attachment-body"><strong>{name}</strong><span className="hint">{formatBytes(item.size)}{item.attachment&&<> · {item.attachment.mediaType}</>}</span><span>{p(item.state==='ready'?'attachmentReady':item.state==='preparing'||item.state==='checking'?'attachmentPreparing':item.state==='uploading'?'attachmentUploading':item.state==='interrupted'?'attachmentInterrupted':'attachmentFailed')}</span>
      {item.attachment&&<Preview item={item.attachment}/>}<AttachmentError code={item.error}/></div><div className="pf-attachment-actions">{['failed','interrupted'].includes(item.state)&&(draft.hasBytes(item.key)?<Button disabled={disabled} onClick={()=>void draft.retry(item.key)}>{p('attachmentRetry')}</Button>:<Button disabled={disabled} onClick={()=>{replace.current=item.key;input.current?.click();}}>{p('attachmentReselect')}</Button>)}<Button data-attachment-remove disabled={disabled} aria-label={p('attachmentRemoveName',{name})} onClick={()=>remove(item.key,index)}>{p('attachmentRemove')}</Button></div>
    </li>;})}</ul>}
    <div className="pf-attachment-add"><input ref={input} type="file" multiple hidden disabled={disabled} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length)void draft.add(files,replace.current);replace.current=undefined;}}/><Button data-attachment-add disabled={disabled} onClick={()=>{replace.current=undefined;input.current?.click();}}>{p('attachmentAdd')}</Button><span className="hint">{p('attachmentLimits')}</span></div>
    <div role="status" aria-live="polite" aria-atomic="true">{draft.value.items.length>0&&!draft.blocked&&<span className="hint">{p('attachmentReadyCount',{count:draft.value.items.length})}</span>}{draft.blocked&&<p className="pf-attachment-error">{p(draft.over?'attachmentTotalTooLarge':'attachmentBlocked')}</p>}{draft.value.storageFailed&&<p className="pf-attachment-error">{p('attachmentStorageFailed')}</p>}</div>
  </div>;
}
function AttachmentError({code}:{code?:string}){const{p}=useCopy();if(!code)return null;return <p className="pf-attachment-error">{p(code==='ATTACHMENT_TOO_LARGE'?'attachmentTooLarge':code==='ATTACHMENT_TOTAL_TOO_LARGE'?'attachmentTotalTooLarge':code==='ATTACHMENT_RESELECT_MISMATCH'?'attachmentReselectMismatch':code==='ATTACHMENT_MISSING'||code==='ATTACHMENT_CORRUPT'||code==='ATTACHMENT_NOT_FOUND'?'attachmentMissing':'attachmentFailed')}</p>;}
export function SubmittedAttachments({items}:{items?:GoalAttachment[]}){const{p}=useCopy();if(!items?.length)return null;return <details className="pf-submitted-attachments"><summary>{p('attachmentSubmitted',{count:items.length})}</summary><ul className="pf-attachment-list">{items.map(item=><li key={item.id} className="pf-attachment"><div className="pf-attachment-body"><strong>{item.name}</strong><span>{formatBytes(item.size)}</span><Preview item={item}/><a href={fileURL(item,'content')} download={item.name}>{p('attachmentDownload')}</a><details><summary>{p('technical')}</summary><code>{item.id}<br/>{item.sha256}</code></details></div></li>)}</ul></details>;}
function formatBytes(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${Math.ceil(bytes/1024)} KiB`:`${(bytes/(1024*1024)).toFixed(1)} MiB`;}
