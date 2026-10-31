import {useEffect,useId,useRef,useState} from 'react';
import type {GoalRecoveryPolicy, GoalRecoveryRecord, Intake, IntakeRetryInput, ModelInfo, Run} from '../src/contracts';
import {Button, ErrorNotice, Field, Modal, Notice, Status} from './components';
import {useI18n} from './i18n';
import type {MessageKey} from './locales/en';
import {useCopy} from './platform/copy';
import {Icon} from './Icons';
import {api,uid} from './api';
import {AttachmentArea,AttachmentControls,SubmittedAttachments,goalInstructionScope,useGoalAttachments} from './platform/GoalAttachments';
import {useTextDraft} from './platform/useTextDraft';
import {submittedDraftKey} from './platform/workStart';
import {requestEnterAction} from './platform/requestKeys';
import type {AllowanceAssessment} from '../src/account-allowance-types';
import {AccountAllowance,canRequestAccountStep,accountStepNeedsApproval,accountStepAuthorization} from './platform/AccountAllowance';
import {HistoricalExecutionPolicy} from './platform/ExecutionHistory';

export const defaultRecoveryPolicy: GoalRecoveryPolicy = {autoRetry: false, backoffSeconds: 30, allowedFallbackModels: []};

export function RecoveryPolicySummary({value, models}: {value?: GoalRecoveryPolicy; models: ModelInfo[]}) {
  const {t, number} = useI18n(); const policy = value ?? defaultRecoveryPolicy;
  return <details className="goal-recovery-policy"><summary>{t('recoveryCapacityPolicy')} · {t(policy.autoRetry ? 'recoveryEnabled' : 'recoveryDisabled')}</summary><dl className="metadata-list"><div><dt>{t('recoveryBackoff')}</dt><dd>{t('seconds', {count: number(policy.backoffSeconds)})}</dd></div><div><dt>{t('recoveryFallbackPool')}</dt><dd>{policy.allowedFallbackModels.length ? policy.allowedFallbackModels.map(id => models.find(model => model.id === id)?.name ?? id).join(', ') : t('recoveryNoFallback')}</dd></div></dl></details>;
}

export function RecoveryPolicyFields({value, onChange, models, disabled = false}: {value: GoalRecoveryPolicy; onChange: (value: GoalRecoveryPolicy) => void; models: ModelInfo[]; disabled?: boolean}) {
  const {t} = useI18n();
  const unknown = value.allowedFallbackModels.filter(id => !models.some(model => model.id === id));
  return <div className="recovery-policy-fields">
    <label className="check"><input type="checkbox" checked={value.autoRetry} disabled={disabled} onChange={event => onChange({...value, autoRetry: event.target.checked})}/><span>{t('recoveryAuto')}</span></label>
    {value.autoRetry && <>
      <Field label={t('recoveryBackoff')}><input type="number" min={1} step={1} value={value.backoffSeconds} disabled={disabled} onChange={event => onChange({...value, backoffSeconds: Number(event.target.value)})}/></Field>
      <fieldset><legend>{t('recoveryFallbackPool')}</legend><p className="hint">{t('recoveryFallbackHelp')}</p><div className="check-list recovery-model-pool">{models.map(model => <label key={model.id} className="check"><input type="checkbox" checked={value.allowedFallbackModels.includes(model.id)} disabled={disabled} onChange={event => onChange({...value, allowedFallbackModels: event.target.checked ? [...value.allowedFallbackModels, model.id] : value.allowedFallbackModels.filter(id => id !== model.id)})}/><span>{model.name || model.id}<code className="muted small">{model.id}</code></span></label>)}</div>{!models.length && <p className="hint">{t('recoveryNoModels')}</p>}</fieldset>
      {unknown.length > 0 && <Notice tone="warning"><p>{t('recoveryUnavailableModels', {models: unknown.join(', ')})}</p><Button disabled={disabled} onClick={() => onChange({...value, allowedFallbackModels: value.allowedFallbackModels.filter(id => !unknown.includes(id))})}>{t('recoveryRemoveUnavailable')}</Button></Notice>}
    </>}
  </div>;
}

