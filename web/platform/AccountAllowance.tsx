import {useEffect,useState} from 'react';
import type {AllowanceAssessment,AccountAllowanceWindow} from '../../src/account-allowance-types';
import {EFFORT_LABELS} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';

export type AccountAllowanceContext={projectId:string;pipelineId?:string;runId?:string;stageId?:string;intakeId?:string;model?:string};
export function canRequestAccountStep(value:AllowanceAssessment|null|undefined,now=Date.now()):boolean {
  if(!value||value.status==='exhausted'||value.action==='wait'||(value.account.status==='available'&&!value.account.windows.length))return false;
  if(value.status==='unavailable'&&value.action==='owner-step')return true;
  const expires=Date.parse(value.account.expiresAt);
  return Number.isFinite(expires)&&expires>now;
}
export function accountStepNeedsApproval(value:AllowanceAssessment|null|undefined):boolean{return value?.action==='owner-step';}
export function accountStepAuthorization(value:AllowanceAssessment|null|undefined,required=accountStepNeedsApproval(value)):{approveAccountStep?:true;accountAssessmentKey?:string}{return value&&required&&canRequestAccountStep(value)?{approveAccountStep:true,accountAssessmentKey:value.key}:{};}
export function accountAllowancePath(context:AccountAllowanceContext){const params=new URLSearchParams();for(const[key,value]of Object.entries(context))if(value)params.set(key,value);return `/api/account-allowance?${params.toString()}`;}

export function AccountAllowance({context,assessment,onAssessment,onRefresh}:{context:AccountAllowanceContext;assessment?:AllowanceAssessment;onAssessment?:(value:AllowanceAssessment|null)=>void;onRefresh?:()=>Promise<void>}) {
  const [local,setLocal]=useState<AllowanceAssessment|null>(null), [error,setError]=useState<unknown>(null), [busy,setBusy]=useState(false), [now,setNow]=useState(Date.now);
  const path=accountAllowancePath(context), controlled=assessment!==undefined, current=assessment??local;
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(controlled)return;const controller=new AbortController();setLocal(null);onAssessment?.(null);setError(null);
    void api<AllowanceAssessment>(path,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setLocal(value);onAssessment?.(value);}}).catch(error=>{if(!controller.signal.aborted)setError(error);});return()=>controller.abort();
  },[path,controlled]);
  useEffect(()=>{
    if(controlled||!current)return;const expires=Date.parse(current.account.expiresAt);if(!Number.isFinite(expires))return;
    const controller=new AbortController();const timer=setTimeout(()=>{void api<AllowanceAssessment>(path,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setLocal(value);onAssessment?.(value);setError(null);}}).catch(error=>{if(!controller.signal.aborted)setError(error);});},Math.max(1000,expires-Date.now()));
    return()=>{controller.abort();clearTimeout(timer);};
  },[path,controlled,current?.key,current?.account.expiresAt]);
  const refresh=async()=>{
    if(busy)return;setBusy(true);setError(null);if(!controlled)onAssessment?.(null);
    try{if(onRefresh)await onRefresh();else{const value=await api<AllowanceAssessment>('/api/account-allowance',{method:'POST',body:{refresh:true,...context}});setLocal(value);onAssessment?.(value);}setNow(Date.now());}catch(error){setError(error);}finally{setBusy(false);}
  };
  return <AccountAllowanceView assessment={current} busy={busy} error={error} now={now} onRefresh={()=>void refresh()}/>;
}

