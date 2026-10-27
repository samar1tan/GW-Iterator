import {useState} from 'react';
import type {Pipeline, Project, Run} from '../../src/contracts';
import {EFFORT_LABELS} from '../../src/contracts';
import {api, uid} from '../api';
import {Button, ErrorNotice, Field, Modal} from '../components';
import {Icon} from '../Icons';
import {useCopy} from './copy';

export function LaunchPipeline({pipeline, project, onClose, onStarted}: {pipeline: Pipeline; project: Project; onClose: () => void; onStarted: (run: Run) => Promise<void>}) {
  const {p,number} = useCopy();
  const [goal,setGoal] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState<unknown>(null), [key] = useState(uid);
  const roles = project.roles.filter(role => pipeline.stages.some(stage => stage.roleId === role.id));
  const modelRoles = roles.filter(role => pipeline.stages.some(stage => stage.executor === 'codex' && stage.roleId === role.id));
  const manualOnly = pipeline.stages.every(stage => stage.executor === 'manual');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!goal.trim() || busy) return;
    setBusy(true); setError(null);
    try {const run = await api<Run>('/api/runs', {method:'POST',body:{projectId:project.id,pipelineId:pipeline.id,goal:goal.trim(),idempotencyKey:key}}); await onStarted(run);} catch (value) {setError(value);} finally {setBusy(false);}
  };
  return <Modal title={p('launchPipeline',{name:pipeline.name})} onClose={onClose}><form className="form-stack" onSubmit={event => void submit(event)}><ErrorNotice error={error}/><Field label={p('launchOutcome')} hint={p('launchOutcomeHint')}><textarea autoFocus required rows={4} value={goal} onChange={event => setGoal(event.target.value)}/></Field><section className="pf-launch-summary"><h3>{p('inheritedSettings')}</h3><p className="hint">{p('defaultBudgetHelp')}</p><p>{p('workflowSummary',{stages:pipeline.stages.length,roles:roles.length})}</p><ol className="pf-launch-path">{pipeline.stages.map(stage=><li key={stage.id}>{stage.name}</li>)}</ol>{manualOnly&&<p>{p('manualOnlyFlow')}</p>}{modelRoles.length>0&&<><p className="hint">{p('modelDefaultsHelp')}</p><dl>{modelRoles.map(role => <div key={role.id}><dt>{role.name}</dt><dd>{p('modelSummary',{model:role.model ?? p('defaultModel'),effort:EFFORT_LABELS[role.effort]})}</dd></div>)}</dl></>}</section><details><summary>{p('advancedSettings')}</summary><dl className="metadata-list"><div><dt>{p('newTokens')}</dt><dd>{number(pipeline.policy.tokenBudget)}</dd></div><div><dt>{p('seconds')}</dt><dd>{number(pipeline.policy.timeoutSeconds)}</dd></div><div><dt>{p('attempts')}</dt><dd>{pipeline.policy.maxAttempts}</dd></div>{modelRoles.length>0&&<div><dt>{p('executionBoundary')}</dt><dd>{modelRoles.map(role => `${role.name}: ${p(role.sandbox === 'read-only' ? 'readSourceBoundary' : 'writeWorkspaceBoundary')}`).join('; ')}</dd></div>}</dl></details><div className="form-actions"><Button onClick={onClose} disabled={busy}>{p('cancel')}</Button><Button type="submit" tone="primary" disabled={busy || !goal.trim()}><Icon name="play"/>{p(busy ? 'starting' : 'startWork')}</Button></div></form></Modal>;
}
