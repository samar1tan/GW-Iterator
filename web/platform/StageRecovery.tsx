import {useEffect,useRef,useState} from 'react';
import type {Run,RunRecovery,RunResolution,ResolveRunInput} from '../../src/contracts';
import {api,uid} from '../api';
import {Button,ErrorNotice,Field,Notice} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';
import {HistoricalExecutionPolicy} from './ExecutionHistory';
import {AccountAllowance,accountStepNeedsApproval,accountStepAuthorization} from './AccountAllowance';
import {useTextDraft} from './useTextDraft';
import {recordWorkStart,submittedDraftKey} from './workStart';
import {requestEnterAction} from './requestKeys';

/** Ordinary observations cannot restart a pending lookup on every polling tick. */
export function stageDecisionKey(run:Run,stageId:string):string {
  const state=run.stages.find(item=>item.stageId===stageId);
  return JSON.stringify([run.id,stageId,run.controlRevision??0,run.status,run.pausedAt,state?.status,state?.attempts.at(-1)?.id,state?.allowanceHold?.code,run.limitRevisions?.length??0]);
}
export function stageResolutionObserved(observed:Run,receipt:Run):boolean {
  if(observed.id!==receipt.id)return false;
  if((observed.controlRevision??0)!==(receipt.controlRevision??0))return (observed.controlRevision??0)>(receipt.controlRevision??0);
  const currentTime=Date.parse(observed.updatedAt),receiptTime=Date.parse(receipt.updatedAt);
  if(currentTime!==receiptTime)return currentTime>receiptTime;
  return observed.pausedAt===receipt.pausedAt&&receipt.stages.every(expected=>{
    const current=observed.stages.find(stage=>stage.stageId===expected.stageId);if(!current||current.attempts.length<expected.attempts.length)return false;
    if(current.attempts.length>expected.attempts.length)return true;
    if(current.status===expected.status)return JSON.stringify(current.attempts.at(-1))===JSON.stringify(expected.attempts.at(-1));
    return expected.status==='running'&&['completed','failed','review','interrupted','cancelled'].includes(current.status)&&current.attempts.at(-1)?.id===expected.attempts.at(-1)?.id;
  });
}
export function pendingStageResolution(observed:Run,receipt:Run|null):Run|null {
  if(!receipt||observed.cancelRequested||observed.status==='cancelled'||stageResolutionObserved(observed,receipt))return null;
  return receipt;
}

