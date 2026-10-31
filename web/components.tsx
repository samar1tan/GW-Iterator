import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Attempt, ControlTool, Executor, RoleProfile, WorkStatus } from '../src/contracts';
import { APIError, errorText } from './api';
import { useI18n } from './i18n';
import type { MessageKey } from './locales/en';
import {Icon, StateIcon} from './Icons';
import {governanceErrorKeys} from './governanceErrorMessages';
import {attachmentEn,attachmentZh} from './platform/attachmentCopy';

export function Button({ children, tone = 'default', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'primary' | 'danger' | 'quiet' }) {
  return <button type="button" {...props} className={`button ${tone} ${className}`}>{children}</button>;
}
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}
export function SectionTitle({ title, children, subtitle }: { title: string; subtitle?: string; children?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>{children && <div className="actions">{children}</div>}</div>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warning' | 'error' }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`notice ${tone}`}>{children}</div>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  const { t,locale } = useI18n();
  if (!error) return null;
  const messageKeys:Record<string,MessageKey>={...governanceErrorKeys,FOLLOWUP_NOT_READY:'followUpNotReady',INVALID_PARENT_INTAKE:'invalidParentIntake',CLARIFICATION_REPLY_REQUIRED:'clarificationReplyRequired',INVALID_PROJECT:'invalidProject',REVISION_CONFLICT:'revisionChanged',INVALID_ROLE:'invalidRole',INVALID_BROWSER_ORIGINS:'invalidBrowserOrigins',REVIEW_CONFLICT:'deliveryReviewChanged',REVIEW_INPUT_CHANGED:'deliveryReviewChanged',REVIEW_SOURCE_UNAVAILABLE:'deliveryReviewSourceUnavailable',REVIEW_PREPARATION_ACTIVE:'deliveryReviewPreparationActive',REVIEW_CLOSED:'deliveryReviewClosed',REVIEW_FINDING_REQUIRED:'deliveryReviewFindingRequired',INVALID_SOURCE:'invalidSource',WORKSPACE_TOO_BROAD:'workspaceTooBroad'};
  const localizedKey=error instanceof APIError?messageKeys[error.code]:undefined;
  const attachmentKeys:Record<string,keyof typeof attachmentEn>={INVALID_ATTACHMENT:'attachmentInvalid',INVALID_ATTACHMENTS:'attachmentInvalid',ATTACHMENT_TOO_LARGE:'attachmentTooLarge',ATTACHMENT_TOTAL_TOO_LARGE:'attachmentTotalTooLarge',ATTACHMENT_MISSING:'attachmentMissing',ATTACHMENT_NOT_FOUND:'attachmentMissing',ATTACHMENT_CORRUPT:'attachmentMissing',ATTACHMENT_UNSAFE_PATH:'attachmentUnsafe',ATTACHMENT_HANDOFF_UNAVAILABLE:'attachmentHandoffUnavailable',ATTACHMENT_PREVIEW_UNAVAILABLE:'attachmentPreviewUnavailable'};
  const attachmentKey=error instanceof APIError?attachmentKeys[error.code]:undefined;
  if(attachmentKey&&error instanceof APIError){const name=error.details&&typeof error.details==='object'&&'name' in error.details&&typeof error.details.name==='string'?error.details.name:undefined;return <Notice tone="error"><p>{(locale==='zh-CN'?attachmentZh:attachmentEn)[attachmentKey]}{name&&<> · {name}</>}</p><details><summary>{t('details')}</summary><code>{error.code}</code><p>{error.message}</p>{error.details!==undefined&&<pre className="json-output">{JSON.stringify(error.details,null,2)}</pre>}</details></Notice>;}
  return <Notice tone="error"><div>{localizedKey?t(localizedKey):errorText(error)}</div>{error instanceof APIError && (localizedKey?<details><summary>{t('details')}</summary><code className="error-code">{error.code}</code><p>{errorText(error)}</p>{error.details!==undefined&&<pre className="json-output">{JSON.stringify(error.details,null,2)}</pre>}</details>:<><code className="error-code">{error.code}</code>{error.details !== undefined && <details><summary>{t('details')}</summary><pre className="json-output">{JSON.stringify(error.details, null, 2)}</pre></details>}</>)}</Notice>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function ModalPortal({children}:{children:ReactNode}) {
  if(typeof document==='undefined')return children;
  return createPortal(<div className="pf-platform" style={{display:'contents'}}>{children}</div>,document.body);
}
export function Modal({ title, children, footer, onClose, wide = false, busy = false }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }) {
  const { t } = useI18n(); const titleId = useId(); const dialog = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const previousFocus = opener.current;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => { document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => { if (busy) dialog.current?.focus(); }, [busy]);
  return <ModalPortal><div className="modal-scrim" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={busy || undefined} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
    if (event.key === 'Tab') {
      const targets = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
      if (!targets.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = targets[0]; const last = targets.at(-1);
      if (document.activeElement === dialog.current) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><header className="modal-header"><h2 id={titleId}>{title}</h2>{busy&&<span className="modal-progress" role="status">{t('processing')}</span>}<Button tone="quiet" disabled={busy} onClick={onClose} aria-label={t('close')}><Icon name="close"/></Button></header><div className="modal-content" inert={busy}>{children}</div>{footer&&<footer className="modal-footer" inert={busy}>{footer}</footer>}</section></div></ModalPortal>;
}
export function Status({ value }: { value: WorkStatus }) {
  const { t } = useI18n(); return <span className={`status status-${value}`}><StateIcon status={value}/>{t(value === 'waiting' ? 'waitingStatus' : value)}</span>;
}
const executorKeys: Record<Executor, MessageKey> = { manual: 'manual', codex: 'codexExecutor', github: 'githubExecutor', pipeline: 'pipelineExecutor' };
export function ExecutorLabel({ value }: { value: Executor }) { const { t } = useI18n(); return <>{t(executorKeys[value])}</>; }
export function NativeGoalInfo({ attempt, showThread = true }: { attempt: Attempt; showThread?: boolean }) {
  const { t, number } = useI18n();
  if (!attempt.nativeGoal && !attempt.nativeGoalCleared && !(showThread && attempt.ref?.threadId)) return null;
  return <section className="native-goal-info"><h3>{t('nativeGoalTitle')}</h3><dl className="metadata-list">
    {(attempt.nativeGoal || attempt.nativeGoalCleared) && <div><dt>{t('nativeGoalStatus')}</dt><dd><code>{attempt.nativeGoalCleared ? t('nativeGoalCleared') : attempt.nativeGoal?.status}</code></dd></div>}
    {attempt.nativeGoal && <><div><dt>{t('nativeGoalElapsed')}</dt><dd>{t('seconds', { count: number(attempt.nativeGoal.timeUsedSeconds) })}</dd></div><div><dt>{t('nativeGoalTokens')}</dt><dd>{number(attempt.nativeGoal.tokensUsed)}</dd></div></>}
    {showThread && attempt.ref?.threadId && <div><dt>{t('nativeGoalThread')}</dt><dd><code>{attempt.ref.threadId}</code></dd></div>}
  </dl></section>;
}
export const toolKeys: Record<ControlTool, MessageKey> = { 'context.read': 'toolReadContext', 'knowledge.search': 'toolSearchKnowledge', 'knowledge.write': 'toolWriteKnowledge', 'pipeline.read': 'toolReadPipeline', 'pipeline.propose': 'toolProposePipeline', 'pipeline.write': 'toolWritePipeline', 'run.read': 'toolReadRun', 'run.start': 'toolStartRun', 'intake.route': 'toolRouteIntake', 'project.bootstrap': 'toolBootstrapProject', 'browser.use':'toolBrowserUse' };
export function RoleTags({ roles, profiles }: { roles: string[]; profiles: RoleProfile[] }) {
  const { t } = useI18n(); return <div className="tags">{roles.length ? roles.map(role => <span key={role} className="tag">{profiles.find(profile => profile.id === role)?.name ?? role}</span>) : <span className="muted small">{t('allRoles')}</span>}</div>;
}
export function RoleChecks({ roles, selected, onChange }: { roles: RoleProfile[]; selected: string[]; onChange: (value: string[]) => void }) {
  return <div className="check-grid">{roles.map(role => <label className="check" key={role.id}><input type="checkbox" checked={selected.includes(role.id)} onChange={event => onChange(event.target.checked ? [...selected, role.id] : selected.filter(id => id !== role.id))} /><span>{role.name}</span></label>)}</div>;
}
