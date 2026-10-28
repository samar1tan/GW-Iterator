import {useEffect,useState} from 'react';
import type {Intake,Run} from '../../src/contracts';
import {Button,ErrorNotice,Field,Notice} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';
import {currentWorkRecovery,recoveryTarget,workRecoveryMessage,workRecoveryPending,workRecoveryTiming} from './workRecovery';
import {useTextDraft} from './useTextDraft';
import {requestEnterAction} from './requestKeys';
import {useRef} from 'react';

export function WorkRecoverySurface({goal,runs,id,error,observationFailed,onRefresh,onStep,onAdvanced,onRetry,onDecline,busy=false}:{goal:Intake;runs:Run[];id:string;error:unknown;observationFailed:boolean;onRefresh:()=>Promise<void>;onStep:(runId:string,stageId?:string)=>void;onAdvanced?:()=>void;onRetry?:(note?:string)=>Promise<void>;onDecline?:(note?:string)=>Promise<void>;busy?:boolean}) {
  const{p,number}=useCopy(),record=currentWorkRecovery(goal),target=recoveryTarget(goal,runs),pending=workRecoveryPending(goal);
  const [note,setNote,clearNote]=useTextDraft(`recovery-note:${goal.id}:${goal.routerRunId}`),composing=useRef(false);
  const submit=async()=>{if(busy||pending||!onRetry)return;const submitted=note;await onRetry(note.trim()||undefined);clearNote(submitted);};
  const now=Date.now(),[,setClock]=useState(0);
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>setClock(value=>value+1),1000);return()=>clearInterval(timer);},[pending]);
  const timing=record?workRecoveryTiming(record,now):undefined;
  const late=!!record&&['checking','backoff'].includes(record.phase)&&!!timing?.expired,stale=observationFailed||late;
  const code=(!pending&&goal.status==='failed'&&target.run?.executionKind&&target.stage?.status==='completed'?'WORK_READY_TO_RESUME':undefined)??(record?.phase!=='completed'||goal.status!=='failed'?record?.code:undefined)??target.stage?.attempts.at(-1)?.failureCode??goal.lastFailure?.code??goal.retryBlockedCode??'';
  const messages=[...new Set([goal.error,goal.retryBlockedReason,record?.error,target.stage?.attempts.at(-1)?.error].filter((value):value is string=>!!value))];
  return <section id={id} tabIndex={-1} className="pf-work-recovery" aria-label={p('workRecoveryTitle')}>
    <div className="pf-work-recovery-heading"><Icon name={pending?'clock':record?.phase==='completed'?'check-circle':'warning'}/><div><h2 aria-live="polite" aria-atomic="true">{p(stale&&pending?'workObservationUnavailable':workRecoveryMessage(code))}</h2>{target.definition&&<p>{p('workAffectedStep',{name:target.definition.name})}</p>}</div></div>
    {pending&&!stale&&record&&timing&&<p className="pf-work-recovery-time">{record.phase==='checking'?(timing.nextSeconds>0?p('workNextCheck',{seconds:number(timing.nextSeconds),remaining:number(timing.remainingSeconds)}):p('workCheckDeadline',{remaining:number(timing.remainingSeconds)})):record.phase==='backoff'?(timing.nextSeconds>0?p('workNextRetry',{seconds:number(timing.nextSeconds)}):p('workRetryDue')):record.phase==='retrying'?p('workRetryScope'):p('workResumeScope')}</p>}
    {stale&&<p className="hint">{p('workObservationHelp')}</p>}
    {!!error&&<Notice tone="warning"><p>{p('workRecoveryRequestUnavailable')}</p><details><summary>{p('technical')}</summary><ErrorNotice error={error}/></details></Notice>}
    {!pending&&(onRetry||onDecline)&&<div className="form-stack pf-recovery-decision"><Field label={p('resolutionNote')}><textarea rows={2} maxLength={2000} disabled={busy} value={note} onChange={event=>setNote(event.target.value)} placeholder={p('resolutionNotePlaceholder')} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')void submit().catch(()=>{});}}/></Field><div className="actions">{onRetry&&<Button tone="primary" disabled={busy} onClick={()=>void submit().catch(()=>{})}><Icon name="play"/>{p(busy?'resolutionPreparing':target.run?.executionKind?'workRetryTask':'continueStage')}</Button>}{onDecline&&<Button disabled={busy} onClick={()=>void onDecline(note.trim()||undefined).catch(()=>{})}>{p('resolutionNoRetry')}</Button>}</div></div>}
    <div className="actions">{(stale||!!error)&&<Button onClick={()=>void onRefresh().catch(()=>{})}><Icon name="refresh"/>{p('refresh')}</Button>}{record?.phase==='needs_input'&&target.run&&!target.run.executionKind&&<Button onClick={()=>onStep(target.run!.id,target.stage?.stageId)}>{p('workReviewStepOptions')}<Icon name="arrow-right"/></Button>}{record?.phase==='needs_input'&&onAdvanced&&<Button tone="quiet" onClick={onAdvanced}>{p('workReviewGoalOptions')}</Button>}</div>
    {(messages.length>0||!!record)&&<details className="pf-work-recovery-details"><summary>{p('technical')}</summary>{messages.map(message=><p className="pre-wrap" key={message}>{message}</p>)}{record&&<pre className="json-output">{JSON.stringify(goal.workRecoveryHistory,null,2)}</pre>}</details>}
  </section>;
}
