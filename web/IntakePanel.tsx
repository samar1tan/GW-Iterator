import { useRef, useState } from 'react';
import {budgetTokens} from '../src/contracts';
import type { GoalRecoveryPolicy, Intake, IntakeRetryInput, ModelInfo, ProjectDetail, Run } from '../src/contracts';
import { api, uid } from './api';
import { Button, ErrorNotice, Field, NativeGoalInfo, Notice, RoleTags, SectionTitle, Status } from './components';
import { useI18n } from './i18n';
import type { MessageKey } from './locales/en';
import {defaultRecoveryPolicy, GoalRetryForm, RecoveryHistory, RecoveryPolicyFields, RecoveryPolicySummary} from './GoalRecovery';

const statusKeys: Record<Intake['status'], MessageKey> = {
  routing: 'intakeRouting', dispatched: 'intakeDispatched', clarification: 'intakeClarification',
  failed: 'intakeFailed', completed: 'intakeCompleted', stopped: 'intakeStopped', retry_wait: 'recoveryRetryWait',
};
const decisionKeys = {
  dispatch: 'intakeDecisionDispatch', retry: 'intakeDecisionRetry', complete: 'intakeDecisionComplete',
  clarify: 'intakeDecisionClarify', stop: 'intakeDecisionStop',
} as const;
const defaultPolicy = { maxRounds: 4, maxParallel: 2, maxTotalTokens: 250000, maxElapsedSeconds: 1800 };

export function IntakePanel({ detail, models, selectedId, onSelect, onRun, onChanged }: {
  detail: ProjectDetail;
  models: ModelInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onRun: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [request, setRequest] = useState('');
  const [baseline, setBaseline] = useState('');
  const [policy, setPolicy] = useState(defaultPolicy);
  const [recovery, setRecovery] = useState<GoalRecoveryPolicy>(() => structuredClone(defaultRecoveryPolicy));
  const [submitted, setSubmitted] = useState<Intake | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const idempotencyKey = useRef(uid());
  const intakes = [...(detail.intakes ?? [])];
  if (submitted && !intakes.some(intake => intake.id === submitted.id)) intakes.push(submitted);
  intakes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = intakes.find(intake => intake.id === selectedId) ?? intakes[0];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!request.trim() || busy) return;
    if (Object.values(policy).some(value => !Number.isSafeInteger(value) || value < 1)) {
      setError(new Error(t('intakePolicyInvalid'))); return;
    }
    setBusy(true); setError(null);
    try {
      const intake = await api<Intake>(`/api/projects/${encodeURIComponent(detail.project.id)}/intakes`, {
        method: 'POST',
        body: { request: request.trim(), ...(baseline.trim() ? { baseline: baseline.trim() } : {}), policy: {...policy, recovery}, idempotencyKey: idempotencyKey.current },
      });
      setSubmitted(intake); onSelect(intake.id);
      setRequest(''); setBaseline(''); idempotencyKey.current = uid();
      await onChanged();
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  }

  return <section className="panel intake-panel">
    <SectionTitle title={t('intakeTitle')} subtitle={t('intakeHelp')} />
    <div className={`intake-layout ${selected ? 'with-history' : ''}`}>
      <form className="form-stack intake-form" noValidate onSubmit={event => void submit(event)}>
        <ErrorNotice error={error} />
        <Field label={t('intakeRequest')}>
          <textarea required rows={3} value={request} onChange={event => setRequest(event.target.value)} placeholder={t('intakeExample')} />
        </Field>
        <details>
          <summary>{t('baseline')} · {t('optional')}</summary>
          <Field label={t('baseline')} hint={t('intakeBaselineHelp')}>
            <textarea rows={2} value={baseline} onChange={event => setBaseline(event.target.value)} />
          </Field>
        </details>
        <details>
          <summary>{t('intakeBounds')}</summary>
          <div className="intake-policy-grid">
            <Field label={t('intakeMaxRounds')}><input type="number" min={1} step={1} value={policy.maxRounds} onChange={event => setPolicy({ ...policy, maxRounds: Number(event.target.value) })} /></Field>
            <Field label={t('intakeMaxParallel')}><input type="number" min={1} step={1} value={policy.maxParallel} onChange={event => setPolicy({ ...policy, maxParallel: Number(event.target.value) })} /></Field>
            <Field label={t('intakeMaxTokens')}><input type="number" min={1} step={1} value={policy.maxTotalTokens} onChange={event => setPolicy({ ...policy, maxTotalTokens: Number(event.target.value) })} /></Field>
            <Field label={t('intakeMaxElapsed')}><input type="number" min={1} step={1} value={policy.maxElapsedSeconds} onChange={event => setPolicy({ ...policy, maxElapsedSeconds: Number(event.target.value) })} /></Field>
          </div>
        </details>
        <details><summary>{t('recoveryCapacityPolicy')}</summary><RecoveryPolicyFields value={recovery} onChange={setRecovery} models={models}/></details>
        <div className="intake-submit"><Button type="submit" tone="primary" disabled={busy || !request.trim()}>{busy ? t('intakeSubmitting') : t('intakeSubmit')}</Button></div>
      </form>
      {selected && <div className="intake-history">
        <Field label={t('intakeHistory')}>
          <select value={selected.id} onChange={event => onSelect(event.target.value)}>
            {intakes.map(intake => <option key={intake.id} value={intake.id}>{intake.request.slice(0, 110)} · {t(statusKeys[intake.status])}</option>)}
          </select>
        </Field>
        <IntakeRecord key={selected.id} intake={selected} detail={detail} models={models} onRun={onRun} onChanged={onChanged} />
      </div>}
    </div>
  </section>;
}

