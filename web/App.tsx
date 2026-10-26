import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IntegrationInfo, Project, ProjectDetail, ProjectOverview } from '../src/contracts';
import { api } from './api';
import { Button, Empty, ErrorNotice, Field, Integrations, Modal } from './components';
import { I18nContext, makeI18n, useI18n } from './i18n';
import type { Locale } from './i18n';
import { PipelinesView } from './PipelinesView';
import { KnowledgeView } from './KnowledgeView';
import { ConfigurationView } from './ConfigurationView';
import { AdoptProject } from './AdoptProject';

export type Surface = 'pipelines' | 'knowledge' | 'configuration';
export type Route = { projectId?: string; surface: Surface; role: string; pipelineId?: string; runId?: string; stageId?: string; entryId?: string; intakeId?: string; adoptionId?: string };
export type Navigate = (route: Route) => void;
type Overview = { projects: ProjectOverview[]; integrations: IntegrationInfo };
const parseRoute = (): Route => {
  const [path = '', search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/'); const params = new URLSearchParams(search);
  let projectId: string | undefined;
  try { projectId = parts[0] === 'projects' && parts[1] ? decodeURIComponent(parts[1]) : undefined; } catch { projectId = undefined; }
  const surface = parts[2] === 'knowledge' || parts[2] === 'configuration' ? parts[2] : 'pipelines';
  return { projectId, surface, role: params.get('role') ?? '', pipelineId: params.get('pipeline') ?? undefined, runId: params.get('run') ?? undefined, stageId: params.get('stage') ?? undefined, entryId: params.get('entry') ?? undefined, intakeId: params.get('intake') ?? undefined, adoptionId: params.get('adoption') ?? undefined };
};
function routeHash(route: Route): string {
  if (!route.projectId) return route.adoptionId ? `#/projects?adoption=${encodeURIComponent(route.adoptionId)}` : '#/projects';
  const params = new URLSearchParams();
  if (route.role) params.set('role', route.role);
  if (route.pipelineId) params.set('pipeline', route.pipelineId);
  if (route.runId) params.set('run', route.runId);
  if (route.stageId) params.set('stage', route.stageId);
  if (route.entryId) params.set('entry', route.entryId);
  if (route.intakeId) params.set('intake', route.intakeId);
  const query = params.toString();
  return `#/projects/${encodeURIComponent(route.projectId)}/${route.surface}${query ? `?${query}` : ''}`;
}
function initialLocale(): Locale { try { return localStorage.getItem('gwi.locale') === 'zh-CN' ? 'zh-CN' : localStorage.getItem('gwi.locale') === 'en' ? 'en' : navigator.language.startsWith('zh') ? 'zh-CN' : 'en'; } catch { return 'en'; } }

export function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [route, setRoute] = useState<Route>(parseRoute);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [startupError, setStartupError] = useState<unknown>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<unknown>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const i18n = useMemo(() => makeI18n(locale), [locale]);
  const { t } = i18n;
  useEffect(() => { document.documentElement.lang = locale; try { localStorage.setItem('gwi.locale', locale); } catch { /* Storage is optional. */ } }, [locale]);
  useEffect(() => { const handler = () => setRoute(parseRoute()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  const navigate = useCallback<Navigate>(next => { location.hash = routeHash(next); setRoute(next); }, []);
  useEffect(() => { let active = true; setStartupError(null); api('/api/session').then(() => { if (active) setSessionReady(true); }).catch(error => { if (active) setStartupError(error); }); return () => { active = false; }; }, [sessionAttempt]);
  const refreshOverview = useCallback(async () => { const next = await api<Overview>('/api/overview'); setOverview(next); setOverviewError(null); }, []);
  const refreshProject = useCallback(async () => { if (!route.projectId) return; const next = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(route.projectId)}`); setDetail(next); setDetailError(null); }, [route.projectId]);
  useEffect(() => {
    if (!sessionReady) return;
    let active = true; let busy = false;
    const load = async () => { if (busy) return; busy = true; try { const next = await api<Overview>('/api/overview'); if (active) { setOverview(next); setOverviewError(null); } } catch (error) { if (active) setOverviewError(error); } finally { busy = false; } };
    void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionReady]);
  useEffect(() => {
    if (!sessionReady || !route.projectId) return;
    let active = true; let busy = false; const id = route.projectId; setDetailError(null);
    const load = async () => { if (busy) return; busy = true; try { const next = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`); if (active) { setDetail(next); setDetailError(null); } } catch (error) { if (active) setDetailError(error); } finally { busy = false; } };
    void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionReady, route.projectId]);
  const current = detail?.project.id === route.projectId ? detail : null;
  const changed = useCallback(async () => { await refreshProject(); void refreshOverview().catch(setOverviewError); }, [refreshProject, refreshOverview]);
  return <I18nContext.Provider value={i18n}><div className="app-shell"><header className="topbar"><div className="topbar-start"><button className="brand" onClick={() => navigate({ surface: 'pipelines', role: '' })} aria-label={t('projects')}><span className="brand-mark">GWI</span><span>{t('appName')}</span></button>{route.projectId && <><span className="topbar-separator">/</span><Button tone="quiet" onClick={() => navigate({ surface: 'pipelines', role: '' })}>← {t('projects')}</Button><span className="topbar-project">{current?.project.name}</span></>}</div><Button tone="quiet" className="language-toggle" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')} aria-label={t('switchLanguage')}>{locale === 'en' ? '简体中文' : 'English'}</Button></header>
    {!sessionReady ? <main className="startup"><ErrorNotice error={startupError} />{startupError ? <Button tone="primary" onClick={() => setSessionAttempt(value => value + 1)}>{t('retryStartup')}</Button> : <p role="status">{t('loading')}</p>}</main> : !route.projectId ? <ProjectList adoptionId={route.adoptionId} onAdoption={id => navigate({ surface: 'pipelines', role: '', adoptionId: id })} overview={overview} error={overviewError} onRefresh={refreshOverview} onOpen={id => navigate({ projectId: id, surface: 'pipelines', role: '' })} /> : <div className="project-layout"><aside className="project-sidebar"><div className="project-identity"><span className="eyebrow">{t('projects')}</span><h1>{current?.project.name ?? t('loading')}</h1>{current && <span className="muted small">{t('projectRevision', { revision: current.project.revision })}</span>}</div><nav aria-label={t('navigation')}>{(['pipelines', 'knowledge', 'configuration'] as const).map(surface => <button key={surface} className={`nav-item ${route.surface === surface ? 'selected' : ''}`} aria-current={route.surface === surface ? 'page' : undefined} onClick={() => navigate({ ...route, surface })}><span className="nav-icon" aria-hidden="true">{surface === 'pipelines' ? '⑂' : surface === 'knowledge' ? '▤' : '⚙'}</span>{t(surface)}</button>)}</nav>{current && <Field label={t('roleScope')} className="role-filter"><select value={route.role} onChange={event => navigate({ ...route, role: event.target.value, pipelineId: undefined, runId: undefined, stageId: undefined, entryId: undefined })}><option value="">{t('allRoles')}</option>{current.project.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>}<div className="sidebar-bottom"><span className="connection-dot ok" />{t('session')}</div></aside><main className="workspace" id="main-content"><ErrorNotice error={detailError} />{!current ? <div className="startup">{detailError ? <Button onClick={() => void refreshProject().catch(setDetailError)}>{t('retry')}</Button> : <p role="status">{t('loading')}</p>}</div> : route.surface === 'pipelines' ? <PipelinesView detail={current} integrations={overview?.integrations} route={route} navigate={navigate} onChanged={changed} /> : route.surface === 'knowledge' ? <KnowledgeView key={current.project.id} detail={current} route={route} navigate={navigate} onChanged={changed} /> : <ConfigurationView key={current.project.id} project={current.project} integrations={overview?.integrations} scopedRole={route.role} onChanged={changed} />}</main></div>}
  </div></I18nContext.Provider>;
}

