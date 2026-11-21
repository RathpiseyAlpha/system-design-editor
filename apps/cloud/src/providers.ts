// Sign-in providers (SPEC section 8.3): "Sign in with GitHub" and "Sign in with Google", by the OAuth 2 authorization
// code flow (RFC 6749) with a state value, and PKCE (RFC 7636) where the provider takes it. The service never sees a
// password. A provider is turned on by giving it a client id and secret; with none, the editor offers no sign-in.
//
// Written here rather than with a library: the flow is three requests per provider, and the library that does this
// (arctic) is marked deprecated on npm. Every provider is the same small interface, so the app and its tests (with a
// fake provider) do not care which one it is.
import { createHash, randomBytes } from 'node:crypto';

export interface Identity { subject: string; name: string }
export interface Provider {
  id: string;
  /** Shown on the button: "Sign in with <name>". */
  name: string;
  /** Where to send the browser, and what to keep in a short cookie until it comes back. */
  start(): { url: URL; state: string; verifier: string };
  /** Turn the code the provider sent back into the person's stable id and display name. */
  finish(code: string, verifier: string): Promise<Identity>;
}

type Fetch = typeof fetch;
const random = () => randomBytes(32).toString('base64url');
const clip = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Someone';
const TIMEOUT = 10_000;

async function postForm(f: Fetch, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof data.error === 'string') throw new Error(`token endpoint answered ${r.status} ${String(data.error ?? '')}`.trim());
  return data;
}

export function github(clientId: string, secret: string, callback: string, f: Fetch = fetch): Provider {
  return {
    id: 'github',
    name: 'GitHub',
    start() {
      const state = random();
      const url = new URL('https://github.com/login/oauth/authorize');
      // No scope: the public profile (id, login, name) is all sign-in needs.
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, state, allow_signup: 'true' }).toString();
      return { url, state, verifier: '' };
    },
    async finish(code) {
      const t = await postForm(f, 'https://github.com/login/oauth/access_token', { client_id: clientId, client_secret: secret, code, redirect_uri: callback });
      if (typeof t.access_token !== 'string') throw new Error('GitHub sent no access token');
      const r = await f('https://api.github.com/user', {
        headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'archboard-cloud' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const u = (await r.json()) as { id?: unknown; login?: unknown; name?: unknown };
      if (typeof u.id !== 'number') throw new Error('GitHub sent no user id');
      return { subject: String(u.id), name: clip(typeof u.name === 'string' && u.name ? u.name : typeof u.login === 'string' ? u.login : '') };
    },
  };
}

export function google(clientId: string, secret: string, callback: string, f: Fetch = fetch): Provider {
  return {
    id: 'google',
    name: 'Google',
    start() {
      const state = random(), verifier = random();
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      // "openid profile": the stable id (sub) and the name. Not "email": the service does not keep one.
      url.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: callback, scope: 'openid profile', state,
        code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
      }).toString();
      return { url, state, verifier };
    },
    async finish(code, verifier) {
      const t = await postForm(f, 'https://oauth2.googleapis.com/token', {
        grant_type: 'authorization_code', code, client_id: clientId, client_secret: secret, redirect_uri: callback, code_verifier: verifier,
      });
      if (typeof t.id_token !== 'string') throw new Error('Google sent no id token');
      // The id token came straight from Google's token endpoint over TLS in answer to our own request, so its claims
      // can be read without checking the signature (OpenID Connect Core 3.1.3.7); the audience and issuer still are.
      const claims = JSON.parse(Buffer.from(t.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown; aud?: unknown; iss?: unknown; name?: unknown; given_name?: unknown };
      if (claims.aud !== clientId || (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com')) throw new Error('the id token is not for this service');
      if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Google sent no subject');
      return { subject: claims.sub, name: clip(typeof claims.name === 'string' ? claims.name : typeof claims.given_name === 'string' ? claims.given_name : '') };
    },
  };
}

/** The providers turned on by the environment: a client id and a secret each. */
export function providersFromEnv(env: Record<string, string | undefined>, publicUrl: URL): Provider[] {
  const cb = (id: string) => new URL(`auth/${id}/callback`, publicUrl).toString();
  const out: Provider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push(github(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, cb('github')));
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push(google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, cb('google')));
  return out;
}
