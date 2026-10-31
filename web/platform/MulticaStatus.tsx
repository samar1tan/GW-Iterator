import {useEffect, useState} from 'react';
import {api} from '../api';
import {useCopy} from './copy';
import {platformConnectionState} from './platformConnection';
import type {PlatformConnectionState} from './platformConnection';

const labels = {
  checking: 'platformChecking', connected: 'connected', 'not-configured': 'platformNotConfigured',
  disconnected: 'platformDisconnected', 'authentication-failed': 'platformAuthenticationFailed', 'read-failed': 'platformReadFailed',
} as const;

export function MulticaStatus({ready, onOpenTeam}: {ready: boolean; onOpenTeam?: () => void}) {
  const [state, setState] = useState<PlatformConnectionState>('checking');
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let active = true, busy = false;
    const observe = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const value = await api<unknown>('/api/platform', {signal: controller.signal});
        if (active) setState(platformConnectionState(value));
      } catch {
        if (active) setState('read-failed');
      } finally {
        busy = false;
      }
    };
    const refresh = () => { void observe(); };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [ready]);
  return <MulticaStatusView state={state} onOpenTeam={onOpenTeam}/>;
}

export function MulticaStatusView({state, onOpenTeam}: {state: PlatformConnectionState; onOpenTeam?: () => void}) {
  const {p} = useCopy();
  const label = p(labels[state]), description = `${p('connection')}: ${label}. ${p('platformConnectionHelp')}`;
  const tone = state === 'connected' ? 'connected' : state === 'checking' || state === 'read-failed' ? 'unknown' : 'disconnected';
  const content = <><i aria-hidden="true"/><span className="pf-connection-label">{label}</span><span className="pf-connection-brand" aria-hidden="true">Multica</span></>;
  return <span role="status" aria-live="polite" aria-atomic="true" aria-label={p('connection')}>{onOpenTeam
    ? <button type="button" className={`pf-integration-status ${tone}`} data-state={state} aria-label={`${description} ${p('platformOpenTeam')}`} title={`${description} ${p('platformOpenTeam')}`} onClick={onOpenTeam}>{content}</button>
    : <span className={`pf-integration-status ${tone}`} data-state={state} title={description}>{content}</span>}
  </span>;
}
