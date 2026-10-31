import {useRef,useState} from 'react';
import type {Intake,Project,Run,WorkResumeInput} from '../../src/contracts';
import {api,uid} from '../api';
import {Button,ErrorNotice,Field,Notice} from '../components';
import {useCopy} from './copy';
import {recordWorkStart,submittedDraftKey} from './workStart';
import {useTextDraft} from './useTextDraft';
import {requestEnterAction} from './requestKeys';
import {AttachmentArea,AttachmentControls,stageAttachmentScope,useGoalAttachments} from './GoalAttachments';

export function ResumeFailedWork({fileScope,noteScope,goal,run,stageId,project,onAccepted,onChanged,onObservationError,onClose}:{fileScope?:string;noteScope?:string;goal:Intake;run:Run;stageId:string;project:Project;onAccepted:(goal:Intake)=>void;onChanged:()=>Promise<void>;onObservationError:(error:unknown)=>void;onClose:()=>void}) {
  const {p}=useCopy(),definition=run.snapshot.pipeline.stages.find(stage=>stage.id===stageId)!,state=run.stages.find(stage=>stage.stageId===stageId)!,attempt=state.attempts.at(-1)!;
  const scope=fileScope??stageAttachmentScope(run,stageId),attachments=useGoalAttachments(goal.projectId,scope),[storedKey,setStoredKey,clearStoredKey]=useTextDraft(scope+':key');
  const [note,setNote,clearNote]=useTextDraft(noteScope??`resume-work:${goal.id}:${run.id}:${stageId}`),[selection,setSelection]=useState<{key:string;revision:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),composing=useRef(false),working=useRef(false);
  const identity={goalId:goal.id,projectId:goal.projectId,controlRevision:goal.controlRevision??0,target:{runId:run.id,stageId,attemptId:attempt.id,runControlRevision:run.controlRevision??0},goalStatus:goal.status,runStatus:run.status,stageStatus:state.status},[pinned]=useState(()=>identity),current=project.id===goal.projectId&&run.projectId===goal.projectId&&JSON.stringify(identity)===JSON.stringify(pinned);
  const currentRole=project.roles.find(role=>role.id===definition.roleId&&!role.retired),browser=currentRole?.tools.includes('browser.use')?currentRole.browser:undefined,browserKey=JSON.stringify([project.id,project.revision,definition.roleId,browser?.origins??[]]),useBrowser=selection?.key===browserKey;
  const submit=async(event?:React.FormEvent)=>{
    event?.preventDefault();if(working.current||attachments.blocked||!current)return;working.current=true;setBusy(true);setError(null);
    const snapshot=attachments.value,intent=JSON.stringify({note:note.trim(),attachmentIds:attachments.ids,controlRevision:pinned.controlRevision,target:pinned.target,browserProjectRevision:useBrowser?selection!.revision:undefined}),submission=submittedDraftKey(intent,storedKey,uid);setStoredKey(JSON.stringify(submission));
    const input:WorkResumeInput={attachmentIds:attachments.ids,idempotencyKey:submission.key,controlRevision:pinned.controlRevision,target:pinned.target,...(note.trim()?{note:note.trim()}:{}),...(useBrowser?{browserProjectRevision:selection!.revision}:{})};
    try{await recordWorkStart(()=>api<Intake>(`/api/intakes/${encodeURIComponent(pinned.goalId)}/resume`,{method:'POST',body:input}),value=>{onAccepted(value);clearNote(note,()=>attachments.clear(snapshot));clearStoredKey(JSON.stringify(submission));onClose();},onChanged,onObservationError);}catch(error){setError(error);}finally{working.current=false;setBusy(false);}
  };
  return <form className="form-stack" onSubmit={event=>void submit(event)}><p>{p('resumeFailedStep',{name:definition.name,count:run.stages.filter(stage=>stage.status==='completed').length})}</p><ErrorNotice error={error}/>{!current&&<Notice>{p('resumeTargetChanged')}</Notice>}
    {browser&&<><label className="check"><input type="checkbox" checked={useBrowser} disabled={busy||!current} onChange={event=>setSelection(event.target.checked?{key:browserKey,revision:project.revision}:null)}/><span>{p('resumeCurrentBrowser',{revision:project.revision})}</span></label><p className="hint">{p('resumeCurrentBrowserHelp')}</p><ul>{browser.origins.map(origin=><li key={origin}><code>{origin}</code></li>)}</ul></>}
    <AttachmentArea draft={attachments} disabled={busy||!current} onText={setNote}><Field label={p('resolutionNote')}><textarea rows={3} maxLength={2000} value={note} disabled={busy||!current} onChange={event=>setNote(event.target.value)} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')void submit();}}/></Field><AttachmentControls draft={attachments} disabled={busy||!current} id={scope+'-files'}/></AttachmentArea>
    <div className="form-actions"><Button disabled={busy} onClick={onClose}>{p('cancel')}</Button><Button type="submit" tone="primary" disabled={busy||!current||attachments.blocked} aria-describedby={attachments.blocked?scope+'-files':undefined}>{p(busy?'resolutionPreparing':'continueStage')}</Button></div>
  </form>;
}
