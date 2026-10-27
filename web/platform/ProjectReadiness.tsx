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
  if (!readiness && loading) return <p className="small muted" role="status">{t('checkingSourceBaseline')}</p>;
  const sourceGap = readiness && readiness.workspace.status !== 'ready';
  const knowledgeGap = readiness && ['not_indexed', 'issues'].includes(readiness.knowledge.status);
  if (!sourceGap && !knowledgeGap && !error) return null;
  return <div className="project-readiness">
    <Notice tone="warning">
      {error ? <p>{t('sourceInspectionFailed')}</p> : sourceGap && <p>{t(workspaceMessages[readiness.workspace.code])}</p>}
      {knowledgeGap && <p>{t('projectKnowledgeNeedsSync')}</p>}
      <div className="actions">
        <Button disabled={loading} onClick={() => void refresh()}>{t(loading ? 'loading' : 'checkAgain')}</Button>
        {sourceGap && onSettings && <Button onClick={onSettings}>{t('projectBindings')}</Button>}
        {knowledgeGap && onKnowledge && <Button onClick={onKnowledge}>{t('manageKnowledge')}</Button>}
      </div>
      {error != null && <details><summary>{t('details')}</summary><ErrorNotice error={error}/></details>}
    </Notice>
  </div>;
}
