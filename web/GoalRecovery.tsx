import {useState} from 'react';
import type {GoalContinuationRecommendation, GoalRecoveryPolicy, GoalRecoveryRecord, Intake, IntakeRetryInput, ModelInfo, Run} from '../src/contracts';
import {Button, ErrorNotice, Field, Notice, Status} from './components';
import {useI18n} from './i18n';
import type {MessageKey} from './locales/en';
import {useCopy} from './platform/copy';
import {Icon} from './Icons';

export const defaultRecoveryPolicy: GoalRecoveryPolicy = {autoRetry: false, maxAttempts: 2, backoffSeconds: 30, allowedFallbackModels: []};

export function RecoveryPolicySummary({value, models}: {value?: GoalRecoveryPolicy; models: ModelInfo[]}) {
  const {t, number} = useI18n(); const policy = value ?? defaultRecoveryPolicy;
  return <details className="goal-recovery-policy"><summary>{t('recoveryCapacityPolicy')} · {t(policy.autoRetry ? 'recoveryEnabled' : 'recoveryDisabled')}</summary><dl className="metadata-list"><div><dt>{t('recoveryMaxAttempts')}</dt><dd>{number(policy.maxAttempts)}</dd></div><div><dt>{t('recoveryBackoff')}</dt><dd>{t('seconds', {count: number(policy.backoffSeconds)})}</dd></div><div><dt>{t('recoveryFallbackPool')}</dt><dd>{policy.allowedFallbackModels.length ? policy.allowedFallbackModels.map(id => models.find(model => model.id === id)?.name ?? id).join(', ') : t('recoveryNoFallback')}</dd></div></dl></details>;
}

export function RecoveryPolicyFields({value, onChange, models, disabled = false}: {value: GoalRecoveryPolicy; onChange: (value: GoalRecoveryPolicy) => void; models: ModelInfo[]; disabled?: boolean}) {
  const {t} = useI18n();
  const unknown = value.allowedFallbackModels.filter(id => !models.some(model => model.id === id));
  return <div className="recovery-policy-fields">
    <label className="check"><input type="checkbox" checked={value.autoRetry} disabled={disabled} onChange={event => onChange({...value, autoRetry: event.target.checked})}/><span>{t('recoveryAuto')}</span></label>
    {value.autoRetry && <>
      <div className="intake-policy-grid"><Field label={t('recoveryMaxAttempts')}><input type="number" min={1} step={1} value={value.maxAttempts} disabled={disabled} onChange={event => onChange({...value, maxAttempts: Number(event.target.value)})}/></Field><Field label={t('recoveryBackoff')}><input type="number" min={1} step={1} value={value.backoffSeconds} disabled={disabled} onChange={event => onChange({...value, backoffSeconds: Number(event.target.value)})}/></Field></div>
      <fieldset><legend>{t('recoveryFallbackPool')}</legend><p className="hint">{t('recoveryFallbackHelp')}</p><div className="check-list recovery-model-pool">{models.map(model => <label key={model.id} className="check"><input type="checkbox" checked={value.allowedFallbackModels.includes(model.id)} disabled={disabled} onChange={event => onChange({...value, allowedFallbackModels: event.target.checked ? [...value.allowedFallbackModels, model.id] : value.allowedFallbackModels.filter(id => id !== model.id)})}/><span>{model.name || model.id}<code className="muted small">{model.id}</code></span></label>)}</div>{!models.length && <p className="hint">{t('recoveryNoModels')}</p>}</fieldset>
      {unknown.length > 0 && <Notice tone="warning"><p>{t('recoveryUnavailableModels', {models: unknown.join(', ')})}</p><Button disabled={disabled} onClick={() => onChange({...value, allowedFallbackModels: value.allowedFallbackModels.filter(id => !unknown.includes(id))})}>{t('recoveryRemoveUnavailable')}</Button></Notice>}
    </>}
  </div>;
}

