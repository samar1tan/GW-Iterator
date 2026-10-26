export class APIError extends Error {
  code: string;
  details?: unknown;
  status: number;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message); this.name = 'APIError'; this.status = status; this.code = code; this.details = details;
  }
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? 'GET', credentials: 'same-origin', signal: options?.signal,
    headers: options?.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const payload = body as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new APIError(response.status, payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? response.statusText, payload?.error?.details);
  }
  return body as T;
}
export const uid = () => crypto.randomUUID();
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export function safeURL(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
