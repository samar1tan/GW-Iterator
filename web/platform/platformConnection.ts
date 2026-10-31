export type PlatformConnectionState = 'checking' | 'connected' | 'not-configured' | 'disconnected' | 'authentication-failed' | 'read-failed';

export function platformConnectionState(value: unknown): PlatformConnectionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'read-failed';
  const info = value as Record<string, unknown>;
  if (typeof info.connected !== 'boolean' || typeof info.available !== 'boolean' || typeof info.authenticated !== 'boolean') return 'read-failed';
  let error: {code: string; status?: number} | undefined;
  if (info.error !== undefined) {
    if (!info.error || typeof info.error !== 'object' || Array.isArray(info.error)) return 'read-failed';
    const detail = info.error as Record<string, unknown>;
    if (typeof detail.code !== 'string' || typeof detail.message !== 'string' || (detail.status !== undefined && typeof detail.status !== 'number')) return 'read-failed';
    error = detail as {code: string; status?: number};
  }
  if (error?.code === 'MULTICA_NOT_CONFIGURED') return 'not-configured';
  if (error?.status === 401 || error?.status === 403 || (!error && info.available && !info.authenticated)) return 'authentication-failed';
  if (info.connected && info.available && info.authenticated && !error) return 'connected';
  return 'disconnected';
}
