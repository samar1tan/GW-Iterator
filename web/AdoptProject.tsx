import {useCallback, useEffect, useRef, useState} from 'react';
import type {Adoption, AdoptionOmissionReason} from '../src/adoption';
import type {Project} from '../src/contracts';
import {api, uid} from './api';
import {Button, ErrorNotice, ExecutorLabel, Field, Modal, Notice, SectionTitle} from './components';
import {useI18n} from './i18n';
import type {MessageKey} from './locales/en';

const statusKeys: Record<Adoption['status'], MessageKey> = {scanning: 'adoptionScanning', proposed: 'adoptionProposed', applied: 'adoptionApplied', failed: 'adoptionFailed'};
const omissionKeys: Record<AdoptionOmissionReason, MessageKey> = {
  'symbolic-link': 'adoptionOmitSymlink', 'private-path': 'adoptionOmitPrivate', 'nested-repository': 'adoptionOmitRepository',
  'depth-limit': 'adoptionOmitDepth', 'count-limit': 'adoptionOmitCount', 'context-limit': 'adoptionOmitContext',
  'size-limit': 'adoptionOmitSize', encoding: 'adoptionOmitEncoding', 'credential-content': 'adoptionOmitCredential',
  'invalid-package': 'adoptionOmitPackage', 'read-error': 'adoptionOmitRead', 'source-boundary': 'adoptionOmitBoundary',
};