export function AccountAllowanceView({assessment,busy=false,error=null,now=Date.now(),onRefresh}:{assessment:AllowanceAssessment|null|undefined;busy?:boolean;error?:unknown;now?:number;onRefresh?:()=>void}) {
  const {p,date,locale}=useCopy();
  const format=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
  const percent=(value:number)=>value>0&&value<.01?`<${format(.01)}`:value<100&&value>99.99?`>${format(99.99)}`:format(value);
  const range=(value:number)=>new Intl.NumberFormat(locale,{maximumSignificantDigits:3}).format(value);
  const stale=!!assessment&&(!Number.isFinite(Date.parse(assessment.account.expiresAt))||Date.parse(assessment.account.expiresAt)<=now);
  const missingWindows=assessment?.account.status==='available'&&!assessment.account.windows.length;
  const status=error||stale||missingWindows?'unavailable':assessment?.status;
  const readiness=status==='ready'?'accountCompactReady':status==='learning'?(assessment?.trend.sampleCount===0?'accountCompactLearningEmpty':'accountCompactLearning'):status==='caution'?'accountCompactCaution':status==='exhausted'?'accountCompactExhausted':status==='unavailable'?'accountCompactUnavailable':'accountLoading';
  const reasonKeys={SHARED_ACCOUNT_ACTIVITY:'accountShared',NO_SAMPLES:'accountNoSamples',INSUFFICIENT_SAMPLES:'accountInsufficientSamples',OVERLAPPING_EXECUTIONS:'accountOverlapping',ACCOUNT_CHANGED:'accountChanged',WINDOW_RESET:'accountWindowReset',WINDOW_MISSING:'accountWindowMissing',STALE_OBSERVATION:'accountStale',OBSERVATION_UNAVAILABLE:'accountUnavailable',ZERO_DELTA_UNCERTAIN:'accountZeroUncertain',MODEL_UNRESOLVED:'accountModelUnresolved',CLOCK_CHANGED:'accountClockChanged',ACTIVE_ESTIMATE_UNAVAILABLE:'accountActiveEstimateUnavailable',LIMITED_REMAINING_ACCOUNT_WINDOW:'accountLimitedWindow'} as const;
  const windows=assessment?.account.windows??[],trend=assessment?.trend;
  const sourceReasonKeys={ACCOUNT_ALLOWANCE_UNSUPPORTED:'accountSourceUnsupported',ACCOUNT_ALLOWANCE_READ_FAILED:'accountReadFailed',ACCOUNT_ALLOWANCE_MALFORMED:'accountMalformed',ACCOUNT_IDENTITY_UNAVAILABLE:'accountIdentityUnavailable',ACCOUNT_WINDOWS_MISSING:'accountWindowMissing',ACCOUNT_WINDOW_EXPIRED:'accountObservationExpired',ACCOUNT_CHANGED:'accountChanged',STALE_OBSERVATION:'accountStale',ACCOUNT_LIMIT_REACHED:'accountProviderLimit'}as const;
  const sourceReason=assessment?.account.reason;
  const attention=status==='caution'||status==='unavailable'||status==='exhausted';
  const zeroUncertain=!!trend&&(trend.reasons.includes('ZERO_DELTA_UNCERTAIN')||trend.windows.some(window=>window.lowPercent===0&&window.highPercent===0));
  return <section className={`pf-account-allowance account-${status??'loading'}`} aria-label={p('accountAllowance')}><header><div><Icon name="clock"/><h3>{p('accountAllowance')}</h3></div>{onRefresh&&<Button tone="quiet" disabled={busy} onClick={onRefresh}><Icon name="refresh"/>{p(busy?'accountRefreshing':'refresh')}</Button>}</header>
    {windows.length>0&&<ul className="pf-account-windows">{windows.map(window=><li key={`${window.bucketId}-${window.slot}-${window.windowDurationMins}`}><strong>{windowLabel(window,p,format)}</strong><span>{p('accountRemaining',{percent:percent(window.remainingPercent)})}</span></li>)}</ul>}
    <p className="pf-account-readiness">{p(readiness)} <span className="pf-account-shared">{p('accountSharedCompact')}</span></p>
    {trend&&trend.sampleCount>0&&<p className="pf-account-trend-summary">{p(trend.comparableCount===0?'accountSummaryNoComparable':trend.direction==='rising'?'accountSummaryRising':trend.direction==='falling'?'accountSummaryFalling':trend.direction==='steady'?'accountSummarySteady':'accountSummaryUnknown',{comparable:format(trend.comparableCount),total:format(trend.sampleCount)})}</p>}
    {trend&&trend.windows.length>0&&<ul className="pf-account-range-summary">{trend.windows.map(window=><li key={`${window.bucketId}-${window.slot}-${window.windowDurationMins}`}>{p(trend.reasons.includes('ZERO_DELTA_UNCERTAIN')?'accountUncertaintySummary':'accountRangeSummary',{window:windowLabel(window,p,format),low:range(window.lowPercent),high:range(window.highPercent)})}</li>)}</ul>}
    {(!!assessment||!!error)&&<details className="pf-account-details" open={attention||undefined}><summary>{p('accountDetails')}</summary><div className="pf-account-evidence">
      <ErrorNotice error={error}/>{sourceReason&&sourceReason in sourceReasonKeys&&<p>{p(sourceReasonKeys[sourceReason as keyof typeof sourceReasonKeys])}</p>}{stale&&<p>{p('accountStale')}</p>}{missingWindows&&<p>{p('accountWindowMissing')}</p>}{windows.length>0&&(stale||assessment?.account.status==='unavailable')&&<p>{p('accountUnconfirmedWindows')}</p>}
      {assessment&&<p className="pf-account-observed">{p('accountObservedAt',{date:date(assessment.account.observedAt)})}</p>}
      {windows.length>0&&<ul className="pf-account-reset-list">{windows.map(window=><li key={`${window.bucketId}-${window.slot}-${window.windowDurationMins}`}><strong>{windowLabel(window,p,format)}</strong><span>{p('accountResetAt',{date:date(new Date(window.resetsAt*1000).toISOString())})}</span></li>)}</ul>}
      <p>{p('accountShared')}</p>{trend?.sampleCount===0&&<p>{p('accountNoSamples')}</p>}{trend&&trend.sampleCount>0&&trend.comparableCount===0&&<p>{p('accountNoComparable')}</p>}
      {assessment?.target&&<span>{assessment.target.model??p('inheritedProjectModel')} · {EFFORT_LABELS[assessment.target.effort]}</span>}{trend?.durationSeconds&&<span>{p('accountDurationRange',{low:format(trend.durationSeconds.low),high:format(trend.durationSeconds.high)})}</span>}{zeroUncertain&&<p>{p('accountZeroUncertain')}</p>}{assessment&&assessment.activeExecutions>0&&<p>{p('accountActiveExecutions',{count:format(assessment.activeExecutions)})}</p>}
      {trend&&trend.reasons.filter(reason=>reason!=='SHARED_ACCOUNT_ACTIVITY'&&reason!=='NO_SAMPLES'&&reason!=='ZERO_DELTA_UNCERTAIN').length>0&&<ul className="pf-account-reasons">{trend.reasons.filter(reason=>reason!=='SHARED_ACCOUNT_ACTIVITY'&&reason!=='NO_SAMPLES'&&reason!=='ZERO_DELTA_UNCERTAIN').map(reason=><li key={reason}>{reason in reasonKeys?p(reasonKeys[reason as keyof typeof reasonKeys]):p('accountComparisonExcluded')}</li>)}</ul>}
    </div></details>}
  </section>;
}
function windowLabel(window:Pick<AccountAllowanceWindow,'bucketId'|'windowDurationMins'> & {bucketName?:string},p:ReturnType<typeof useCopy>['p'],format:(value:number)=>string) {
  const minutes=window.windowDurationMins, duration=minutes>=1440&&minutes%1440===0?p('accountWindowDays',{count:format(minutes/1440)}):minutes>=60&&minutes%60===0?p('accountWindowHours',{count:format(minutes/60)}):p('accountWindowMinutes',{count:format(minutes)});
  return `${window.bucketName??window.bucketId} · ${duration}`;
}
