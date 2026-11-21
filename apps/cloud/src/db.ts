// The cloud service's data (SPEC section 8.3): people, their sessions and their diagrams, in one SQLite file through
// Node's own `node:sqlite` (no native package to build). Only what sign-in needs is kept about a person: the provider,
// the provider's id for them and a display name. No email, no picture, no password.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export interface User { id: string; provider: string; subject: string; name: string; created: number }
export interface DiagramRow { id: string; title: string; version: number; updated: number; created: number; bytes: number }
export interface DiagramDoc extends DiagramRow { body: string }

/** Long random ids (128 bits): never a counter, so one person's ids say nothing about anyone else's. */
export const newId = () => randomBytes(16).toString('base64url');

const SCHEMA = [
  // 1: the first schema.
  `CREATE TABLE users (
     id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL,
     UNIQUE (provider, subject));
   CREATE TABLE sessions (
     hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE diagrams (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
     body TEXT NOT NULL, version INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
   CREATE INDEX diagrams_user ON diagrams(user_id, updated);`,
];

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    const at = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = at; v < SCHEMA.length; v++) {
      this.db.exec('BEGIN');
      this.db.exec(SCHEMA[v]!);
      this.db.exec(`PRAGMA user_version = ${v + 1}`);
      this.db.exec('COMMIT');
    }
  }

  close() { this.db.close(); }

  // People ------------------------------------------------------------------------------------------------------------

  /** The person signing in with this provider account, created on their first sign-in; the name follows the provider's. */
  upsertUser(provider: string, subject: string, name: string, now: number): User {
    const found = this.db.prepare('SELECT * FROM users WHERE provider = ? AND subject = ?').get(provider, subject) as User | undefined;
    if (found) {
      if (found.name !== name) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, found.id);
      return { ...found, name };
    }
    const user: User = { id: newId(), provider, subject, name, created: now };
    this.db.prepare('INSERT INTO users (id, provider, subject, name, created) VALUES (?, ?, ?, ?, ?)').run(user.id, provider, subject, name, now);
    return user;
  }

  user(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  /** Delete a person with every session and diagram of theirs (the foreign keys cascade). */
  deleteUser(id: string) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  // Sessions: only a hash of the token is stored, so a copy of the database signs no one in. -----------------------

  addSession(hash: string, userId: string, expires: number) {
    this.db.prepare('INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)').run(hash, userId, expires);
  }
  session(hash: string): { user_id: string; expires: number } | undefined {
    return this.db.prepare('SELECT user_id, expires FROM sessions WHERE hash = ?').get(hash) as { user_id: string; expires: number } | undefined;
  }
  extendSession(hash: string, expires: number) {
    this.db.prepare('UPDATE sessions SET expires = ? WHERE hash = ?').run(expires, hash);
  }
  deleteSession(hash: string) {
    this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
  }
  deleteExpiredSessions(now: number) {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
  }

  // Diagrams: every query names the owner, so one person can never read or change another's. ------------------------

  list(userId: string): DiagramRow[] {
    return this.db.prepare('SELECT id, title, version, updated, created, length(CAST(body AS BLOB)) AS bytes FROM diagrams WHERE user_id = ? ORDER BY updated DESC').all(userId) as unknown as DiagramRow[];
  }
  count(userId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM diagrams WHERE user_id = ?').get(userId) as { n: number }).n;
  }
  get(userId: string, id: string): DiagramDoc | undefined {
    return this.db.prepare('SELECT id, title, version, updated, created, length(CAST(body AS BLOB)) AS bytes, body FROM diagrams WHERE user_id = ? AND id = ?').get(userId, id) as DiagramDoc | undefined;
  }
  create(userId: string, title: string, body: string, now: number): DiagramRow {
    const id = newId();
    this.db.prepare('INSERT INTO diagrams (id, user_id, title, body, version, created, updated) VALUES (?, ?, ?, ?, 1, ?, ?)').run(id, userId, title, body, now, now);
    return { id, title, version: 1, updated: now, created: now, bytes: Buffer.byteLength(body) };
  }
  /** Replace a diagram only if it is still at `base`: true when it was replaced, false when someone saved in between. */
  replace(userId: string, id: string, base: number, title: string, body: string, now: number): boolean {
    const r = this.db.prepare('UPDATE diagrams SET title = ?, body = ?, version = version + 1, updated = ? WHERE user_id = ? AND id = ? AND version = ?').run(title, body, now, userId, id, base);
    return Number(r.changes) === 1;
  }
  remove(userId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM diagrams WHERE user_id = ? AND id = ?').run(userId, id).changes) === 1;
  }
}
