import {useEffect, useId, useRef, useState} from 'react';
import type {Project, ProjectBindings} from '../src/contracts';
import {EFFORT_LABELS} from '../src/contracts';
import {APIError, api} from './api';
import {Button, ErrorNotice, Field, Modal, Notice, SectionTitle} from './components';
import {useI18n} from './i18n';
import {useCopy} from './platform/copy';

export function projectBindings(project: Project): ProjectBindings {
  const {name, description, workspace, repository} = project;
  return {name, description, workspace, repository};
}

export function ConfigurationView({project, onChanged, onDirtyChange, onTeam, onKnowledge}: {
  project: Project;
  onChanged: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onTeam?: (roleId?: string) => void;
  onKnowledge?: () => void;
}) {
  const {t, date} = useI18n(), {p} = useCopy();
  const formId = useId();
  const [draft, setDraft] = useState(() => projectBindings(project));
  const [basis, setBasis] = useState(project);
  const [clean, setClean] = useState(() => JSON.stringify(projectBindings(project)));
  const [error, setError] = useState<unknown>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [confirmReload, setConfirmReload] = useState(false);
  const dirty = JSON.stringify(draft) !== clean;
  const dirtyListener = useRef(onDirtyChange); dirtyListener.current = onDirtyChange;
  useEffect(() => {onDirtyChange?.(dirty);}, [dirty, onDirtyChange]);
  useEffect(() => () => dirtyListener.current?.(false), []);
  useEffect(() => {
    if (!dirty) {
      setBasis(project); setDraft(projectBindings(project));
      setClean(JSON.stringify(projectBindings(project)));
    }
  }, [project.revision]);

  const reload = () => {
    setBasis(project); setDraft(projectBindings(project)); setClean(JSON.stringify(projectBindings(project)));
    setError(null); setMessage(''); setConfirmReload(false);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !dirty) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const saved = await api<Project>(`/api/projects/${encodeURIComponent(project.id)}/bindings`, {
        method: 'PATCH', body: {expectedRevision: basis.revision, bindings: draft},
      });
      setBasis(saved); setDraft(projectBindings(saved)); setClean(JSON.stringify(projectBindings(saved)));
      setMessage(t('configurationSaved', {revision: saved.revision}));
      await onChanged();
    } catch (error) {setError(error);} finally {setBusy(false);}
  };
  return <div className="surface configuration-surface">
    <div className="page-heading pf-view-header">
        <div><h1>{p('settings')}</h1><p className="muted">{t('projectSettingsDescription')}</p></div>
        <div className="pf-settings-actions"><div className="actions">
          <Button disabled={busy} onClick={() => dirty ? setConfirmReload(true) : reload()}>{t('reloadLatest')}</Button>
          <Button tone="primary" type="submit" form={formId} disabled={busy || !dirty}>{t(busy ? 'saving' : 'save')}</Button>
        </div><p className="configuration-meta muted small">{t('projectRevision', {revision: basis.revision})} · {t('updatedAt', {date: date(basis.updatedAt)})}</p></div>
      </div>
      <ErrorNotice error={error}/>{message && <Notice tone="success">{message}</Notice>}
      {dirty && basis.revision !== project.revision && !(error instanceof APIError && error.code === 'REVISION_CONFLICT') && <Notice tone="warning">{t('revisionChanged')}</Notice>}
      <div className="pf-settings-columns"><form id={formId} inert={busy} aria-busy={busy || undefined} onSubmit={event=>void save(event)}><section className="panel config-bindings">
        <SectionTitle title={t('projectBindings')}/>
        <div className="form-grid">
          <Field label={t('projectName')}><input required value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></Field>
          <Field label={t('repository')}><input value={draft.repository} onChange={event => setDraft({...draft, repository: event.target.value})} spellCheck={false}/></Field>
          <Field label={t('workspace')} className="span-two"><input required value={draft.workspace} onChange={event => setDraft({...draft, workspace: event.target.value})} spellCheck={false}/></Field>
          <Field label={t('description')} className="span-two"><textarea rows={3} value={draft.description} onChange={event => setDraft({...draft, description: event.target.value})}/></Field>
        </div>
      </section>
    </form>
    <aside className="pf-settings-aside"><section className="pf-defaults-overview">
      <SectionTitle title={p('defaultOverview')}>{onTeam && <Button onClick={() => onTeam()}>{t('manageTeam')}</Button>}</SectionTitle>
      <div className="pf-defaults-list">{project.roles.filter(role => !role.retired).map(role => <div className="pf-defaults-row" key={role.id}>
        <strong>{onTeam ? <button className="pf-text-button" onClick={() => onTeam(role.id)}>{role.name}</button> : role.name}</strong>
        <span>{role.model ?? p('defaultModel')} · {EFFORT_LABELS[role.effort]}</span>
        <span>{p(role.sandbox === 'read-only' ? 'readSourceBoundary' : 'writeWorkspaceBoundary')}</span>
      </div>)}</div>
    </section>
    {onKnowledge && <div className="row-between settings-knowledge-link"><span className="muted">{t('sourceManagementLocation')}</span><Button onClick={onKnowledge}>{t('manageKnowledge')}</Button></div>}
    </aside></div>
    {confirmReload && <Modal title={p('unsavedChanges')} busy={busy} onClose={() => setConfirmReload(false)}>
      <div className="form-stack"><p>{p('settingsReloadHelp')}</p><div className="form-actions">
        <Button disabled={busy} onClick={() => setConfirmReload(false)}>{p('keepEditing')}</Button>
        <Button tone="danger" disabled={busy} onClick={reload}>{p('discardChanges')}</Button>
      </div></div>
    </Modal>}
  </div>;
}
