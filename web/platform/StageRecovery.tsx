import {useEffect,useState} from 'react';
import type {Run,RunRecovery} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice,Field,Notice} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';
import {RunLimits} from './RunLimits';

export function StageRecovery({run,stageId,onChanged,onGoal}:{run:Run;stageId:string;onChanged:()=>Promise<void>;onGoal?:(id:string)=>void}) {
  const {p,number}=useCopy();
  const [value,setValue]=useState<RunRecovery|null>(null), [error,setError]=useState<unknown>(null), [busy,setBusy]=useState(false), [read,setRead]=useState(0), [note,setNote]=useState('');
  useEffect(()=>{const controller=new AbortController();void api<RunRecovery>(`/api/runs/${encodeURIComponent(run.id)}/recovery?stageId=${encodeURIComponent(stageId)}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setValue(result);setError(null);}}).catch(error=>{if(!controller.signal.aborted)setError(error);});return()=>controller.abort();},[run.id,stageId,run.updatedAt,read]);
  const continueWork=async()=>{
    if(!value||busy)return;setBusy(true);setError(null);
    try {
      if(value.action==='reconcile') await api(`/api/runs/${encodeURIComponent(run.id)}/stages/${encodeURIComponent(stageId)}/reconcile`,{method:'POST',body:{}});
      else await api(`/api/runs/${encodeURIComponent(run.id)}/continue`,{method:'POST',body:{stageId,recoveryKey:value.recoveryKey,...(note.trim()?{note:note.trim()}:{}),...(value.action==='approve'?{approveRecommendation:true}:{})}});
      await onChanged();setRead(value=>value+1);
    }catch(error){setError(error);setRead(value=>value+1);}finally{setBusy(false);}
  };
  return <section className="pf-recovery"><h3>{p('recoveryTitle')}</h3><ErrorNotice error={error}/>{!value?!error?<p className="hint">{p('recoveryChecking')}</p>:<Button onClick={()=>setRead(value=>value+1)}>{p('refresh')}</Button>:<>
    <div className="pf-recovery-scope">{p(value.scope.kind==='goal'?'recoveryScopeGoal':'recoveryScopeRun')}</div>
    <p>{value.action==='reconcile'?p('externalUnconfirmed'):value.action==='wait'?p('recoveryWait'):value.action==='none'?p('recoveryNone'):recoveryReason(value.code,p,value.reason)}</p>
    {value.action==='approve'&&value.recommendation&&<RunRecommendationSummary recommendation={value.recommendation} usageComplete={value.allowance.usageComplete} showTokenUse={run.snapshot.pipeline.stages.some(stage=>stage.executor==='codex')||value.recommendation.basis.usedTokens>0||value.recommendation.basis.reservedTokens>0||value.recommendation.limits.tokenBudget!==undefined}/>}
    {value.action==='retry'&&!value.allowance.usageComplete&&<p className="hint">{p('usageUnknown')}</p>}
    {['retry','approve','reconcile'].includes(value.action)&&<Button tone={value.action==='reconcile'?'default':'primary'} disabled={busy} onClick={()=>void continueWork()}><Icon name={value.action==='reconcile'?'refresh':'play'}/>{busy?p(value.action==='reconcile'?'reconcilingExternal':'continuingStage'):p(value.action==='reconcile'?'reconcileExternal':value.action==='approve'?'approveContinue':'continueStage')}</Button>}
    {value.action==='blocked'&&value.scope.kind==='goal'&&onGoal&&<Button onClick={()=>onGoal(value.scope.id)}>{p('continueGoal')}<Icon name="arrow-right"/></Button>}
    <details className="pf-recovery-details"><summary>{p('recoveryAdvanced')}</summary><div className="form-stack"><Field label={p('optionalNote')}><textarea rows={2} value={note} onChange={event=>setNote(event.target.value)}/></Field><dl className="metadata-list"><div><dt>{p('usage')}</dt><dd>{value.allowance.usageComplete?number(value.allowance.usedTokens):p('partial')}</dd></div><div><dt>{p('newTokens')}</dt><dd>{number(value.allowance.policy.tokenBudget)}</dd></div></dl>{value.reason&&<p className="hint">{value.reason}</p>}<RunLimits run={run} disabled={value.action==='reconcile'||value.action==='wait'} onChanged={async()=>{await onChanged();setRead(value=>value+1);}}/></div></details>
  </>}</section>;
}
function recoveryReason(code:string,p:ReturnType<typeof useCopy>['p'],fallback:string) {
  if(code==='GOAL_TOKEN_BUDGET'||code==='GOAL_TIME_LIMIT'||code==='GOAL_ROUND_LIMIT')return p('recoveryGoalLimit');
  if(code==='TOKEN_BUDGET'||code==='RUN_TOKEN_BUDGET'||code==='RUN_TIME_LIMIT'||code==='TIME_LIMIT'||code==='STAGE_ATTEMPTS'||code==='STAGE_ATTEMPT_LIMIT'||code==='STAGE_TIMEOUT'||code==='ATTEMPT_LIMIT')return p('recoveryRunLimit');
  if(code==='RETRY_READY'||code==='READY')return p('recoveryRetryReady');
  return fallback||p('recoveryBlocked');
}

export function RunRecommendationSummary({recommendation,usageComplete,showTokenUse=true}:{recommendation:NonNullable<RunRecovery['recommendation']>;usageComplete:boolean;showTokenUse?:boolean}) {
  const {p,number}=useCopy(),basis=recommendation.basis;
  const labels={tokenBudget:'newTokens',maxAttempts:'attempts',timeoutSeconds:'seconds',maxIterations:'iterations',concurrency:'concurrency'} as const;
  return <div className="pf-recovery-recommendation"><strong>{p('recoveryRecommendation')}</strong><p>{p('recoveryProposalSummary')}</p>{showTokenUse&&<p>{p('reportedBudgetUse',{used:number(basis.usedTokens),limit:number(basis.previousPolicy.tokenBudget)})}</p>}{showTokenUse&&basis.previousAttemptTokens!==undefined&&<p>{p('lastAttemptUse',{tokens:number(basis.previousAttemptTokens)})}</p>}{showTokenUse&&basis.reservedTokens>0&&<p>{p('reservedWorkUse',{tokens:number(basis.reservedTokens)})}</p>}{showTokenUse&&!usageComplete&&<p className="hint">{p('usageUnknown')}</p>}<ul>{Object.entries(recommendation.limits).filter(([key])=>showTokenUse||key!=='tokenBudget').map(([key,next])=><li key={key}>{p('allowanceChange',{name:p(labels[key as keyof typeof labels]),before:number(basis.previousPolicy[key as keyof typeof labels]),after:number(next)})}</li>)}</ul><p className="hint">{p('recoveryProposalHelp')}</p></div>;
}
