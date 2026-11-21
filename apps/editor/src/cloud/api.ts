// Talking to the cloud service (SPEC section 8.3, apps/cloud). The editor is served by that service at the root of its
// address, so every call is same-origin and the session cookie goes with it. Where there is no service (GitHub Pages, the
// dev server, a fresh clone), /api/me is not JSON or not there, and the editor works exactly as before: no sign-in.
import type { Diagram } from '@archboard/engine';

export interface CloudUser { id: string; name: string }
export interface Me { user: CloudUser | null; providers: { id: string; name: string }[]; dev: boolean }
export interface Row { id: string; title: string; version: number; updated: number; created: number; bytes: number }
export interface Doc { id: string; title: string; version: number; updated: number; diagram: Diagram }

/** What a call came back with: the data, or why not. `offline` means no answer at all (try again later). */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; current?: Doc };

const url = (path: string) => new URL(path, document.baseURI).toString();

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  let r: Response;
  try {
    r = await fetch(url(path), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: 0, error: 'offline', message: 'No connection to the server.' };
  }
  if (r.status === 204) return { ok: true, data: undefined as T };
  const json = /^application\/json\b/.test(r.headers.get('content-type') ?? '') ? await r.json().catch(() => null) : null;
  if (r.ok && json) return { ok: true, data: json as T };
  const j = (json ?? {}) as { error?: string; message?: string; current?: Doc };
  return { ok: false, status: r.status, error: j.error ?? 'unexpected', message: j.message ?? `The server answered ${r.status}.`, current: j.current };
}

/** Who is signed in, or null when there is no cloud service here at all. */
export async function me(): Promise<Me | null> {
  const r = await call<Me>('GET', 'api/me');
  if (!r.ok || !r.data || !Array.isArray(r.data.providers)) return null;
  return r.data;
}

export const devSignIn = (name: string) => call<{ user: CloudUser }>('POST', 'auth/dev', { name });
export const signOut = () => call<void>('POST', 'api/sign-out');
export const deleteAccount = () => call<void>('DELETE', 'api/me');
export const list = () => call<{ diagrams: Row[]; max: number }>('GET', 'api/diagrams');
export const get = (id: string) => call<Doc>('GET', `api/diagrams/${encodeURIComponent(id)}`);
export const create = (diagram: Diagram) => call<{ id: string; title: string; version: number; updated: number }>('POST', 'api/diagrams', { diagram });
export const save = (id: string, diagram: Diagram, base: number) => call<{ version: number; updated: number }>('PUT', `api/diagrams/${encodeURIComponent(id)}`, { diagram, base });
export const remove = (id: string) => call<void>('DELETE', `api/diagrams/${encodeURIComponent(id)}`);
/** The address that starts signing in with a provider (a full page visit). */
export const signInUrl = (provider: string) => url(`auth/${encodeURIComponent(provider)}`);
