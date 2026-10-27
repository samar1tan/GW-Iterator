import {useId,useRef,useState} from 'react';
import type {Intake,Project} from '../../src/contracts';
import type {AllowanceAssessment} from '../../src/account-allowance-types';
import {api,uid} from '../api';
import {Button,ErrorNotice} from '../components';
import {Icon} from '../Icons';
import {AccountAllowance,accountStepAuthorization,accountStepNeedsApproval,canRequestAccountStep} from './AccountAllowance';
import {ProjectReadinessNotice,useProjectReadiness} from './ProjectReadiness';
import {recordWorkStart,submittedDraftKey} from './workStart';
import {useTextDraft} from './useTextDraft';
import {useCopy} from './copy';
import {requestEnterAction} from './requestKeys';

export function RequestComposer({project,parentIntakeId,reply,inputId,onCreated,onContinued,onChanged,onSettings,onKnowledge}:{project:Project;parentIntakeId?:string;reply?:Intake;inputId?:string;onCreated:(goal:Intake)=>void;onContinued?:(goal:Intake,previous:Intake)=>void;onChanged:()=>Promise<void>;onSettings?:()=>void;onKnowledge?:()=>void}) {
  const{p}=useCopy(),generatedId=useId(),readiness=useProjectReadiness(project,!reply),fieldId=inputId??(parentIntakeId||reply?generatedId:'pf-new-outcome');
  const scope=reply?`reply:${project.id}:${reply.id}:${reply.routerRunId}`:parentIntakeId?`followup:${project.id}:${parentIntakeId}`:`outcome:${project.id}`;
  const keyScope=reply?scope+'-key':parentIntakeId?`followup-key:${project.id}:${parentIntakeId}`:`outcome-key:${project.id}`;
  const[request,setRequest,clearRequest]=useTextDraft(scope),[storedKey,setStoredKey,clearStoredKey]=useTextDraft(keyScope),[account,setAccount]=useState<AllowanceAssessment|null>(null),[busy,setBusy]=useState(false),[cancelling,setCancelling]=useState(false),[cancelAcknowledged,setCancelAcknowledged]=useState(false),[error,setError]=useState<unknown>(null);
  const pending=busy||!!reply?.continuationPending;
  const composing=useRef(false);
  const sourceBlocked=!reply&&readiness.readiness?.workspace.status!=='ready';
  const disabled=pending||cancelAcknowledged||!request.trim()||sourceBlocked||!canRequestAccountStep(account)||!!reply&&!reply.canRetry;
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(pending||cancelAcknowledged||!request.trim()||sourceBlocked||!canRequestAccountStep(account)||reply&&!reply.canRetry)return;
    setBusy(true);setError(null);
    const submission=submittedDraftKey(request.trim(),storedKey,uid);if(!reply)setStoredKey(JSON.stringify(submission));
    try{await recordWorkStart(()=>reply?api<Intake>(`/api/intakes/${encodeURIComponent(reply.id)}/retry`,{method:'POST',body:{note:request.trim(),resourceMode:'account',recoveryKey:reply.recoveryKey,...accountStepAuthorization(account)}}):api<Intake>(`/api/projects/${encodeURIComponent(project.id)}/intakes`,{method:'POST',body:{request:request.trim(),idempotencyKey:submission.key,resourceMode:'account',...(parentIntakeId?{parentIntakeId}:{}),...accountStepAuthorization(account)}}),receipt=>{clearRequest(request);if(!reply)clearStoredKey(JSON.stringify(submission));if(reply&&onContinued)onContinued(receipt,reply);else onCreated(receipt);},onChanged,setError);}catch(value){setError(value);}finally{setBusy(false);}
  };
  const cancel=async()=>{if(!reply||!pending||cancelling||cancelAcknowledged)return;setCancelling(true);try{await api(`/api/intakes/${encodeURIComponent(reply.id)}/cancel`,{method:'POST',body:{note:p('cancelContinuationNote')}});setCancelAcknowledged(true);await onChanged();}catch(value){setError(value);}finally{setCancelling(false);}};
  return <div className="pf-request-composer">{!reply&&<ProjectReadinessNotice {...readiness} onSettings={onSettings} onKnowledge={onKnowledge}/>}
    <form className="pf-outcome-entry" onSubmit={event=>void submit(event)}>
      <label htmlFor={fieldId}><Icon name={parentIntakeId||reply?'arrow-right':'terminal'}/>{p(reply?'replyHere':parentIntakeId?'followUpHere':'outcome')}</label>
      <textarea id={fieldId} required maxLength={reply?2000:4000} disabled={pending} rows={2} value={request} onChange={event=>setRequest(event.target.value)} placeholder={p(reply?'replyPlaceholder':parentIntakeId?'followUpPlaceholder':'outcomePlaceholder')} aria-keyshortcuts="Enter Meta+Enter Control+Enter" aria-describedby={fieldId+'-keys'} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit'&&!disabled)event.currentTarget.form?.requestSubmit();}}/>
      <span className="pf-request-keys" id={fieldId+'-keys'}>{p('requestKeysHint')}</span>
      <div className="pf-outcome-footer"><AccountAllowance context={{projectId:project.id,...(reply?{intakeId:reply.id}:{})}} onAssessment={setAccount}/><div className="pf-outcome-actions">{reply&&pending&&!cancelAcknowledged&&<Button tone="danger" disabled={cancelling} onClick={()=>void cancel()}>{p(cancelling?'cancellingContinuation':'cancelContinuation')}</Button>}{cancelAcknowledged&&<span role="status">{p('continuationCancelRequested')}</span>}<Button type="submit" tone="primary" disabled={disabled} title={p('sendShortcut')}><Icon name="play"/>{p(pending?'starting':accountStepNeedsApproval(account)?'accountApproveStep':reply?'sendReply':parentIntakeId?'sendFollowUp':'startWork')}</Button></div></div>
    </form><ErrorNotice error={error}/>
  </div>;
}