export function canOpenGoalRecovery(intake:Intake) {
  if(['EXECUTION_ACTIVE','GOAL_WORK_ACTIVE','RECOVERY_IN_PROGRESS','EXTERNAL_RECONCILIATION_REQUIRED','GOAL_COMPLETED'].includes(intake.retryBlockedCode??''))return false;
  const item=intake as Intake;
  return !!intake.retryBlockedCode?.startsWith('ACCOUNT_')||!!intake.canRetry||!!item.account||!!item.accountAcknowledgementRequired||['GOAL_TOKEN_BUDGET','GOAL_TIME_LIMIT','GOAL_ROUND_LIMIT'].includes(intake.retryBlockedCode??'');
}
function continuationBasis(intake:Intake){return{key:intake.recoveryKey,account:intake.account,accountAcknowledgementRequired:intake.accountAcknowledgementRequired};}
export function GoalRetryForm({intake,models,onRetry,onClose,onChanged}:{intake:Intake;models:ModelInfo[];onRetry:(input:IntakeRetryInput)=>Promise<void>;onClose:()=>void;onChanged?:()=>Promise<void>}) {
  const {t,p}=useCopy();
  const [scope,setScope]=useState(()=>goalInstructionScope(intake)),formId=useId(),composing=useRef(false),working=useRef(false),mounted=useRef(true),attachments=useGoalAttachments(intake.projectId,scope);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const[note,setNote,clearNote]=useTextDraft(scope),[storedKey,setStoredKey,clearStoredKey]=useTextDraft(scope+':key');
  const [model,setModel]=useState(''),[refreshConfiguration,setRefreshConfiguration]=useState(false),[overrideRecovery,setOverrideRecovery]=useState(false);
  const [recovery,setRecovery]=useState<GoalRecoveryPolicy>(()=>structuredClone(intake.policy.recovery??defaultRecoveryPolicy));
  const [basis,setBasis]=useState(()=>continuationBasis(intake as Intake)),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState<unknown>(null),[cancelling,setCancelling]=useState(false),[cancelAcknowledged,setCancelAcknowledged]=useState(false);
  const stale=basis.key!==intake.recoveryKey,accountBlocked=!canRequestAccountStep(basis.account),accountApproval=basis.accountAcknowledgementRequired||accountStepNeedsApproval(basis.account);
  const legacyQuota=['GOAL_TOKEN_BUDGET','GOAL_TIME_LIMIT','GOAL_ROUND_LIMIT'].includes(intake.retryBlockedCode??'');
  const blocked=!canOpenGoalRecovery({...intake,account:basis.account}),needsAdjustment=!intake.canRetry&&!overrideRecovery&&!accountApproval&&!legacyQuota,needsAnswer=intake.status==='clarification'&&!!intake.question;
  const refreshAccount=async()=>{
    setRefreshing(true);try{const account=await api<AllowanceAssessment>('/api/account-allowance',{method:'POST',body:{refresh:true,projectId:intake.projectId,intakeId:intake.id,...(model?{model}:{})}});const result=await api<{intakes:Intake[]}>(`/api/projects/${encodeURIComponent(intake.projectId)}/intakes`);const current=result.intakes.find(item=>item.id===intake.id);if(!current)throw new Error(p('accountDecisionUnavailable'));await onChanged?.();setBasis(previous=>({...previous,...(previous.key===current.recoveryKey?continuationBasis(current):{}),account}));setError(null);}finally{setRefreshing(false);}
  };
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(working.current||attachments.blocked||blocked||needsAdjustment||stale||busy||refreshing||accountBlocked||(needsAnswer&&!note.trim()))return;
    const policy:NonNullable<IntakeRetryInput['policy']>={};
    if(overrideRecovery&&(!Number.isSafeInteger(recovery.backoffSeconds)||recovery.backoffSeconds<1)){setError(new Error(t('recoveryBackoffInvalid')));return;}
    if(overrideRecovery)policy.recovery={autoRetry:recovery.autoRetry,backoffSeconds:recovery.backoffSeconds,allowedFallbackModels:[...recovery.allowedFallbackModels]};
    working.current=true;setBusy(true);setCancelAcknowledged(false);setError(null);
    const snapshot=attachments.value,submission=submittedDraftKey(JSON.stringify({note:note.trim(),attachmentIds:attachments.ids,model,refreshConfiguration,policy,recoveryKey:basis.key}),storedKey,uid);setStoredKey(JSON.stringify(submission));
    const input:IntakeRetryInput={attachmentIds:attachments.ids,idempotencyKey:submission.key,resourceMode:'account',...(note.trim()?{note:note.trim()}:{}),...(model?{model}:{}),...(refreshConfiguration?{refreshConfiguration:true}:{}),...(basis.key?{recoveryKey:basis.key}:{}),...accountStepAuthorization(basis.account,!!accountApproval),...(Object.keys(policy).length?{policy}:{})};
    try{await onRetry(input);clearNote(note,()=>attachments.clear(snapshot));clearStoredKey(JSON.stringify(submission));if(mounted.current)onClose();}catch(value){setError(value);}finally{working.current=false;setBusy(false);}
  }
  const cancelContinuation=async()=>{if(!busy||cancelling||cancelAcknowledged)return;setCancelling(true);try{await api(`/api/intakes/${encodeURIComponent(intake.id)}/cancel`,{method:'POST',body:{note:p('cancelContinuationNote')}});setCancelAcknowledged(true);await onChanged?.();}catch(error){setError(error);}finally{setCancelling(false);}};
  const footer=<><Button disabled={busy&&!cancelAcknowledged} onClick={onClose}>{t('close')}</Button>{busy&&!cancelAcknowledged&&<Button tone="danger" disabled={cancelling} onClick={()=>void cancelContinuation()}>{p(cancelling?'cancellingContinuation':'cancelContinuation')}</Button>}{cancelAcknowledged&&<span role="status">{p('continuationCancelRequested')}</span>}{basis.account?.status!=='exhausted'&&<Button form={formId} type="submit" tone="primary" aria-describedby={attachments.blocked?formId+'-files':undefined} disabled={attachments.blocked||busy||refreshing||blocked||needsAdjustment||stale||accountBlocked||(needsAnswer&&!note.trim())}><Icon name="play"/>{busy?t('recoveryContinuing'):accountApproval?p('accountApproveStep'):t('recoveryContinue')}</Button>}</>;
  return <Modal wide title={p('continueGoal')} onClose={()=>{if(!busy||cancelAcknowledged)onClose();}} footer={footer}><form id={formId} className="form-stack goal-retry-form" aria-busy={busy||undefined} noValidate onSubmit={event=>void submit(event)}><p>{t('recoveryContinueHelp')}</p><ErrorNotice error={error}/>
    {blocked&&<Notice tone="warning">{intake.retryBlockedReason??t('recoveryUnavailable')}</Notice>}
    <AccountAllowance context={{projectId:intake.projectId,intakeId:intake.id,model:model||undefined}} assessment={basis.account} onAssessment={account=>setBasis(previous=>({...previous,account:account??undefined}))} onRefresh={refreshAccount}/>
    {accountApproval&&!accountBlocked&&<p className="pf-account-approval">{p('accountOneStepHelp')}</p>}
    {stale&&<Notice tone="warning"><p>{p('recoveryContextChanged')}</p><Button onClick={()=>{setBasis(continuationBasis(intake as Intake));setScope(goalInstructionScope(intake));setError(null);}}>{p('reloadContinuation')}</Button></Notice>}
    <AttachmentArea draft={attachments} disabled={busy} onText={setNote}>{needsAnswer&&<Field label={t('intakeQuestion')} hint={intake.question}><textarea autoFocus required maxLength={2000} rows={3} value={note} onChange={event=>setNote(event.target.value)} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')event.currentTarget.form?.requestSubmit();}} disabled={busy}/></Field>}
    {!needsAnswer&&<Field label={p('resolutionNote')}><textarea rows={2} maxLength={2000} value={note} onChange={event=>setNote(event.target.value)} aria-keyshortcuts="Enter Meta+Enter Control+Enter" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit')event.currentTarget.form?.requestSubmit();}} disabled={busy} placeholder={p('resolutionNotePlaceholder')}/></Field>}
    <AttachmentControls draft={attachments} disabled={busy} id={formId+'-files'}/></AttachmentArea><details><summary>{p('advancedSettings')}</summary><div className="form-stack"><Field label={`${t('recoveryModel')} · ${t('optional')}`}><select value={model} onChange={event=>{setModel(event.target.value);setBasis(previous=>({...previous,account:undefined,accountAcknowledgementRequired:false}));setError(null);}} disabled={busy}><option value="">{t('recoveryKeepModel')}</option>{models.map(value=><option key={value.id} value={value.id}>{value.name||value.id}</option>)}</select></Field><label className="check"><input type="checkbox" checked={refreshConfiguration} disabled={busy} onChange={event=>setRefreshConfiguration(event.target.checked)}/><span>{t('recoveryRefreshConfiguration')}</span></label>
      <details><summary>{t('recoveryCapacityPolicy')}</summary><label className="check"><input type="checkbox" checked={overrideRecovery} disabled={busy} onChange={event=>setOverrideRecovery(event.target.checked)}/><span>{t('recoveryChangePolicy')}</span></label>{overrideRecovery&&<RecoveryPolicyFields value={recovery} onChange={setRecovery} models={models} disabled={busy}/>}</details>
      <HistoricalExecutionPolicy policy={intake.policy}/>
    </div></details>
  </form></Modal>;
}

const historyStatus: Record<GoalRecoveryRecord['status'], MessageKey> = {scheduled: 'recoveryScheduled', started: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled'};
export function RecoveryHistory({records, models, runs, onRun}: {records: GoalRecoveryRecord[]; models: ModelInfo[]; runs: Run[]; onRun: (id: string) => void}) {
  const {t, date,p} = useCopy();
  if (!records.length) return null;
  return <details className="goal-recovery-history"><summary>{t('recoveryHistory')} · {records.length}</summary>{[...records].reverse().map(record => <details key={record.id} className="goal-recovery-record"><summary>{t(record.trigger === 'automatic' ? 'recoveryAutomatic' : 'recoveryManual')} · {t(historyStatus[record.status])} · {date(record.at)}</summary><div className="recovery-record-body"><p className="pre-wrap small">{record.reason}</p>{record.note && record.note !== record.reason && <p className="pre-wrap small">{record.note}</p>}<dl className="metadata-list"><div><dt>{t('recoveryModel')}</dt><dd>{record.model?(models.find(model => model.id === record.model)?.name ?? record.model):p('inheritedProjectModel')}</dd></div>{record.actualModel && <div><dt>{t('recoveryActualModel')}</dt><dd><code>{record.actualModel}</code></dd></div>}<div><dt>{t('recoveryBasis')}</dt><dd>{record.previousBasisRevision} → {record.basisRevision}{record.refreshConfiguration && ` · ${t('recoveryConfigurationRefreshed')}`}</dd></div></dl><SubmittedAttachments items={record.attachments}/>{record.error && <Notice tone="error">{record.error}</Notice>}<div className="actions intake-run-links"><Button onClick={() => onRun(record.previousRunId)}>{t('recoveryPreviousRun')}{runs.find(run => run.id === record.previousRunId) && <Status value={runs.find(run => run.id === record.previousRunId)!.status}/>}</Button>{record.newRunId && <Button onClick={() => onRun(record.newRunId!)}>{t('recoveryNewRun')}{runs.find(run => run.id === record.newRunId) && <Status value={runs.find(run => run.id === record.newRunId)!.status}/>}</Button>}</div>{(record.previousPolicy || record.newPolicy) && <details><summary>{t('recoveryPolicyChanges')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousPolicy, next: record.newPolicy}, null, 2)}</pre></details>}{(record.previousRef || record.newRef) && <details><summary>{t('executionReference')}</summary><pre className="json-output">{JSON.stringify({previous: record.previousRef, next: record.newRef}, null, 2)}</pre></details>}</div></details>)}</details>;
}
