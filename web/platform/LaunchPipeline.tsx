import {useState} from 'react';
import type {Pipeline, Project, Run} from '../../src/contracts';
import {EFFORT_LABELS} from '../../src/contracts';
import {api, uid} from '../api';
import {Button, ErrorNotice, Field, Modal} from '../components';
import {Icon} from '../Icons';
import {ProjectReadinessNotice,useProjectReadiness} from './ProjectReadiness';
import {workflowScope} from './workflowScope';
import {useCopy} from './copy';
import type {AllowanceAssessment} from '../../src/account-allowance-types';
import {AccountAllowance,canRequestAccountStep,accountStepNeedsApproval,accountStepAuthorization} from './AccountAllowance';

export function LaunchPipeline({pipeline, pipelines = [], project, onClose, onStarted}: {pipeline: Pipeline; pipelines?: Pipeline[]; project: Project; onClose: () => void; onStarted: (run: Run) => Promise<void>}) {
  const {p,number} = useCopy();
  const [goal,setGoal] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState<unknown>(null), [key] = useState(uid), [account,setAccount]=useState<AllowanceAssessment|null>(null);
  const roles = project.roles.filter(role => pipeline.stages.some(stage => stage.roleId === role.id));
  const {requiresAccount,manualOnly,modelRoles:scopeRoles}=workflowScope(pipeline,pipelines);
  const readiness=useProjectReadiness(project,requiresAccount);
  const sourceBlocked=requiresAccount&&readiness.readiness?.workspace.status!=='ready';
  const modelRoles = project.roles.filter(role => scopeRoles.has(role.id));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!goal.trim() || busy || sourceBlocked || (requiresAccount&&!canRequestAccountStep(account))) return;
    setBusy(true); setError(null);
    try {const run = await api<Run>('/api/runs', {method:'POST',body:{projectId:project.id,pipelineId:pipeline.id,goal:goal.trim(),idempotencyKey:key,resourceMode:'account',...(requiresAccount?accountStepAuthorization(account):{})}}); await onStarted(run);} catch (value) {setError(value);} finally {setBusy(false);}
  };
  return <Modal title={p('launchPipeline',{name:pipeline.name})} busy={busy} onClose={onClose}><form className="form-stack" onSubmit={event => void submit(event)}><ErrorNotice error={error}/>{requiresAccount&&<ProjectReadinessNotice {...readiness}/>}<Field label={p('launchOutcome')} hint={p('launchOutcomeHint')}><textarea autoFocus required rows={4} value={goal} onChange={event => setGoal(event.target.value)}/></Field>{requiresAccount&&<AccountAllowance context={{projectId:project.id,pipelineId:pipeline.id}} onAssessment={setAccount}/>}<section className="pf-launch-summary"><h3>{p('inheritedSettings')}</h3>{requiresAccount&&<p className="hint">{p('defaultBudgetHelp')}</p>}<p>{p('workflowSummary',{stages:pipeline.stages.length,roles:roles.length})}</p><ol className="pf-launch-path">{pipeline.stages.map(stage=><li key={stage.id}>{stage.name}</li>)}</ol>{manualOnly&&<p>{p('manualOnlyFlow')}</p>}{modelRoles.length>0&&<><p className="hint">{p('modelDefaultsHelp')}</p><dl>{modelRoles.map(role => <div key={role.id}><dt>{role.name}</dt><dd>{p('modelSummary',{model:role.model ?? p('defaultModel'),effort:EFFORT_LABELS[role.effort]})}</dd></div>)}</dl></>}</section><details><summary>{p('advancedSettings')}</summary><dl className="metadata-list"><div><dt>{p('seconds')}</dt><dd>{number(pipeline.policy.timeoutSeconds)}</dd></div><div><dt>{p('attempts')}</dt><dd>{pipeline.policy.maxAttempts}</dd></div>{modelRoles.length>0&&<div><dt>{p('executionBoundary')}</dt><dd>{modelRoles.map(role => `${role.name}: ${p(role.sandbox === 'read-only' ? 'readSourceBoundary' : 'writeWorkspaceBoundary')}`).join('; ')}</dd></div>}</dl><details><summary>{p('recordedTokenDiagnostics')}</summary><p className="hint">{p('tokenDiagnosticsHelp')}</p><dl className="metadata-list"><div><dt>{p('historicalTokenConfiguration')}</dt><dd>{number(pipeline.policy.tokenBudget)}</dd></div></dl></details></details><div className="form-actions"><Button onClick={onClose} disabled={busy}>{p('cancel')}</Button><Button type="submit" tone="primary" disabled={busy || !goal.trim() || sourceBlocked || (requiresAccount&&!canRequestAccountStep(account))}><Icon name="play"/>{p(busy ? 'starting' : requiresAccount&&accountStepNeedsApproval(account)?'accountApproveStep':'startWork')}</Button></div></form></Modal>;
}
