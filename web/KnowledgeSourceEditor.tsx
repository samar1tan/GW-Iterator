import {useState} from 'react';
import type {KnowledgeSource, Project} from '../src/contracts';
import {api, uid} from './api';
import {Button, ErrorNotice, Field, Modal, Notice, RoleChecks} from './components';
import {useI18n} from './i18n';
import {useCopy} from './platform/copy';
import {knowledgePath} from './platform/knowledgePath';
import {submitKnowledgeChange} from './platform/knowledgeChanges';

type SourceProps = {project: Project; onClose: () => void; onChanged: () => Promise<void>};
export function KnowledgeSourceEditor({project, source, scopedRole, onClose, onChanged}: SourceProps & {source?: KnowledgeSource; scopedRole: string}) {
  const {t} = useI18n(), {p} = useCopy();
  const [basis, setBasis] = useState(project), [id] = useState(() => source?.id ?? `source-${uid()}`);
  const [kind, setKind] = useState<KnowledgeSource['kind']>(source?.kind ?? 'document');
  const [path, setPath] = useState(source?.path ?? ''), [section, setSection] = useState(source?.section ?? '');
  const [roles, setRoles] = useState(source?.roles ?? (scopedRole ? [scopedRole] : project.roles.filter(role=>!role.retired).map(role=>role.id)));
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState<unknown>(null);
  const present = !source || basis.knowledgeSources.some(item => item.id === id);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !present) return;
    setBusy(true); setError(null);
    const next: KnowledgeSource = {id, kind, path: knowledgePath(basis.workspace, path), roles, ...(section.trim() ? {section: section.trim()} : {})};
    try {
      await submitKnowledgeChange(confirmed, () => api<Project>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PUT', body: {expectedRevision: basis.revision, project: {...basis, knowledgeSources: source ? basis.knowledgeSources.map(item => item.id === id ? next : item) : [...basis.knowledgeSources, next]}},
      }), saved => {setBasis(saved); setConfirmed(true);}, onChanged);
    } catch (error) {setError(error);} finally {setBusy(false);}
  };
  const savedKey = source ? 'sourceUpdated' : 'sourceRegistered';
  return <Modal title={t(source ? 'editSource' : 'sourceRegistration')} busy={busy} onClose={onClose}>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <ErrorNotice error={error}/>{confirmed && <Notice tone="success">{t(savedKey)}</Notice>}
      {!confirmed && basis.revision !== project.revision && <Notice tone="warning"><p>{t('staleSourceDraft')}</p><Button onClick={() => {setBasis(project); setError(null);}}>{t('useLatestBasis')}</Button></Notice>}
      {!present && !confirmed && <Notice tone="warning">{t('sourceNoLongerRegistered')}</Notice>}
      <fieldset className="form-stack" disabled={busy || confirmed || !present}>
        <Field label={t('sourceKind')}><select value={kind} onChange={event=>setKind(event.target.value as KnowledgeSource['kind'])}>{(['document','artifact','memory'] as const).map(value=><option key={value} value={value}>{t(value)}</option>)}</select></Field>
        <Field label={t('sourcePath')} hint={p('knowledgeSourceHelp')}><input autoFocus required spellCheck={false} value={path} onChange={event=>setPath(event.target.value)}/></Field>
        <Field label={`${t('sourceSection')} · ${t('optional')}`} hint={t('sourceSectionHelp')}><input value={section} onChange={event=>setSection(event.target.value)}/></Field>
        <fieldset><legend>{t('sourceRoles')}</legend><p className="hint">{t('sourceRolesHelp')}</p><RoleChecks roles={basis.roles} selected={roles} onChange={setRoles}/></fieldset>
      </fieldset>
      <div className="form-actions"><Button onClick={onClose}>{t(confirmed ? 'close' : 'cancel')}</Button><Button type="submit" tone="primary" disabled={busy || (!confirmed && (!path.trim() || !present))}>{t(busy ? 'saving' : confirmed ? 'refresh' : source ? 'save' : 'registerSource')}</Button></div>
    </form>
  </Modal>;
}

export function RemoveKnowledgeSource({project, source, onClose, onChanged}: SourceProps & {source: KnowledgeSource}) {
  const {t} = useI18n();
  const [basis] = useState(project);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState<unknown>(null);
  const remove = async () => {
    if (busy || (!confirmed && basis.revision !== project.revision)) return;
    setBusy(true); setError(null);
    try {
      await submitKnowledgeChange(confirmed, () => api<Project>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method:'PUT', body:{expectedRevision:basis.revision, project:{...basis,knowledgeSources:basis.knowledgeSources.filter(item=>item.id!==source.id)}},
      }), () => setConfirmed(true), onChanged);
    } catch (error) {setError(error);} finally {setBusy(false);}
  };
  return <Modal title={t('removeSourceRegistration')} busy={busy} onClose={onClose}>
    <div className="form-stack"><p>{t('removeSourceHelp')}</p><code className="source-path">{source.path}</code><ErrorNotice error={error}/>{!confirmed&&basis.revision!==project.revision&&<Notice tone="warning">{t('staleSourceRemoval')}</Notice>}{confirmed && <Notice tone="success">{t('sourceRemoved')}</Notice>}
      <div className="form-actions"><Button onClick={onClose}>{t(confirmed ? 'close' : 'cancel')}</Button><Button tone={confirmed ? 'primary' : 'danger'} disabled={busy||(!confirmed&&basis.revision!==project.revision)} onClick={() => void remove()}>{t(busy ? 'saving' : confirmed ? 'refresh' : 'removeSourceRegistration')}</Button></div>
    </div>
  </Modal>;
}