function IntakeRecord({ intake, detail, models, onRun, onChanged }: { intake: Intake; detail: ProjectDetail; models: ModelInfo[]; onRun: (id: string) => void; onChanged: () => Promise<void> }) {
  const { t, date, number } = useI18n();
  const [stopOpen, setStopOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rounds = intake.rounds ?? [];
  const latest = rounds.at(-1);
  const allRunIds = new Set([...(intake.supervisorRunIds ?? [intake.routerRunId]), intake.routerRunId, ...(intake.targetRunIds ?? []), ...rounds.flatMap(round => [round.routerRunId, ...round.targetRunIds]), ...(intake.recoveryHistory ?? []).flatMap(record => [record.previousRunId, ...(record.newRunId ? [record.newRunId] : [])])]);
  let expanded = true;
  while (expanded) { expanded = false; for (const run of detail.runs) if (run.parentRunId && allRunIds.has(run.parentRunId) && !allRunIds.has(run.id)) { allRunIds.add(run.id); expanded = true; } }
  const knownRuns = detail.runs.filter(run => allRunIds.has(run.id));
  const codexAttempts = knownRuns.flatMap(run => run.stages.filter(stage => run.snapshot.pipeline.stages.find(definition => definition.id === stage.stageId)?.executor === 'codex').flatMap(stage => stage.attempts));
  const reportedAttempts = codexAttempts.filter(attempt => attempt.usage !== undefined);
  const reportedTokens = reportedAttempts.reduce((total, attempt) => total + budgetTokens(attempt.usage!), 0);
  const nativeRun = knownRuns.find(run => run.id === intake.routerRunId && run.executionKind === 'native-goal');
  const nativeAttempt = nativeRun?.stages.flatMap(stage => stage.attempts).at(-1);

  async function continueGoal(input: IntakeRetryInput) { await api(`/api/intakes/${encodeURIComponent(intake.id)}/retry`, {method: 'POST', body: input}); await onChanged(); }

  async function stop(event: React.FormEvent) {
    event.preventDefault(); if (!note.trim() || busy) return;
    setBusy(true); setError(null);
    try { await api(`/api/intakes/${encodeURIComponent(intake.id)}/cancel`, { method: 'POST', body: { note: note.trim() } }); await onChanged(); setStopOpen(false); setNote(''); }
    catch (error) { setError(error); }
    finally { setBusy(false); }
  }

  return <div className="intake-record">
    <div className="row-between"><span className="intake-result-status">{nativeRun && <span className="small muted">{t('intakeGwiStatus')}</span>}<span className={`tag intake-status intake-${intake.status}`}>{t(statusKeys[intake.status])}</span></span><time className="small muted" dateTime={intake.updatedAt}>{date(intake.updatedAt)}</time></div>
    <p className="pre-wrap intake-request-text">{intake.request}</p>
    {intake.nextRetryAt && <Notice>{t('recoveryNextRetry', {date: date(intake.nextRetryAt)})}</Notice>}
    {intake.outcome && <div className="intake-reason"><h3>{t('intakeOutcome')}</h3><p className="pre-wrap">{intake.outcome}</p></div>}
    {intake.question && <Notice tone="warning"><strong>{t('intakeQuestion')}</strong><p className="pre-wrap">{intake.question}</p></Notice>}
    {intake.error && <Notice tone="error">{intake.error}</Notice>}
    <div className="small muted intake-cost">{reportedAttempts.length ? <>{t('newTokensReported')}: {number(reportedTokens)}{reportedAttempts.length < codexAttempts.length && ` · ${t('intakePartialUsage')}`}{reportedAttempts.some(attempt => attempt.usage?.cachedInput === undefined) && ` · ${t('newTokensConservative')}`}</> : t('noUsage')}</div>
    {nativeAttempt && <NativeGoalInfo attempt={nativeAttempt} />}
    {intake.policy && <details className="intake-saved-bounds"><summary>{t('intakeBounds')}</summary><dl className="metadata-list"><div><dt>{t('intakeMaxRounds')}</dt><dd>{number(intake.policy.maxRounds)}</dd></div><div><dt>{t('intakeMaxParallel')}</dt><dd>{number(intake.policy.maxParallel)}</dd></div><div><dt>{t('intakeMaxTokens')}</dt><dd>{number(intake.policy.maxTotalTokens)}</dd></div><div><dt>{t('intakeMaxElapsed')}</dt><dd>{number(intake.policy.maxElapsedSeconds)}</dd></div></dl></details>}
    {rounds.length > 0 ? <div className="intake-rounds">{rounds.map(round => <details key={round.number} className="intake-round" open={round.number === latest?.number}>
      <summary>{t('intakeRound', { number: round.number })} · {round.decision ? t(decisionKeys[round.decision.action]) : t('intakeRouting')}</summary>
      <div className="intake-round-body">
        {round.decision && <><div className="intake-reason"><h3>{t('intakeRationale')}</h3><p className="pre-wrap">{round.decision.rationale}</p></div><div className="intake-reason"><h3>{t('intakeExpectedGain')}</h3><p className="pre-wrap">{round.decision.expectedGain}</p></div>{round.decision.question && round.decision.question !== intake.question && <Notice tone="warning">{round.decision.question}</Notice>}{round.decision.tasks.length > 0 && <section className="intake-tasks"><h3>{t('intakeActions')}</h3>{round.decision.tasks.map((task, index) => {
          const target = detail.runs.find(run => round.targetRunIds.includes(run.id) && run.pipelineId === task.pipelineId);
          const pipeline = target?.snapshot.pipeline ?? detail.pipelines.find(item => item.id === task.pipelineId);
          const roles = pipeline ? [...new Set([pipeline.roleId, ...pipeline.stages.map(stage => stage.roleId)])] : [];
          return <div className="intake-task" key={`${task.pipelineId}-${index}`}><strong>{pipeline?.name ?? task.pipelineId}</strong><p className="pre-wrap">{task.goal}</p>{pipeline && <RoleTags roles={roles} profiles={target?.snapshot.project.roles ?? detail.project.roles} />}</div>;
        })}</section>}</>}
        <div className="actions intake-run-links"><Button onClick={() => onRun(round.routerRunId)}>{t('intakeRouterRun')}</Button></div>
        {round.targetRunIds.length > 0 && <div className="intake-evidence"><h3>{t('intakeEvidence')}</h3>{round.targetRunIds.map(id => <GoalRunLink key={id} id={id} run={detail.runs.find(run => run.id === id)} onRun={onRun} />)}</div>}
      </div>
    </details>)}</div> : <><div className="intake-reason">{intake.rationale && <p className="pre-wrap">{intake.rationale}</p>}</div><div className="actions intake-run-links">{intake.routerRunId && <Button onClick={() => onRun(intake.routerRunId)}>{t('intakeRouterRun')}</Button>}{intake.targetRunId && <GoalRunLink id={intake.targetRunId} run={detail.runs.find(run => run.id === intake.targetRunId)} onRun={onRun} />}</div></>}
    <RecoveryPolicySummary value={intake.policy.recovery} models={models}/>
    <RecoveryHistory records={intake.recoveryHistory ?? []} models={models} runs={detail.runs} onRun={onRun}/>
    {intake.status !== 'completed' && (retryOpen ? <GoalRetryForm intake={intake} models={models} onRetry={continueGoal} onClose={() => setRetryOpen(false)}/> : <div className="goal-continue-control"><Button disabled={!intake.canRetry} onClick={() => setRetryOpen(true)}>{t('recoveryContinue')}</Button>{!intake.canRetry && intake.retryBlockedReason && <p className="hint">{intake.retryBlockedReason}</p>}</div>)}
    <ErrorNotice error={error} />
    {['routing', 'dispatched', 'retry_wait'].includes(intake.status) && (stopOpen ? <form className="form-stack intake-stop-form" onSubmit={event => void stop(event)}><Field label={t('intakeStopNote')}><textarea required rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field><div className="actions"><Button onClick={() => setStopOpen(false)} disabled={busy}>{t('close')}</Button><Button type="submit" tone="danger" disabled={busy || !note.trim()}>{busy ? t('intakeStopping') : t('intakeStop')}</Button></div></form> : <div><Button tone="danger" onClick={() => setStopOpen(true)}>{t('intakeStop')}</Button></div>)}
  </div>;
}

function GoalRunLink({ id, run, onRun }: { id: string; run?: Run; onRun: (id: string) => void }) {
  const { t } = useI18n();
  return <Button className="intake-goal-run" onClick={() => onRun(id)}><span>{run?.snapshot.pipeline.name ?? t('intakeTargetRun')} · <code>{id.slice(-8)}</code></span>{run && <Status value={run.status} />}</Button>;
}
