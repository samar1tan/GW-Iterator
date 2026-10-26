import {useState} from 'react';
import type {GoalRecoveryPolicy, GoalRecoveryRecord, Intake, IntakeRetryInput, ModelInfo, Run} from '../src/contracts';
import {Button, ErrorNotice, Field, Notice, Status} from './components';
import {useI18n} from './i18n';
import type {MessageKey} from './locales/en';

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

export function GoalRetryForm({intake, models, onRetry, onClose}: {intake: Intake; models: ModelInfo[]; onRetry: (input: IntakeRetryInput) => Promise<void>; onClose: () => void}) {
  const {t, number} = useI18n();
  const [note, setNote] = useState('');
  const [model, setModel] = useState('');
  const [refreshConfiguration, setRefreshConfiguration] = useState(false);
  const [tokens, setTokens] = useState('');
  const [elapsed, setElapsed] = useState('');
  const [overrideRecovery, setOverrideRecovery] = useState(false);
  const [recovery, setRecovery] = useState<GoalRecoveryPolicy>(() => structuredClone(intake.policy.recovery ?? defaultRecoveryPolicy));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!intake.canRetry || !note.trim() || busy) return;
    const policy: NonNullable<IntakeRetryInput['policy']> = {};
    if (tokens !== '') policy.maxTotalTokens = Number(tokens);
    if (elapsed !== '') policy.maxElapsedSeconds = Number(elapsed);
    if ([policy.maxTotalTokens, policy.maxElapsedSeconds].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1)) || (overrideRecovery && (!Number.isSafeInteger(recovery.maxAttempts) || recovery.maxAttempts < 1 || !Number.isSafeInteger(recovery.backoffSeconds) || recovery.backoffSeconds < 1))) {setError(new Error(t('intakePolicyInvalid'))); return;}
    if (overrideRecovery) policy.recovery = recovery;
    setBusy(true); setError(null);
    try {await onRetry({note: note.trim(), ...(model ? {model} : {}), ...(refreshConfiguration ? {refreshConfiguration: true} : {}), ...(Object.keys(policy).length ? {policy} : {})}); onClose();}
    catch (error) {setError(error);} finally {setBusy(false);}
  }

  return <form className="form-stack goal-retry-form" noValidate onSubmit={event => void submit(event)}>
    <h3>{t('recoveryContinue')}</h3><p className="hint">{t('recoveryContinueHelp')}</p><ErrorNotice error={error}/>
    {!intake.canRetry && <Notice tone="warning">{intake.retryBlockedReason ?? t('recoveryUnavailable')}</Notice>}
    <Field label={t('recoveryNote')}><textarea required rows={3} value={note} onChange={event => setNote(event.target.value)} disabled={busy}/></Field>
    <Field label={`${t('recoveryModel')} · ${t('optional')}`}><select value={model} onChange={event => setModel(event.target.value)} disabled={busy}><option value="">{t('recoveryKeepModel')}</option>{models.map(value => <option key={value.id} value={value.id}>{value.name || value.id} · {value.id}</option>)}</select></Field>
    <label className="check"><input type="checkbox" checked={refreshConfiguration} disabled={busy} onChange={event => setRefreshConfiguration(event.target.checked)}/><span>{t('recoveryRefreshConfiguration')}</span></label>
    <details><summary>{t('recoveryChangeLimits')}</summary><div className="intake-policy-grid"><Field label={t('intakeMaxTokens')} hint={t('recoveryCurrentLimit', {count: number(intake.policy.maxTotalTokens)})}><input type="number" min={1} step={1} value={tokens} disabled={busy} onChange={event => setTokens(event.target.value)}/></Field><Field label={t('intakeMaxElapsed')} hint={t('recoveryCurrentLimit', {count: number(intake.policy.maxElapsedSeconds)})}><input type="number" min={1} step={1} value={elapsed} disabled={busy} onChange={event => setElapsed(event.target.value)}/></Field></div></details>
    <details><summary>{t('recoveryCapacityPolicy')}</summary><label className="check"><input type="checkbox" checked={overrideRecovery} disabled={busy} onChange={event => setOverrideRecovery(event.target.checked)}/><span>{t('recoveryChangePolicy')}</span></label>{overrideRecovery && <RecoveryPolicyFields value={recovery} onChange={setRecovery} models={models} disabled={busy}/>}</details>
    <div className="actions"><Button disabled={busy} onClick={onClose}>{t('close')}</Button><Button type="submit" tone="primary" disabled={busy || !intake.canRetry || !note.trim()}>{busy ? t('recoveryContinuing') : t('recoveryContinue')}</Button></div>
  </form>;
}

const historyStatus: Record<GoalRecoveryRecord['status'], MessageKey> = {scheduled: 'recoveryScheduled', started: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled'};
export function RecoveryHistory({records, models, runs, onRun}: {records: GoalRecoveryRecord[]; models: ModelInfo[]; runs: Run[]; onRun: (id: string) => void}) {
  const {t, date} = useI18n();
  if (!records.length) return null;
  return <details className="goal-recovery-history"><summary>{t('recoveryHistory')} · {records.length}</summary>{[...records].reverse().map(record => <details key={record.id} className="goal-recovery-record"><summary>{t(record.trigger === 'automatic' ? 'recoveryAutomatic' : 'recoveryManual')} · {t(historyStatus[record.status])} · {date(record.at)}</summary><div className="recovery-record-body"><p className="pre-wrap small">{record.reason}</p>{record.note && record.note !== record.reason && <p className="pre-wrap small">{record.note}</p>}<dl className="metadata-list"><div><dt>{t('recoveryModel')}</dt><dd>{models.find(model => model.id === record.model)?.name ?? record.model}</dd></div>{record.actualModel && <div><dt>{t('recoveryActualModel')}</dt><dd><code>{record.actualModel}</code></dd></div>}<div><dt>{t('recoveryBasis')}</dt><dd>{record.previousBasisRevision} → {record.basisRevision}{record.refreshConfiguration && ` · ${t('recoveryConfigurationRefreshed')}`}</dd></div></dl>{record.error && <Notice tone="error">{record.error}</Notice>}<div className="actions intake-run-links"><Button onClick={() => onRun(record.previousRunId)}>{t('recoveryPreviousRun')}{runs.find(run => run.id === record.previousRunId) && <Status value={runs.find(run => run.id === record.previousRunId)!.status}/>}</Button>{record.newRunId && <Button onClick={() => onRun(record.newRunId!)}>{t('recoveryNewRun')}{runs.find(run => run.id === record.newRunId) && <Status value={runs.find(run => run.id === record.newRunId)!.status}/>}</Button>}</div>{(record.previousPolicy || record.newPolicy) && <details><summary>{t('recoveryPolicyChanges')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousPolicy, next: record.newPolicy}, null, 2)}</pre></details>}{(record.previousRef || record.newRef) && <details><summary>{t('executionReference')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousRef, next: record.newRef}, null, 2)}</pre></details>}</div></details>)}</details>;
}
