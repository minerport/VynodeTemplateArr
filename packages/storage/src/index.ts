import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const foundationSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS key_values (namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,key));
CREATE TABLE IF NOT EXISTS encrypted_secrets (namespace TEXT NOT NULL, key TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, auth_tag BLOB NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,key));
CREATE TABLE IF NOT EXISTS audit_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL, details_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_events_occurred_at ON audit_events(occurred_at DESC);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, media_server_scopes_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);`;

const identitySql = `
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('viewer','operator','administrator','owner')),
  plex_account_id TEXT NOT NULL UNIQUE,
  verified_email TEXT NOT NULL,
  plex_username TEXT NOT NULL,
  plex_title TEXT,
  avatar_url TEXT,
  has_plex_pass INTEGER NOT NULL CHECK(has_plex_pass IN (0,1)),
  token_reference TEXT NOT NULL,
  media_server_scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX identities_single_owner ON identities(role) WHERE role='owner';`;

const migrations = [
  { version: 1, sql: foundationSql },
  { version: 2, sql: identitySql },
] as const;
const validName = (value: string) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error('Storage names must be from 1 through 200 characters.');
  return normalized;
};

export class VynodeSqliteStorage {
  public readonly database: DatabaseSync;
  readonly #transactionContext = new AsyncLocalStorage<number>();
  #transactionTail: Promise<void> = Promise.resolve();

  public constructor(path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    this.database = new DatabaseSync(resolved);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  public close(): void { this.database.close(); }

  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const depth = this.#transactionContext.getStore();
    if (depth !== undefined) return this.#runTransaction(operation, depth);
    const previous = this.#transactionTail;
    let release!: () => void;
    this.#transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.#transactionContext.run(0, () => this.#runTransaction(operation, 0));
    } finally {
      release();
    }
  }

  async #runTransaction<T>(operation: () => Promise<T>, depth: number): Promise<T> {
    const savepoint = `vynode_nested_${depth}`;
    this.database.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    try {
      const result = await this.#transactionContext.run(depth + 1, operation);
      this.database.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      this.database.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  public migrationVersions(): number[] {
    return this.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version));
  }

  private migrate(): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.migrationVersions());
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.exec(migration.sql);
        this.database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw new Error(`Storage migration ${migration.version} failed.`, { cause: error });
      }
    }
  }
}

export interface VersionedValue<T> { revision: number; value: T; updatedAt: string }

export class SqliteJsonRepository<T> {
  public constructor(private readonly storage: VynodeSqliteStorage, private readonly namespace: string) { validName(namespace); }

  public get(key: string): VersionedValue<T> | undefined {
    const row = this.storage.database.prepare('SELECT revision, value_json, updated_at FROM key_values WHERE namespace=? AND key=?').get(this.namespace, validName(key));
    if (!row) return undefined;
    return { revision: Number(row.revision), value: JSON.parse(String(row.value_json)) as T, updatedAt: String(row.updated_at) };
  }

  public put(key: string, value: T, expectedRevision?: number, now = new Date()): VersionedValue<T> {
    const normalized = validName(key);
    const current = this.get(normalized);
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new Error('The stored value changed; reload it before saving.');
    const revision = (current?.revision ?? 0) + 1;
    const updatedAt = now.toISOString();
    this.storage.database.prepare(`INSERT INTO key_values(namespace,key,revision,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value_json=excluded.value_json,updated_at=excluded.updated_at`).run(this.namespace, normalized, revision, JSON.stringify(value), updatedAt);
    return { revision, value: structuredClone(value), updatedAt };
  }

  public delete(key: string): boolean {
    return Number(this.storage.database.prepare('DELETE FROM key_values WHERE namespace=? AND key=?').run(this.namespace, validName(key)).changes) > 0;
  }
}

export class EncryptedSecretVault {
  public constructor(private readonly storage: VynodeSqliteStorage, private readonly key: Buffer, private readonly namespace = 'integrations') {
    if (key.byteLength !== 32) throw new Error('The Vynode master key must contain exactly 32 bytes.');
    validName(namespace);
  }

  public static keyFromBase64(value: string): Buffer {
    const key = Buffer.from(value.trim(), 'base64');
    if (key.byteLength !== 32) throw new Error('VYNODE_MASTER_KEY must be base64 for exactly 32 bytes.');
    return key;
  }

  public set(name: string, secret: string, now = new Date()): void {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(`${this.namespace}:${name}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.storage.database.prepare(`INSERT INTO encrypted_secrets(namespace,key,nonce,ciphertext,auth_tag,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET nonce=excluded.nonce,ciphertext=excluded.ciphertext,auth_tag=excluded.auth_tag,updated_at=excluded.updated_at`).run(this.namespace, validName(name), nonce, ciphertext, tag, now.toISOString());
  }

  public get(name: string): string | undefined {
    const normalized = validName(name);
    const row = this.storage.database.prepare('SELECT nonce,ciphertext,auth_tag FROM encrypted_secrets WHERE namespace=? AND key=?').get(this.namespace, normalized);
    if (!row) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.nonce as Uint8Array));
      decipher.setAAD(Buffer.from(`${this.namespace}:${normalized}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(row.auth_tag as Uint8Array));
      return Buffer.concat([decipher.update(Buffer.from(row.ciphertext as Uint8Array)), decipher.final()]).toString('utf8');
    } catch (error) {
      throw new Error('The stored secret could not be decrypted with the configured master key.', { cause: error });
    }
  }

  public delete(name: string): boolean {
    return Number(this.storage.database.prepare('DELETE FROM encrypted_secrets WHERE namespace=? AND key=?').run(this.namespace, validName(name)).changes) > 0;
  }

  public async store(secret: string): Promise<string> {
    const reference = randomBytes(24).toString('base64url');
    this.set(reference, secret);
    return reference;
  }

  public async replace(reference: string, secret: string): Promise<string> {
    this.set(reference, secret);
    return reference;
  }
}

export interface StoredIdentity {
  id: string;
  role: StoredUserRole;
  plexAccountId: string;
  verifiedEmail: string;
  plexUsername: string;
  plexTitle?: string;
  avatarUrl?: string;
  hasPlexPass: boolean;
  tokenReference: string;
  mediaServerScopes?: readonly string[];
}

const storedIdentityFromRow = (row: Record<string, unknown>): StoredIdentity => {
  const role = String(row.role);
  if (!['viewer', 'operator', 'administrator', 'owner'].includes(role))
    throw new Error('A stored identity has an invalid role.');
  const scopes: unknown = JSON.parse(String(row.media_server_scopes_json));
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string'))
    throw new Error('A stored identity has invalid media server scopes.');
  return {
    id: String(row.id),
    role: role as StoredUserRole,
    plexAccountId: String(row.plex_account_id),
    verifiedEmail: String(row.verified_email),
    plexUsername: String(row.plex_username),
    hasPlexPass: Number(row.has_plex_pass) === 1,
    tokenReference: String(row.token_reference),
    mediaServerScopes: scopes,
    ...(row.plex_title ? { plexTitle: String(row.plex_title) } : {}),
    ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
  };
};

export class SqliteIdentityRepository {
  public constructor(private readonly storage: VynodeSqliteStorage) {}

  public async count(): Promise<number> {
    const row = this.storage.database.prepare('SELECT COUNT(*) AS count FROM identities').get();
    return Number(row?.count ?? 0);
  }

  public async findById(id: string): Promise<StoredIdentity | undefined> {
    const row = this.storage.database.prepare('SELECT * FROM identities WHERE id=?').get(validName(id));
    return row ? storedIdentityFromRow(row) : undefined;
  }

  public async findByPlexAccountId(plexAccountId: string): Promise<StoredIdentity | undefined> {
    const row = this.storage.database.prepare('SELECT * FROM identities WHERE plex_account_id=?').get(validName(plexAccountId));
    return row ? storedIdentityFromRow(row) : undefined;
  }

  public async save(record: StoredIdentity, now = new Date()): Promise<void> {
    const email = record.verifiedEmail.trim().toLowerCase();
    if (!email) throw new Error('A verified email is required.');
    const scopes = record.mediaServerScopes ?? [];
    this.storage.database.prepare(`INSERT INTO identities(id,role,plex_account_id,verified_email,plex_username,plex_title,avatar_url,has_plex_pass,token_reference,media_server_scopes_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,plex_account_id=excluded.plex_account_id,verified_email=excluded.verified_email,plex_username=excluded.plex_username,plex_title=excluded.plex_title,avatar_url=excluded.avatar_url,has_plex_pass=excluded.has_plex_pass,token_reference=excluded.token_reference,media_server_scopes_json=excluded.media_server_scopes_json,updated_at=excluded.updated_at`).run(
      validName(record.id), record.role, validName(record.plexAccountId), email,
      validName(record.plexUsername), record.plexTitle ?? null, record.avatarUrl ?? null,
      record.hasPlexPass ? 1 : 0, validName(record.tokenReference), JSON.stringify(scopes),
      now.toISOString(), now.toISOString()
    );
  }

  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    return this.storage.transaction(operation);
  }

  public async principalForUser(userId: string): Promise<{ role: StoredUserRole; mediaServerScopes: readonly string[] }> {
    const identity = await this.findById(userId);
    if (!identity) throw new Error('The session identity no longer exists.');
    return { role: identity.role, mediaServerScopes: identity.mediaServerScopes ?? [] };
  }
}

export interface AuditEventInput { occurredAt?: string; actorId?: string; action: string; target: string; outcome: 'success'|'failure'|'denied'; details?: Readonly<Record<string, unknown>> }
export class SqliteAuditLog {
  public constructor(private readonly storage: VynodeSqliteStorage) {}
  public append(event: AuditEventInput): number {
    const result = this.storage.database.prepare('INSERT INTO audit_events(occurred_at,actor_id,action,target,outcome,details_json) VALUES(?,?,?,?,?,?)').run(event.occurredAt ?? new Date().toISOString(), event.actorId ?? null, validName(event.action), validName(event.target), event.outcome, JSON.stringify(event.details ?? {}));
    return Number(result.lastInsertRowid);
  }
  public recent(limit = 100): readonly Record<string, unknown>[] {
    return this.storage.database.prepare('SELECT sequence,occurred_at,actor_id,action,target,outcome,details_json FROM audit_events ORDER BY sequence DESC LIMIT ?').all(Math.max(1, Math.min(1000, limit))).map((row) => ({ sequence:Number(row.sequence), occurredAt:String(row.occurred_at), ...(row.actor_id ? { actorId:String(row.actor_id) } : {}), action:String(row.action), target:String(row.target), outcome:String(row.outcome), details:JSON.parse(String(row.details_json)) as unknown }));
  }
}

export type StoredUserRole = 'viewer' | 'operator' | 'administrator' | 'owner';
export interface StoredSessionPrincipal {
  userId: string;
  role: StoredUserRole;
  mediaServerScopes: readonly string[];
  sessionId: string;
}

const sessionHash = (sessionId: string) =>
  createHash('sha256').update(sessionId, 'utf8').digest('hex');

export class SqliteSessionRepository {
  public constructor(
    private readonly storage: VynodeSqliteStorage,
    private readonly principalForUser: (
      userId: string
    ) => Promise<{ role: StoredUserRole; mediaServerScopes: readonly string[] }>,
    private readonly durationMilliseconds = 30 * 24 * 60 * 60 * 1000,
    private readonly now: () => Date = () => new Date()
  ) {
    if (durationMilliseconds < 60_000)
      throw new Error('Session duration must be at least one minute.');
  }

  public async rotateForUser(
    previousSessionId: string | undefined,
    userId: string
  ): Promise<{ sessionId: string; expiresAt: string }> {
    const normalizedUserId = validName(userId);
    const principal = await this.principalForUser(normalizedUserId);
    const sessionId = randomBytes(32).toString('base64url');
    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.durationMilliseconds
    ).toISOString();
    await this.storage.transaction(async () => {
      if (previousSessionId)
        this.storage.database
          .prepare('UPDATE sessions SET revoked_at=? WHERE id_hash=? AND revoked_at IS NULL')
          .run(createdAt.toISOString(), sessionHash(previousSessionId));
      this.storage.database
        .prepare(
          'INSERT INTO sessions(id_hash,user_id,role,media_server_scopes_json,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)'
        )
        .run(
          sessionHash(sessionId),
          normalizedUserId,
          principal.role,
          JSON.stringify(principal.mediaServerScopes),
          createdAt.toISOString(),
          expiresAt
        );
    });
    return { sessionId, expiresAt };
  }

  public async revoke(sessionId: string): Promise<void> {
    this.storage.database
      .prepare('UPDATE sessions SET revoked_at=? WHERE id_hash=? AND revoked_at IS NULL')
      .run(this.now().toISOString(), sessionHash(sessionId));
  }

  public async revokeUser(userId: string): Promise<number> {
    return Number(
      this.storage.database
        .prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL')
        .run(this.now().toISOString(), validName(userId)).changes
    );
  }

  public async resolve(
    sessionId: string
  ): Promise<StoredSessionPrincipal | undefined> {
    const row = this.storage.database
      .prepare(
        'SELECT user_id,role,media_server_scopes_json,expires_at,revoked_at FROM sessions WHERE id_hash=?'
      )
      .get(sessionHash(sessionId));
    if (!row || row.revoked_at || Date.parse(String(row.expires_at)) <= this.now().getTime())
      return undefined;
    const role = String(row.role);
    if (!['viewer', 'operator', 'administrator', 'owner'].includes(role))
      return undefined;
    const scopes: unknown = JSON.parse(String(row.media_server_scopes_json));
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string'))
      return undefined;
    return {
      userId: String(row.user_id),
      role: role as StoredUserRole,
      mediaServerScopes: scopes,
      sessionId,
    };
  }

  public cleanupExpired(): number {
    return Number(
      this.storage.database
        .prepare('DELETE FROM sessions WHERE expires_at<=? OR revoked_at IS NOT NULL')
        .run(this.now().toISOString()).changes
    );
  }
}