export function AdoptProject({selectedId, onSelect, onClose, onApplied}: {
  selectedId: string; onSelect: (id: string) => void; onClose: () => void; onApplied: (projectId: string) => void;
}) {
  const {t, date} = useI18n();
  const [draft, setDraft] = useState({workspace: '', name: '', repository: ''});
  const [history, setHistory] = useState<Adoption[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const key = useRef(uid());
  const merge = useCallback((item: Adoption) => setHistory(previous => [item, ...previous.filter(value => value.id !== item.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))), []);
  const selected = history.find(item => item.id === selectedId);
  useEffect(() => {
    const controller = new AbortController();
    api<{adoptions: Adoption[]}>('/api/adoptions', {signal: controller.signal}).then(result => {setHistory(result.adoptions); setError(null);}).catch(error => {if (!controller.signal.aborted) setError(error);}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, []);
  const refresh = useCallback(async () => {
    if (selectedId === 'new') return;
    merge(await api<Adoption>(`/api/adoptions/${encodeURIComponent(selectedId)}`));
  }, [selectedId, merge]);
  useEffect(() => {
    if (selectedId === 'new') return;
    let active = true, fetching = false;
    const load = async () => {if (fetching) return; fetching = true; try {const item = await api<Adoption>(`/api/adoptions/${encodeURIComponent(selectedId)}`); if (active) merge(item);} catch (error) {if (active) setError(error);} finally {fetching = false;}};
    void load(); const timer = window.setInterval(() => {if (document.visibilityState === 'visible') void load();}, 2500);
    return () => {active = false; window.clearInterval(timer);};
  }, [selectedId, merge]);

  async function scan(event: React.FormEvent) {
    event.preventDefault(); if (busy || !draft.workspace.trim()) return;
    setBusy(true); setError(null);
    try {
      const adoption = await api<Adoption>('/api/adoptions', {method: 'POST', body: {workspace: draft.workspace.trim(), ...(draft.name.trim() ? {name: draft.name.trim()} : {}), ...(draft.repository.trim() ? {repository: draft.repository.trim()} : {}), idempotencyKey: key.current}});
      merge(adoption); onSelect(adoption.id); key.current = uid();
    } catch (error) {setError(error);} finally {setBusy(false);}
  }
  async function apply() {
    if (!selected || applying) return;
    setApplying(true); setError(null);
    try {const project = await api<Project>(`/api/adoptions/${encodeURIComponent(selected.id)}/apply`, {method: 'POST', body: {expectedRevision: selected.revision}}); onApplied(project.id);}
    catch (error) {setError(error); await refresh().catch(() => {});} finally {setApplying(false);}
  }

  return <Modal wide title={t('adoptionTitle')} onClose={onClose}>
    <div className="adoption-setup">
      <p className="muted small">{t('adoptionIntro')}</p>
      <form className="form-stack" onSubmit={event => void scan(event)}>
        <Field label={t('workspace')}><input autoFocus required value={draft.workspace} onChange={event => setDraft({...draft, workspace: event.target.value})} spellCheck={false}/></Field>
        <div className="form-grid"><Field label={`${t('projectName')} · ${t('optional')}`}><input value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></Field><Field label={`${t('repository')} · ${t('optional')}`} hint={t('adoptionRepositoryHint')}><input value={draft.repository} onChange={event => setDraft({...draft, repository: event.target.value})} spellCheck={false}/></Field></div>
        <p className="hint adoption-permissions">{t('adoptionReadBoundary')}</p>
        <div className="actions"><Button type="submit" tone="primary" disabled={busy || !draft.workspace.trim()}>{busy ? t('adoptionSubmitting') : t('adoptionScan')}</Button></div>
      </form>
      <ErrorNotice error={error}/>
      <section className="adoption-review">
        <div className="row-between"><Field label={t('adoptionHistory')}><select value={selectedId} onChange={event => onSelect(event.target.value)}><option value="new">{t('adoptionNewScan')}</option>{history.map(item => <option key={item.id} value={item.id}>{item.proposal?.name ?? item.name ?? item.workspace.split(/[\\/]/).at(-1)} · {t(statusKeys[item.status])} · {date(item.createdAt)}</option>)}</select></Field>{selectedId !== 'new' && <Button onClick={() => void refresh().catch(setError)}>{t('refresh')}</Button>}</div>
        {loading && <p className="muted small" role="status">{t('loading')}</p>}
        {selected && <>
          <div className="adoption-record-heading"><span className={`tag adoption-status adoption-${selected.status}`}>{t(statusKeys[selected.status])}</span><span className="small muted">{t('revision', {revision: selected.revision})}</span><code className="small muted">{selected.workspace}</code></div>
          {selected.error && <Notice tone="error">{selected.error}</Notice>}{selected.projectId && selected.status !== 'applied' && <Notice tone="warning">{t('adoptionPartial')}</Notice>}
          {selected.output && <p className="pre-wrap small">{selected.output.summary}</p>}
          {selected.proposal && selected.status !== 'scanning' && <div className="adoption-proposal">
            <SectionTitle title={selected.proposal.name}/><p className="pre-wrap small">{selected.proposal.description}</p><p className="pre-wrap small muted">{selected.proposal.rationale}</p>
            {selected.proposal.repository && <div className="small"><span className="muted">{t('repository')}: </span><code>{selected.proposal.repository}</code></div>}
            <details><summary>{t('adoptionRoleGuidance')} · {selected.proposal.roles.length}</summary><div className="adoption-role-guidance">{selected.proposal.roles.map(role => <details key={role.id}><summary><code>{role.id}</code></summary><p className="pre-wrap small">{role.instructions}</p></details>)}</div></details>
            <details><summary>{t('configuredSources')} · {selected.proposal.knowledgeSources.length}</summary><ul className="adoption-source-proposals">{selected.proposal.knowledgeSources.map((source, index) => <li key={`${source.path}-${index}`}><code>{source.path}</code><span className="small muted">{t(source.kind)} · {source.roles.join(', ') || t('allRoles')}</span></li>)}</ul></details>
            <section className="adoption-workflows"><h3>{t('adoptionStarterWorkflows')}</h3>{selected.proposal.pipelines.map((pipeline, index) => <details key={index}><summary>{pipeline.name} · {t('stageCount', {count: pipeline.stages.length})}</summary><p className="small muted pre-wrap">{pipeline.description}</p><ol className="adoption-stage-list">{pipeline.stages.map(stage => <li key={stage.id}><strong>{stage.name}</strong><span className="small muted"><code>{stage.roleId}</code> · <ExecutorLabel value={stage.executor}/>{stage.review && ` · ${t('requiresReview')}`}</span>{stage.dependsOn.length > 0 && <span className="small muted">{t('dependencies')}: {stage.dependsOn.map(id => pipeline.stages.find(value => value.id === id)?.name ?? id).join(', ')}</span>}<details><summary>{t('prompt')}</summary><p className="pre-wrap small">{stage.prompt}</p></details></li>)}</ol><div className="small muted">{t('bounds')}: {t('maxAttempts')} {pipeline.policy.maxAttempts} · {t('seconds', {count: pipeline.policy.timeoutSeconds})} · {t('tokenBudget')} {pipeline.policy.tokenBudget}</div></details>)}</section>
          </div>}
          {selected.observations.length > 0 && <section className="adoption-observations"><h3>{t('observations')}</h3><ul>{selected.observations.map((item, index) => <li key={index} className="small pre-wrap">{item}</li>)}</ul></section>}
          <details className="adoption-evidence"><summary>{t('adoptionSources')} · {selected.sources.length}</summary>{selected.sources.map(source => <details key={source.path} className="adoption-source"><summary><code>{source.path}</code>{selected.citedSources.includes(source.path) && <span className="tag">{t('adoptionCited')}</span>}</summary><div className="small muted">{t(source.transformation === 'package-metadata' ? 'adoptionPackageProjection' : 'adoptionTextExcerpt')}{source.truncated && ` · ${t('adoptionTruncated')}`} · {date(source.retrievedAt)}</div><code className="adoption-hash">{source.hash}</code><pre className="json-output">{source.content}</pre></details>)}</details>
          {selected.omissions.length > 0 && <details><summary>{t('adoptionOmissions')} · {selected.omissions.length}</summary><ul className="adoption-omissions">{selected.omissions.map((source, index) => <li key={index}><code>{source.path}</code><span className="small muted">{t(omissionKeys[source.reason])}</span></li>)}</ul></details>}
          {selected.ref && <details><summary>{t('executionReference')}</summary><dl className="metadata-list">{selected.ref.threadId && <div><dt>{t('thread')}</dt><dd><code>{selected.ref.threadId}</code></dd></div>}{selected.ref.turnId && <div><dt>{t('turn')}</dt><dd><code>{selected.ref.turnId}</code></dd></div>}</dl></details>}
          {selected.events.length > 0 && <details><summary>{t('eventTrail')} · {selected.events.length}</summary><ol className="adoption-events">{selected.events.slice(-12).reverse().map((event, index) => <li key={index}><div className="small muted">{date(event.at)} · <code>{event.type}</code></div><p className="small pre-wrap">{event.message}</p></li>)}</ol></details>}
          <div className="adoption-apply">
            {selected.status === 'proposed' && <><p className="hint">{t('adoptionApplyHelp')}</p><Button tone="primary" disabled={applying} onClick={() => void apply()}>{applying ? t('saving') : t('adoptionApply')}</Button></>}
            {selected.projectId && <Button onClick={() => onApplied(selected.projectId!)}>{t('openProject')}</Button>}
          </div>
        </>}
      </section>
    </div>
  </Modal>;
}
