import {useCallback, useEffect, useRef, useState} from 'react';
import type {Project, ProjectReadiness} from '../../src/contracts';
import {api} from '../api';
import {Button, ErrorNotice, Notice} from '../components';
import {useI18n} from '../i18n';
import type {MessageKey} from '../locales/en';

const workspaceMessages: Record<ProjectReadiness['workspace']['code'], MessageKey> = {
  READY: 'sourceBaselineReady', WORKSPACE_UNAVAILABLE: 'sourceWorkspaceMissing', GIT_UNAVAILABLE: 'sourceGitUnavailable',
  GIT_REPOSITORY_REQUIRED: 'sourceRepositoryRequired', GIT_ROOT_MISMATCH: 'sourceRootMismatch',
  GIT_COMMIT_REQUIRED: 'sourceCommitRequired', GIT_INSPECTION_FAILED: 'sourceInspectionFailed',
};

export function useProjectReadiness(project: Pick<Project, 'id' | 'revision'>, enabled = true) {
  const [readiness, setReadiness] = useState<ProjectReadiness | null>(null);
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const value = await api<ProjectReadiness>(`/api/projects/${encodeURIComponent(project.id)}/readiness`);
      if (current === generation.current) setReadiness(value);
    } catch (error) {if (current === generation.current) {setReadiness(null); setError(error);}}
    finally {if (current === generation.current) setLoading(false);}
  }, [project.id, project.revision, enabled]);
  useEffect(() => {setReadiness(null); void refresh(); return () => {generation.current++;};}, [refresh]);
  return {readiness, error, loading, refresh};
}

export function ProjectReadinessNotice({readiness, error, loading, refresh, onSettings, onKnowledge}: {
  readiness: ProjectReadiness | null; error: unknown; loading: boolean; refresh: () => Promise<void>;
  onSettings?: () => void; onKnowledge?: () => void;
}) {
  const {t} = useI18n();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<unknown>(null), [refreshError, setRefreshError] = useState<unknown>(null);
  const synchronize=async()=>{
    if(!readiness||syncing)return;
    setSyncing(true);setSyncError(null);setRefreshError(null);
    try{await api(`/api/projects/${encodeURIComponent(readiness.projectId)}/knowledge/sync`,{method:'POST',body:{}});}
    catch(error){setSyncError(error);setSyncing(false);return;}
    try{await refresh();}catch(error){setRefreshError(error);}finally{setSyncing(false);}
  };
  const check=()=>{setSyncError(null);setRefreshError(null);void refresh().catch(setRefreshError);};
  const observationError=error??refreshError;
  if (!readiness && loading) return <p className="small muted" role="status">{t('checkingSourceBaseline')}</p>;
  const sourceGap = readiness && readiness.workspace.status !== 'ready';
  const knowledgeGap = readiness && ['not_indexed', 'issues'].includes(readiness.knowledge.status);
  const knowledgeIssues=readiness?.knowledge.status==='issues';
  const syncFailure = knowledgeGap ? syncError : null;
  const knowledgeMessage:MessageKey=knowledgeIssues?'knowledgeIndexIssues':readiness?.knowledge.lastSyncedAt?'knowledgeIndexNeedsRecheck':readiness?.knowledge.currentEntries?'knowledgeIndexUnverified':'knowledgeIndexNotSynced';
  if (!sourceGap && !knowledgeGap && !observationError && !syncFailure) return null;
  return <div className="project-readiness">
    <Notice tone={sourceGap||knowledgeIssues||observationError||syncFailure?'warning':'info'}>
      {observationError ? <p>{t('readinessCheckFailed')}</p> : sourceGap && <p>{t(workspaceMessages[readiness.workspace.code])}</p>}
      {knowledgeGap && <p>{t(knowledgeMessage,{count:Math.max(0,readiness.knowledge.configuredSources-readiness.knowledge.indexedSources),missing:readiness.knowledge.missingEntries,errors:readiness.knowledge.errorEntries})}</p>}
      {!!syncFailure&&<p>{t('knowledgeSyncFailed')}</p>}
      <div className="actions">
        {!!(sourceGap||observationError)&&<Button disabled={loading||syncing} onClick={check}>{t(loading ? 'loading' : 'checkAgain')}</Button>}
        {knowledgeGap&&!observationError&&<Button disabled={loading||syncing} onClick={()=>void synchronize()}>{t(syncing?'syncing':'synchronizeSources')}</Button>}
        {sourceGap && onSettings && <Button disabled={syncing} onClick={onSettings}>{t('projectBindings')}</Button>}
        {knowledgeGap && onKnowledge && <Button disabled={syncing} onClick={onKnowledge}>{t('manageKnowledge')}</Button>}
      </div>
      {(observationError!=null||syncFailure!=null)&&<details><summary>{t('details')}</summary><ErrorNotice error={observationError??syncFailure}/></details>}
    </Notice>
  </div>;
}