function ProjectList({ overview, error, onRefresh, onOpen, adoptionId, onAdoption }: { overview: Overview | null; error: unknown; onRefresh: () => Promise<void>; onOpen: (id: string) => void; adoptionId?: string; onAdoption: (id?: string) => void }) {
  const { t, number } = useI18n(); const [createOpen, setCreateOpen] = useState(false); const [refreshError, setRefreshError] = useState<unknown>(null);
  return <main className="project-list-page"><div className="page-heading"><div><span className="eyebrow">{t('appName')}</span><h1>{t('projectListTitle')}</h1><p className="muted">{t('projectListDescription')}</p></div><div className="actions"><Button onClick={() => void onRefresh().catch(setRefreshError)}>{t('refresh')}</Button><Button onClick={() => setCreateOpen(true)}>{t('createProject')}</Button><Button tone="primary" onClick={() => onAdoption('new')}>{t('adoptionTitle')}</Button></div></div><ErrorNotice error={error ?? refreshError} />{!overview ? <p role="status">{t('loading')}</p> : <><Integrations value={overview.integrations} /><div className="project-cards">{overview.projects.map(project => <button className="project-card" key={project.id} onClick={() => onOpen(project.id)}><div className="project-card-heading"><span className="project-avatar">{project.name.slice(0, 2)}</span><div><h2>{project.name}</h2><span className="muted small">{t('revision', { revision: project.revision })}</span></div><span className="card-arrow">↗</span></div><p>{project.description || t('emptyDescription')}</p><div className="project-metrics"><div><strong>{number(project.activeRuns)}</strong><span>{t('active')}</span></div><div><strong>{number(project.waitingRuns)}</strong><span>{t('waiting')}</span></div><div><strong>{number(project.pipelineCount)}</strong><span>{t('pipelines')}</span></div><div><strong>{number(project.knowledgeCount)}</strong><span>{t('entries')}</span></div></div><div className="project-card-foot"><code>{project.repository}</code><span>{t('openProject')} →</span></div></button>)}</div>{!overview.projects.length && <Empty>{t('noProjects')}</Empty>}</>}{adoptionId && <AdoptProject selectedId={adoptionId} onSelect={onAdoption} onClose={() => onAdoption()} onApplied={id => { void onRefresh().catch(setRefreshError); onOpen(id); }} />}{createOpen && <CreateProject onClose={() => setCreateOpen(false)} onCreated={project => { setCreateOpen(false); void onRefresh().catch(setRefreshError); onOpen(project.id); }} />}</main>;
}
function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const { t } = useI18n(); const [draft, setDraft] = useState({ name: '', description: '', workspace: '', repository: '' }); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { onCreated(await api<Project>('/api/projects', { method: 'POST', body: draft })); } catch (error) { setError(error); } finally { setBusy(false); } };
  return <Modal title={t('createProjectTitle')} onClose={onClose}><form onSubmit={event => void submit(event)} className="form-stack"><ErrorNotice error={error} /><Field label={t('projectName')}><input autoFocus required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field label={t('description')}><textarea rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field><Field label={t('workspace')}><input required value={draft.workspace} onChange={event => setDraft({ ...draft, workspace: event.target.value })} spellCheck={false} /></Field><Field label={t('repository')} hint={t('repositoryHint')}><input value={draft.repository} onChange={event => setDraft({ ...draft, repository: event.target.value })} spellCheck={false} /></Field><div className="form-actions"><Button onClick={onClose}>{t('cancel')}</Button><Button type="submit" tone="primary" disabled={busy}>{busy ? t('saving') : t('createProject')}</Button></div></form></Modal>;
}