export function StageRecovery({run:observedRun,stageId,onChanged,onGoal,onChooseBrowser}:{run:Run;stageId:string;onChanged:()=>Promise<void>;onGoal?:(id:string)=>void;onChooseBrowser?:()=>void}) {
  const {p,number}=useCopy();const [resumed,setResumed]=useState<Run|null>(null);
  const run=resumed&&!stageResolutionObserved(observedRun,resumed)?resumed:observedRun,state=run.stages.find(item=>item.stageId===stageId),attempt=state?.attempts.at(-1);
  useEffect(()=>{if(resumed&&stageResolutionObserved(observedRun,resumed))setResumed(null);},[observedRun,resumed]);
  const [decision,setDecision]=useState<{basis:string;value:RunRecovery}|null>(null),[readError,setReadError]=useState<unknown>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState<'continue'|'decline'|'resume'|null>(null),[reading,setReading]=useState(false),[read,setRead]=useState(0),[receipt,setReceipt]=useState<Run|null>(null),[observationError,setObservationError]=useState<unknown>(null);
  const [note,setNote,clearNote]=useTextDraft(`resolution:${run.id}:${stageId}:${attempt?.id??'none'}`),[storedKey,setStoredKey,clearStoredKey]=useTextDraft(`resolution-key:${run.id}:${stageId}:${attempt?.id??'none'}`);
  const mounted=useRef(true),working=useRef(false),composing=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const path=`/api/runs/${encodeURIComponent(run.id)}/recovery?stageId=${encodeURIComponent(stageId)}`,basis=stageDecisionKey(run,stageId),pendingReceipt=pendingStageResolution(run,receipt);
  const value=decision?.basis===basis?decision.value:null;
  const setValue=(next:RunRecovery|null)=>setDecision(next?{basis,value:next}:null);
  useEffect(()=>{if(receipt&&!pendingReceipt)setReceipt(null);},[receipt,pendingReceipt]);
  useEffect(()=>{
    const controller=new AbortController();setReading(true);
    void api<RunRecovery>(path,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(result=>{if(!controller.signal.aborted){setValue(result);setReadError(null);}}).catch(error=>{if(!controller.signal.aborted)setReadError(error);}).finally(()=>{if(!controller.signal.aborted)setReading(false);});
    return()=>controller.abort();
  },[path,basis,read]);
  const account=value?.account,accountApproval=!!value&&(value.accountAcknowledgementRequired===true||accountStepNeedsApproval(account));
  const paused=!!run.pausedAt||value?.code==='RUN_PAUSED',needsApproval=!paused&&accountApproval,waiting=!paused&&(value?.action==='wait'||account?.status==='exhausted');
  const stage=run.snapshot.pipeline.stages.find(item=>item.id===stageId),requiresAccount=stage?.executor==='codex'||(stage?.executor==='pipeline'&&!!account);
  const refreshAccount=async()=>{await api('/api/account-allowance',{method:'POST',body:{refresh:true,projectId:run.projectId,runId:run.id,stageId}});setRead(value=>value+1);};
  const refreshObservation=async()=>{setObservationError(null);try{await onChanged();setRead(value=>value+1);}catch(error){if(mounted.current)setObservationError(error);}};
  const submit=async()=>{
    if(working.current||pendingReceipt||run.cancelRequested||run.status==='cancelled')return;if(onChooseBrowser){onChooseBrowser();return;}working.current=true;setBusy('continue');setError(null);setObservationError(null);
    const intent=JSON.stringify({note:note.trim(),attemptId:attempt?.id,recoveryKey:needsApproval?value?.recoveryKey:undefined}),submission=submittedDraftKey(intent,storedKey,uid);setStoredKey(JSON.stringify(submission));
    const input:ResolveRunInput={stageId,attemptId:attempt?.id,controlRevision:run.controlRevision??0,idempotencyKey:submission.key,...(note.trim()?{note:note.trim()}:{}),...(needsApproval?{recoveryKey:value?.recoveryKey,...accountStepAuthorization(account,accountApproval)}:{})};
    try{
      const result=await api<RunResolution>(`/api/runs/${encodeURIComponent(run.id)}/resolve`,{method:'POST',body:input});
      if(!mounted.current)return;
      if(result.status==='needs_input'){setValue(result.recovery);clearStoredKey(JSON.stringify(submission));}
      else await recordWorkStart(async()=>result.run,saved=>{setReceipt(saved);clearNote(note);clearStoredKey(JSON.stringify(submission));},onChanged,setObservationError);
    }catch(error){if(mounted.current){setError(error);setRead(value=>value+1);void onChanged().catch(()=>{});}}finally{working.current=false;if(mounted.current)setBusy(null);}
  };
  const resumePaused=async()=>{if(working.current)return;working.current=true;setBusy('resume');setError(null);try{await recordWorkStart(()=>api<Run>(`/api/runs/${encodeURIComponent(run.id)}/resume`,{method:'POST',body:{}}),saved=>{if(mounted.current){setResumed(saved);setValue(null);}},onChanged,setObservationError);}catch(error){if(mounted.current)setError(error);}finally{working.current=false;if(mounted.current)setBusy(null);}};
  const decline=async()=>{
    if(working.current)return;working.current=true;setBusy('decline');setError(null);
    try{await recordWorkStart(()=>api<Run>(`/api/runs/${encodeURIComponent(run.id)}/cancel`,{method:'POST',body:{declineRetry:true,note:note.trim()||p(needsApproval?'resolutionDeclinedNote':'resolutionNoRetryNote')}}),saved=>{if(mounted.current){setReceipt(saved);clearNote(note);}},onChanged,setObservationError);}catch(error){if(mounted.current)setError(error);}finally{working.current=false;if(mounted.current)setBusy(null);}
  };
  if(pendingReceipt||run.cancelRequested||run.status==='cancelled')return <section className="pf-recovery pf-resolution"><Notice tone="success">{p(run.cancelRequested||run.status==='cancelled'||pendingReceipt?.cancelRequested||pendingReceipt?.status==='cancelled'?'resolutionDeclined':'resolutionAccepted')}</Notice>{(!!observationError||!!pendingReceipt)&&<Button onClick={()=>void refreshObservation()}>{p('viewCurrentExecution')}<Icon name="arrow-right"/></Button>}{!!observationError&&<details><summary>{p('technical')}</summary><ErrorNotice error={observationError}/></details>}</section>;
  if(value?.code==='GOAL_CLOSED'||value?.code==='RUN_CANCELLED')return <section className="pf-recovery"><p>{p('resolutionClosed')}</p>{onGoal&&value.scope.kind==='goal'&&<Button tone="quiet" onClick={()=>onGoal(value.scope.id)}>{p('outcome')}<Icon name="arrow-right"/></Button>}</section>;
  return <section className="pf-recovery pf-resolution"><h3>{p(needsApproval?'resolutionDecision':'recoveryTitle')}</h3>
    {value&&value.action!=='none'&&<p className="pf-resolution-reason">{p(paused?'resolutionPausedHelp':waiting?(account?.status==='exhausted'?'resolutionAccountWait':'resolutionBusyWait'):needsApproval?'resolutionApproveHelp':value.action==='reconcile'?'resolutionCheckAndRetry':state?.allowanceHold&&account?.action==='continue'?'resolutionHealthyHold':'resolutionRetryHelp')}</p>}
    {!!readError&&<div className="pf-resolution-observation"><span>{p('resolutionReadUnavailable')}</span><Button tone="quiet" onClick={()=>setRead(value=>value+1)}><Icon name="refresh"/>{p('refresh')}</Button><details><summary>{p('technical')}</summary><ErrorNotice error={readError}/></details></div>}
    {!!error&&<Notice tone="warning"><p>{p('resolutionRequestUnconfirmed')}</p><details><summary>{p('technical')}</summary><ErrorNotice error={error}/></details></Notice>}
    <div className="actions pf-resolution-actions"><Button tone="primary" disabled={!!busy||value?.action==='none'} onClick={()=>void (paused?resumePaused():submit())}><Icon name={waiting?'refresh':needsApproval?'check':'play'}/>{p(busy==='resume'?'resolutionResuming':busy==='continue'?'resolutionPreparing':paused?'resume':onChooseBrowser?'continueStage':waiting?'workCheckAgain':needsApproval?'resolutionApprove':state?.allowanceHold?'resolutionContinue':'continueStage')}</Button><Button disabled={!!busy} onClick={()=>void decline()}>{p(busy==='decline'?'resolutionDeclining':needsApproval?'resolutionReject':'resolutionNoRetry')}</Button>{reading&&!value&&!readError&&<span className="hint">{p('resolutionCheckingBackground')}</span>}</div>
    <Field label={p('resolutionNote')}><textarea rows={2} maxLength={20000} disabled={!!busy} value={note} onChange={event=>setNote(event.target.value)} placeholder={p('resolutionNotePlaceholder')} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')void (paused?resumePaused():submit());}}/></Field>
    {value?.action==='blocked'&&value.scope.kind==='goal'&&onGoal&&<Button tone="quiet" onClick={()=>onGoal(value.scope.id)}>{p('continueGoal')}<Icon name="arrow-right"/></Button>}
    {requiresAccount&&account&&<AccountAllowance context={{projectId:run.projectId,runId:run.id,stageId}} assessment={account} onRefresh={refreshAccount}/>}
    {value&&<details className="pf-recovery-details"><summary>{p('recoveryAdvanced')}</summary><div className="form-stack">{value.reason&&<p className="hint">{value.reason}</p>}{requiresAccount&&<dl className="metadata-list"><div><dt>{p('tokenDiagnostics')}</dt><dd>{value.allowance.usageComplete?number(value.allowance.usedTokens):p('partial')}</dd></div></dl>}<HistoricalExecutionPolicy policy={run.snapshot.pipeline.policy}/></div></details>}
  </section>;
}
export function canPerformStageRecovery(action:RunRecovery['action'],accountBlocked:boolean){return action==='reconcile'||(['retry','approve'].includes(action)&&!accountBlocked);}
