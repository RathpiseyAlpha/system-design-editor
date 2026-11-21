// One API key per host (SPEC section 10). Keys come from the environment, never from a file in the repository:
//   ARCHBOARD_KEYS="labsite:<secret>,other-host:<secret>"
// A key is compared by its SHA-256 digest in constant time, so neither its length nor its first letters leak by timing.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface Key { name: string; digest: Buffer }

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
export const MIN_SECRET = 24;

/** Read the key list. A bad entry stops the service at start, rather than leaving a host locked out later. */
export function parseKeys(env: string | undefined): Key[] {
  const out: Key[] = [];
  for (const part of (env ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(':');
    const name = part.slice(0, at), secret = part.slice(at + 1);
    if (at < 1 || !/^[a-z0-9-]{1,40}$/.test(name)) throw new Error(`ARCHBOARD_KEYS: "${part.slice(0, 12)}..." must be name:secret, the name in a-z, 0-9 and -`);
    if (secret.length < MIN_SECRET) throw new Error(`ARCHBOARD_KEYS: the secret for "${name}" is shorter than ${MIN_SECRET} characters`);
    if (out.some((k) => k.name === name)) throw new Error(`ARCHBOARD_KEYS: "${name}" is listed twice`);
    out.push({ name, digest: digest(secret) });
  }
  return out;
}

/** The host a bearer token belongs to, or null. Every key is compared, so the time does not depend on which one matched. */
export function hostFor(keys: Key[], authorization: string | undefined): string | null {
  const m = /^Bearer ([\x21-\x7e]{1,200})$/.exec(authorization ?? '');
  if (!m) return null;
  const d = digest(m[1]!);
  let found: string | null = null;
  for (const k of keys) if (timingSafeEqual(k.digest, d) && found === null) found = k.name;
  return found;
}
