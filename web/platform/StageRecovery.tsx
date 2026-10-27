import {useEffect,useState} from 'react';
import type {Run,RunRecovery} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice,Field,Notice} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';
import {RunLimits} from './RunLimits';
import {AccountAllowance,canRequestAccountStep,accountStepNeedsApproval,accountStepAuthorization} from './AccountAllowance';

export function StageRecovery({run,stageId,onChanged,onGoal}:{run:Run;stageId:string;onChanged:()=>Promise<void>;onGoal?:(id:string)=>void}) {
  const {p,number}=useCopy();
  const [value,setValue]=useState<RunRecovery|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[read,setRead]=useState(0),[note,setNote]=useState(''),[cancelling,setCancelling]=useState(false),[cancelAcknowledged,setCancelAcknowledged]=useState(false),[operation,setOperation]=useState<'continue'|'reconcile'|null>(null),[feedback,setFeedback]=useState<'workCheckConfirmed'|'workCheckUnconfirmed'|'workCheckRecorded'|'workContinuationRecorded'|null>(null);
  const path=`/api/runs/${encodeURIComponent(run.id)}/recovery?stageId=${encodeURIComponent(stageId)}&resourceMode=account`;
  useEffect(()=>{const controller=new AbortController();void api<RunRecovery>(path,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setValue(result);setError(null);}}).catch(error=>{if(!controller.signal.aborted)setError(error);});return()=>controller.abort();},[path,run.updatedAt,read]);
  const stage=run.snapshot.pipeline.stages.find(stage=>stage.id===stageId),requiresAccount=stage?.executor==='codex'||(stage?.executor==='pipeline'&&!!value?.account);
  const account=value?.account,accountBlocked=requiresAccount&&!canRequestAccountStep(account),accountApproval=requiresAccount&&(value?.accountAcknowledgementRequired||accountStepNeedsApproval(account));
  const boundApproval=value?.action==='approve'&&!!value.recommendation&&Object.keys(value.recommendation.limits).some(key=>key!=='tokenBudget');
  const refreshAccount=async()=>{setRefreshing(true);try{await api('/api/account-allowance',{method:'POST',body:{refresh:true,projectId:run.projectId,runId:run.id,stageId}});const result=await api<RunRecovery>(path);setValue(result);setError(null);}finally{setRefreshing(false);}};
  const continueWork=async()=>{
    if(!value||busy||refreshing||!canPerformStageRecovery(value.action,accountBlocked))return;setBusy(true);setOperation(value.action==='reconcile'?'reconcile':'continue');setCancelAcknowledged(false);setError(null);setFeedback(null);
    try{
      if(value.action==='reconcile'){const result=await api<{cleanupConfirmed?:boolean}>(`/api/runs/${encodeURIComponent(run.id)}/stages/${encodeURIComponent(stageId)}/reconcile`,{method:'POST',body:{}});setFeedback(result.cleanupConfirmed?'workCheckConfirmed':'workCheckUnconfirmed');}
      else await api(`/api/runs/${encodeURIComponent(run.id)}/continue`,{method:'POST',body:{stageId,recoveryKey:value.recoveryKey,resourceMode:'account',...(note.trim()?{note:note.trim()}:{}),...(boundApproval?{approveRecommendation:true}:{}),...accountStepAuthorization(account,!!accountApproval)}});
      try{await onChanged();}catch{setFeedback(value.action==='reconcile'?'workCheckRecorded':'workContinuationRecorded');}setRead(value=>value+1);
    }catch(error){setError(error);setRead(value=>value+1);}finally{setBusy(false);setOperation(null);}
  };
  const cancelContinuation=async()=>{if(!busy||operation!=='continue'||cancelling||cancelAcknowledged)return;setCancelling(true);try{await api(`/api/runs/${encodeURIComponent(run.id)}/cancel`,{method:'POST',body:{note:p('cancelContinuationNote')}});setCancelAcknowledged(true);await onChanged();setRead(value=>value+1);}catch(error){setError(error);}finally{setCancelling(false);}};
  return <section className="pf-recovery"><h3>{p('recoveryTitle')}</h3>{!!error&&<Notice tone="warning"><p>{p('workRecoveryRequestUnavailable')}</p><details><summary>{p('technical')}</summary><ErrorNotice error={error}/></details></Notice>}{!value?!error?<p className="hint">{p('recoveryChecking')}</p>:<Button onClick={()=>setRead(value=>value+1)}>{p('refresh')}</Button>:<>
    <div className="pf-recovery-scope">{p(value.scope.kind==='goal'?'recoveryScopeGoal':'recoveryScopeRun')}</div>
    {!value.code.startsWith('ACCOUNT_')&&<p>{value.action==='reconcile'?p('workCheckExecutionHelp'):value.action==='wait'?p('recoveryWait'):value.action==='none'?p('recoveryNone'):recoveryReason(value.code,p,value.reason)}</p>}
    {feedback&&<p role="status" className="pf-recovery-feedback">{p(feedback)}</p>}
    {requiresAccount&&value.action!=='reconcile'&&<AccountAllowance context={{projectId:run.projectId,runId:run.id,stageId}} assessment={account} onRefresh={refreshAccount}/>}
    {boundApproval&&value.recommendation&&<RunRecommendationSummary recommendation={value.recommendation}/>}
    {accountApproval&&['retry','approve'].includes(value.action)&&<p className="pf-account-approval">{p('accountOneStepHelp')}</p>}
    {account?.status==='exhausted'&&value.action!=='reconcile'&&<p>{p('accountWait')}</p>}
    {canPerformStageRecovery(value.action,accountBlocked)&&<Button tone="primary" disabled={busy||refreshing} onClick={()=>void continueWork()}><Icon name={value.action==='reconcile'?'refresh':'play'}/>{busy?p(operation==='reconcile'?'workCheckingExecution':'continuingStage'):p(value.action==='reconcile'?'workCheckExecution':accountApproval?'accountApproveStep':boundApproval?'approveContinue':'continueStage')}</Button>}
    {busy&&operation==='continue'&&!cancelAcknowledged&&<Button tone="danger" disabled={cancelling} onClick={()=>void cancelContinuation()}>{p(cancelling?'cancellingContinuation':'cancelContinuation')}</Button>}{cancelAcknowledged&&<p role="status">{p('continuationCancelRequested')}</p>}
    {value.action==='blocked'&&value.scope.kind==='goal'&&onGoal&&account?.status!=='exhausted'&&<Button onClick={()=>onGoal(value.scope.id)}>{p('continueGoal')}<Icon name="arrow-right"/></Button>}
    <details className="pf-recovery-details"><summary>{p('recoveryAdvanced')}</summary><div className="form-stack"><Field label={p('optionalNote')}><textarea rows={2} value={note} onChange={event=>setNote(event.target.value)}/></Field>{requiresAccount&&<><p className="hint">{p('tokenDiagnosticsHelp')}</p><dl className="metadata-list"><div><dt>{p('tokenDiagnostics')}</dt><dd>{value.allowance.usageComplete?number(value.allowance.usedTokens):p('partial')}</dd></div><div><dt>{p('historicalTokenConfiguration')}</dt><dd>{number(run.snapshot.pipeline.policy.tokenBudget)}</dd></div></dl></>}{value.reason&&<p className="hint">{value.reason}</p>}<RunLimits run={run} disabled={value.action==='reconcile'||value.action==='wait'} onChanged={async()=>{await onChanged();setRead(value=>value+1);}}/></div></details>
  </>}</section>;
}
export function canPerformStageRecovery(action:RunRecovery['action'],accountBlocked:boolean){return action==='reconcile'||(['retry','approve'].includes(action)&&!accountBlocked);}
function recoveryReason(code:string,p:ReturnType<typeof useCopy>['p'],fallback:string) {
  if(code==='GOAL_TOKEN_BUDGET'||code==='GOAL_TIME_LIMIT'||code==='GOAL_ROUND_LIMIT')return p('recoveryGoalLimit');
  if(code==='TOKEN_BUDGET'||code==='RUN_TOKEN_BUDGET'||code==='RUN_TIME_LIMIT'||code==='TIME_LIMIT'||code==='STAGE_ATTEMPTS'||code==='STAGE_ATTEMPT_LIMIT'||code==='STAGE_TIMEOUT'||code==='ATTEMPT_LIMIT')return p('recoveryRunLimit');
  if(code==='RETRY_READY'||code==='READY')return p('recoveryRetryReady');
  return fallback||p('recoveryBlocked');
}
export function RunRecommendationSummary({recommendation}:{recommendation:NonNullable<RunRecovery['recommendation']>}) {
  const {p,number}=useCopy(),basis=recommendation.basis;
  const labels={maxAttempts:'attempts',timeoutSeconds:'seconds',maxIterations:'iterations',concurrency:'concurrency'} as const;
  return <div className="pf-recovery-recommendation"><strong>{p('executionBounds')}</strong><p>{p('recordedAttempts',{count:number(basis.attempts)})}</p><ul>{Object.entries(recommendation.limits).filter(([key])=>key!=='tokenBudget').map(([key,next])=><li key={key}>{p('allowanceChange',{name:p(labels[key as keyof typeof labels]),before:number(basis.previousPolicy[key as keyof typeof labels]),after:number(next)})}</li>)}</ul><p className="hint">{p('accountBoundsEffect')}</p></div>;
}