export function canOpenGoalRecovery(intake:Intake) {
  return !!intake.canRetry || !!intake.recoveryRecommendation || ['GOAL_TOKEN_BUDGET','GOAL_TIME_LIMIT','GOAL_ROUND_LIMIT'].includes(intake.retryBlockedCode??'');
}
export function GoalRetryForm({intake, models, onRetry, onClose}: {intake: Intake; models: ModelInfo[]; onRetry: (input: IntakeRetryInput) => Promise<void>; onClose: () => void}) {
  const {t,number,p}=useCopy();
  const [note,setNote]=useState(''), [model,setModel]=useState(''), [refreshConfiguration,setRefreshConfiguration]=useState(false), [tokens,setTokens]=useState(''), [elapsed,setElapsed]=useState(''), [rounds,setRounds]=useState(''), [overrideRecovery,setOverrideRecovery]=useState(false);
  const [recovery,setRecovery]=useState<GoalRecoveryPolicy>(()=>structuredClone(intake.policy.recovery??defaultRecoveryPolicy));
  const [basis,setBasis]=useState(()=>({key:intake.recoveryKey,recommendation:intake.recoveryRecommendation?structuredClone(intake.recoveryRecommendation):undefined}));
  const [busy,setBusy]=useState(false), [error,setError]=useState<unknown>(null);
  const hasManualPolicy=tokens!==''||elapsed!==''||rounds!==''||overrideRecovery;
  const recommendation=!hasManualPolicy?basis.recommendation:undefined;
  const stale=basis.key!==intake.recoveryKey||(!!recommendation&&!basis.key);
  const blocked=!canOpenGoalRecovery(intake), needsAdjustment=!intake.canRetry&&!recommendation&&!hasManualPolicy, needsAnswer=intake.status==='clarification'&&!!intake.question;
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(blocked||needsAdjustment||stale||busy||(needsAnswer&&!note.trim()))return;
    const policy:NonNullable<IntakeRetryInput['policy']>={};
    if(tokens!=='')policy.maxTotalTokens=Number(tokens);if(elapsed!=='')policy.maxElapsedSeconds=Number(elapsed);if(rounds!=='')policy.maxRounds=Number(rounds);
    if([policy.maxTotalTokens,policy.maxElapsedSeconds,policy.maxRounds].some(value=>value!==undefined&&(!Number.isSafeInteger(value)||value<1))||(overrideRecovery&&(!Number.isSafeInteger(recovery.maxAttempts)||recovery.maxAttempts<1||!Number.isSafeInteger(recovery.backoffSeconds)||recovery.backoffSeconds<1))){setError(new Error(t('intakePolicyInvalid')));return;}
    if(policy.maxRounds!==undefined&&(policy.maxRounds<intake.policy.maxRounds||policy.maxRounds>10)){setError(new Error(t('recoveryRoundRange',{current:intake.policy.maxRounds})));return;}
    if(overrideRecovery)policy.recovery=recovery;
    setBusy(true);setError(null);
    try{await onRetry({...(note.trim()?{note:note.trim()}:{}),...(model?{model}:{}),...(refreshConfiguration?{refreshConfiguration:true}:{}),...(basis.key?{recoveryKey:basis.key}:{}),...(recommendation?{approveRecommendation:true}:{}),...(Object.keys(policy).length?{policy}:{})});onClose();}catch(value){setError(value);}finally{setBusy(false);}
  }
  return <form className="form-stack goal-retry-form" noValidate onSubmit={event=>void submit(event)}><p>{t('recoveryContinueHelp')}</p><ErrorNotice error={error}/>
    {blocked&&<Notice tone="warning">{intake.retryBlockedReason??t('recoveryUnavailable')}</Notice>}
    {!blocked&&!intake.canRetry&&<p>{p('recoveryGoalLimit')}</p>}
    {recommendation&&<GoalRecommendationSummary recommendation={recommendation}/>}
    {stale&&<Notice tone="warning"><p>{p('recoveryContextChanged')}</p><Button onClick={()=>{setBasis({key:intake.recoveryKey,recommendation:intake.recoveryRecommendation?structuredClone(intake.recoveryRecommendation):undefined});setError(null);}}>{p('reloadContinuation')}</Button></Notice>}
    {needsAnswer&&<Field label={t('intakeQuestion')} hint={intake.question}><textarea autoFocus required rows={3} value={note} onChange={event=>setNote(event.target.value)} disabled={busy}/></Field>}
    <details><summary>{p('advancedSettings')}</summary><div className="form-stack">{!needsAnswer&&<Field label={p('optionalNote')}><textarea rows={2} value={note} onChange={event=>setNote(event.target.value)} disabled={busy}/></Field>}<Field label={`${t('recoveryModel')} · ${t('optional')}`}><select value={model} onChange={event=>setModel(event.target.value)} disabled={busy}><option value="">{t('recoveryKeepModel')}</option>{models.map(value=><option key={value.id} value={value.id}>{value.name||value.id}</option>)}</select></Field><label className="check"><input type="checkbox" checked={refreshConfiguration} disabled={busy} onChange={event=>setRefreshConfiguration(event.target.checked)}/><span>{t('recoveryRefreshConfiguration')}</span></label>
      <details><summary>{t('recoveryChangeLimits')}</summary><p className="hint">{p('manualLimitsHelp')}</p><div className="intake-policy-grid"><Field label={t('recoveryActionRounds')} hint={t('recoveryCurrentLimit',{count:number(intake.policy.maxRounds)})}><input type="number" min={intake.policy.maxRounds} max={10} step={1} value={rounds} disabled={busy} onChange={event=>setRounds(event.target.value)}/></Field><Field label={t('intakeMaxTokens')} hint={t('recoveryCurrentLimit',{count:number(intake.policy.maxTotalTokens)})}><input type="number" min={intake.policy.maxTotalTokens} step={1} value={tokens} disabled={busy} onChange={event=>setTokens(event.target.value)}/></Field><Field label={t('intakeMaxElapsed')} hint={t('recoveryCurrentLimit',{count:number(intake.policy.maxElapsedSeconds)})}><input type="number" min={intake.policy.maxElapsedSeconds} step={1} value={elapsed} disabled={busy} onChange={event=>setElapsed(event.target.value)}/></Field></div></details>
      <details><summary>{t('recoveryCapacityPolicy')}</summary><label className="check"><input type="checkbox" checked={overrideRecovery} disabled={busy} onChange={event=>setOverrideRecovery(event.target.checked)}/><span>{t('recoveryChangePolicy')}</span></label>{overrideRecovery&&<RecoveryPolicyFields value={recovery} onChange={setRecovery} models={models} disabled={busy}/>}</details>
    </div></details><div className="form-actions"><Button disabled={busy} onClick={onClose}>{t('close')}</Button><Button type="submit" tone="primary" disabled={busy||blocked||needsAdjustment||stale||(needsAnswer&&!note.trim())}><Icon name="play"/>{busy?t('recoveryContinuing'):recommendation?p('approveContinue'):t('recoveryContinue')}</Button></div>
  </form>;
}

