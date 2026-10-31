import {useRef,useState} from 'react';
import type {Intake,Project,Run,WorkResumeInput} from '../../src/contracts';
import {api,uid} from '../api';
import {Button,ErrorNotice,Field} from '../components';
import {useCopy} from './copy';
import {recordWorkStart} from './workStart';
import {useTextDraft} from './useTextDraft';
import {requestEnterAction} from './requestKeys';

export function ResumeFailedWork({goal,run,stageId,project,onAccepted,onChanged,onObservationError,onClose}:{goal:Intake;run:Run;stageId:string;project:Project;onAccepted:(goal:Intake)=>void;onChanged:()=>Promise<void>;onObservationError:(error:unknown)=>void;onClose:()=>void}) {
  const {p}=useCopy(),[note,setNote,clearNote]=useTextDraft(`resume-work:${goal.id}:${run.id}:${stageId}`),[useBrowser,setUseBrowser]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[key]=useState(()=>uid()),composing=useRef(false);
  const working=useRef(false),definition=run.snapshot.pipeline.stages.find(stage=>stage.id===stageId)!,state=run.stages.find(stage=>stage.stageId===stageId)!,attempt=state.attempts.at(-1)!;
  const currentRole=project.roles.find(role=>role.id===definition.roleId),browser=currentRole?.tools.includes('browser.use')?currentRole.browser:undefined;
  const submit=async(event?:React.FormEvent)=>{
    event?.preventDefault();if(working.current)return;working.current=true;setBusy(true);setError(null);
    const input:WorkResumeInput={idempotencyKey:key,controlRevision:goal.controlRevision??0,target:{runId:run.id,stageId,attemptId:attempt.id,runControlRevision:run.controlRevision??0},...(note.trim()?{note:note.trim()}:{}),...(useBrowser?{browserProjectRevision:project.revision}:{})};
    try{await recordWorkStart(()=>api<Intake>(`/api/intakes/${encodeURIComponent(goal.id)}/resume`,{method:'POST',body:input}),value=>{onAccepted(value);clearNote(note);onClose();},onChanged,onObservationError);}catch(error){setError(error);}finally{working.current=false;setBusy(false);}
  };
  return <form className="form-stack" onSubmit={event=>void submit(event)}><p>{p('resumeFailedStep',{name:definition.name,count:run.stages.filter(stage=>stage.status==='completed').length})}</p><ErrorNotice error={error}/>
    {browser&&<><label className="check"><input type="checkbox" checked={useBrowser} disabled={busy} onChange={event=>setUseBrowser(event.target.checked)}/><span>{p('resumeCurrentBrowser',{revision:project.revision})}</span></label><p className="hint">{p('resumeCurrentBrowserHelp')}</p><ul>{browser.origins.map(origin=><li key={origin}><code>{origin}</code></li>)}</ul></>}
    <Field label={p('resolutionNote')}><textarea rows={3} maxLength={2000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')void submit();}}/></Field>
    <div className="form-actions"><Button disabled={busy} onClick={onClose}>{p('cancel')}</Button><Button type="submit" tone="primary" disabled={busy}>{p(busy?'resolutionPreparing':'continueStage')}</Button></div>
  </form>;
}