const historyStatus: Record<GoalRecoveryRecord['status'], MessageKey> = {scheduled: 'recoveryScheduled', started: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled'};
export function RecoveryHistory({records, models, runs, onRun}: {records: GoalRecoveryRecord[]; models: ModelInfo[]; runs: Run[]; onRun: (id: string) => void}) {
  const {t, date,p} = useCopy();
  if (!records.length) return null;
  return <details className="goal-recovery-history"><summary>{t('recoveryHistory')} · {records.length}</summary>{[...records].reverse().map(record => <details key={record.id} className="goal-recovery-record"><summary>{t(record.trigger === 'automatic' ? 'recoveryAutomatic' : 'recoveryManual')} · {t(historyStatus[record.status])} · {date(record.at)}</summary><div className="recovery-record-body"><p className="pre-wrap small">{record.reason}</p>{record.note && record.note !== record.reason && <p className="pre-wrap small">{record.note}</p>}<dl className="metadata-list"><div><dt>{t('recoveryModel')}</dt><dd>{record.model?(models.find(model => model.id === record.model)?.name ?? record.model):p('inheritedProjectModel')}</dd></div>{record.actualModel && <div><dt>{t('recoveryActualModel')}</dt><dd><code>{record.actualModel}</code></dd></div>}<div><dt>{t('recoveryBasis')}</dt><dd>{record.previousBasisRevision} → {record.basisRevision}{record.refreshConfiguration && ` · ${t('recoveryConfigurationRefreshed')}`}</dd></div></dl>{record.error && <Notice tone="error">{record.error}</Notice>}<div className="actions intake-run-links"><Button onClick={() => onRun(record.previousRunId)}>{t('recoveryPreviousRun')}{runs.find(run => run.id === record.previousRunId) && <Status value={runs.find(run => run.id === record.previousRunId)!.status}/>}</Button>{record.newRunId && <Button onClick={() => onRun(record.newRunId!)}>{t('recoveryNewRun')}{runs.find(run => run.id === record.newRunId) && <Status value={runs.find(run => run.id === record.newRunId)!.status}/>}</Button>}</div>{(record.previousPolicy || record.newPolicy) && <details><summary>{t('recoveryPolicyChanges')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousPolicy, next: record.newPolicy}, null, 2)}</pre></details>}{(record.previousRef || record.newRef) && <details><summary>{t('executionReference')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousRef, next: record.newRef}, null, 2)}</pre></details>}</div></details>)}</details>;
}

export function GoalRecommendationSummary({recommendation}:{recommendation:GoalContinuationRecommendation}) {
  const {p,t,number}=useCopy(),basis=recommendation.basis;
  return <section className="pf-recovery-recommendation"><strong>{p('recoveryRecommendation')}</strong><p>{p('goalContinuationRecommendation')}</p><p>{p('reportedBudgetUse',{used:number(basis.usedTokens),limit:number(basis.previousPolicy.maxTotalTokens)})}</p><p>{p('goalRecordedUse',{rounds:number(basis.actionRounds),seconds:number(Math.round(basis.usedSeconds))})}</p>{basis.reservedTokens>0&&<p>{p('reservedWorkUse',{tokens:number(basis.reservedTokens)})}</p>}<ul>{Object.entries(recommendation.policy).map(([key,next])=><li key={key}>{p('allowanceChange',{name:t(key==='maxTotalTokens'?'intakeMaxTokens':key==='maxElapsedSeconds'?'intakeMaxElapsed':'recoveryActionRounds'),before:number(basis.previousPolicy[key as keyof typeof recommendation.policy]),after:number(next)})}</li>)}</ul><p className="hint">{p('goalContinuationEffect')}</p></section>;
}
