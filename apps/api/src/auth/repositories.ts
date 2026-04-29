import { randomToken } from "./crypto.js";
import type { SqliteDatabase } from "../db/connection.js";

export interface OAuthState {
  state: string;
  codeVerifier: string;
  mode: "web" | "mobile";
  returnTo: string;
  expiresAt: Date;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  entryKeyRedeemedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: "google";
  providerSubject: string;
  email: string;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingSessionExchange {
  codeHash: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface EntryKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  label: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  consumedByUserId: string | null;
  consumedByUserEmail: string | null;
  consumedAt: Date | null;
}

export interface OAuthStateStore {
  save(state: OAuthState): Promise<void>;
  consume(state: string, now: Date): Promise<OAuthState | null>;
}

export interface AuthRepository {
  upsertUserFromGoogle(input: {
    providerSubject: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    now: Date;
  }): Promise<User>;
  findUserById(userId: string): Promise<User | null>;
  createSession(input: {
    userId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<Session>;
  findSessionByAccessTokenHash(accessTokenHash: string, now: Date): Promise<Session | null>;
  rotateRefreshToken(input: {
    currentRefreshTokenHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<Session | null>;
  revokeSessionByAccessTokenHash(accessTokenHash: string, now: Date): Promise<boolean>;
  revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<boolean>;
  savePendingSessionExchange(exchange: PendingSessionExchange): Promise<void>;
  consumePendingSessionExchange(codeHash: string, now: Date): Promise<PendingSessionExchange | null>;
  createEntryKey(input: {
    keyHash: string;
    keyPrefix: string;
    label: string | null;
    createdByUserId: string;
    now: Date;
  }): Promise<EntryKey>;
  listEntryKeys(): Promise<EntryKey[]>;
  redeemEntryKey(input: { keyHash: string; userId: string; now: Date }): Promise<User | null>;
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly states = new Map<string, OAuthState>();

  async save(state: OAuthState) {
    this.states.set(state.state, state);
  }

  async consume(state: string, now: Date) {
    const storedState = this.states.get(state);
    this.states.delete(state);

    if (!storedState || storedState.expiresAt <= now) {
      return null;
    }

    return storedState;
  }
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, User>();
  private readonly accounts = new Map<string, OAuthAccount>();
  private readonly sessions = new Map<string, Session>();
  private readonly exchanges = new Map<string, PendingSessionExchange>();
  private readonly entryKeys = new Map<string, EntryKey>();

  async upsertUserFromGoogle(input: {
    providerSubject: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    now: Date;
  }) {
    const accountKey = `google:${input.providerSubject}`;
    const account = this.accounts.get(accountKey);

    if (account) {
      const user = this.users.get(account.userId);

      if (!user) {
        throw new Error("OAuth account points to a missing user");
      }

      const updatedUser = {
        ...user,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        updatedAt: input.now
      };
      this.users.set(updatedUser.id, updatedUser);
      return updatedUser;
    }

    const user: User = {
      id: randomToken(16),
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      entryKeyRedeemedAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };
    const oauthAccount: OAuthAccount = {
      id: randomToken(16),
      userId: user.id,
      provider: "google",
      providerSubject: input.providerSubject,
      email: input.email,
      createdAt: input.now
    };

    this.users.set(user.id, user);
    this.accounts.set(accountKey, oauthAccount);

    return user;
  }

  async findUserById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async createSession(input: {
    userId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    now: Date;
  }) {
    const session: Session = {
      id: randomToken(16),
      userId: input.userId,
      accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };

    this.sessions.set(session.id, session);

    return session;
  }

  async findSessionByAccessTokenHash(accessTokenHash: string, now: Date) {
    return (
      [...this.sessions.values()].find(
        (session) =>
          session.accessTokenHash === accessTokenHash &&
          session.revokedAt === null &&
          session.expiresAt > now
      ) ?? null
    );
  }

  async rotateRefreshToken(input: {
    currentRefreshTokenHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    expiresAt: Date;
    now: Date;
  }) {
    const session = [...this.sessions.values()].find(
      (candidate) =>
        candidate.refreshTokenHash === input.currentRefreshTokenHash &&
        candidate.revokedAt === null &&
        candidate.expiresAt > input.now
    );

    if (!session) {
      return null;
    }

    const rotatedSession = {
      ...session,
      accessTokenHash: input.nextAccessTokenHash,
      refreshTokenHash: input.nextRefreshTokenHash,
      expiresAt: input.expiresAt,
      updatedAt: input.now
    };

    this.sessions.set(rotatedSession.id, rotatedSession);

    return rotatedSession;
  }

  async revokeSessionByAccessTokenHash(accessTokenHash: string, now: Date) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.accessTokenHash === accessTokenHash && candidate.revokedAt === null
    );

    if (!session) {
      return false;
    }

    this.sessions.set(session.id, {
      ...session,
      revokedAt: now,
      updatedAt: now
    });

    return true;
  }

  async revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.refreshTokenHash === refreshTokenHash && candidate.revokedAt === null
    );

    if (!session) {
      return false;
    }

    this.sessions.set(session.id, {
      ...session,
      revokedAt: now,
      updatedAt: now
    });

    return true;
  }

  async savePendingSessionExchange(exchange: PendingSessionExchange) {
    this.exchanges.set(exchange.codeHash, exchange);
  }

  async consumePendingSessionExchange(codeHash: string, now: Date) {
    const exchange = this.exchanges.get(codeHash);

    if (!exchange || exchange.consumedAt !== null || exchange.expiresAt <= now) {
      return null;
    }

    const consumedExchange = {
      ...exchange,
      consumedAt: now
    };
    this.exchanges.set(codeHash, consumedExchange);

    return exchange;
  }

  async createEntryKey(input: {
    keyHash: string;
    keyPrefix: string;
    label: string | null;
    createdByUserId: string;
    now: Date;
  }) {
    const entryKey: EntryKey = {
      id: randomToken(16),
      keyHash: input.keyHash,
      keyPrefix: input.keyPrefix,
      label: input.label,
      createdByUserId: input.createdByUserId,
      createdAt: input.now,
      consumedByUserId: null,
      consumedByUserEmail: null,
      consumedAt: null
    };

    this.entryKeys.set(entryKey.keyHash, entryKey);

    return entryKey;
  }

  async listEntryKeys() {
    return [...this.entryKeys.values()]
      .map((entryKey) => ({
        ...entryKey,
        consumedByUserEmail: entryKey.consumedByUserId
          ? (this.users.get(entryKey.consumedByUserId)?.email ?? null)
          : null
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async redeemEntryKey(input: { keyHash: string; userId: string; now: Date }) {
    const entryKey = this.entryKeys.get(input.keyHash);
    const user = this.users.get(input.userId);

    if (!entryKey || entryKey.consumedAt !== null || !user) {
      return null;
    }

    this.entryKeys.set(input.keyHash, {
      ...entryKey,
      consumedByUserId: user.id,
      consumedByUserEmail: user.email,
      consumedAt: input.now
    });

    const updatedUser = {
      ...user,
      entryKeyRedeemedAt: user.entryKeyRedeemedAt ?? input.now,
      updatedAt: input.now
    };
    this.users.set(user.id, updatedUser);

    return updatedUser;
  }
}

export class SQLiteAuthRepository implements AuthRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async upsertUserFromGoogle(input: {
    providerSubject: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    now: Date;
  }) {
    const account = this.db
      .prepare("SELECT * FROM oauth_accounts WHERE provider = ? AND provider_subject = ?")
      .get("google", input.providerSubject) as Record<string, unknown> | undefined;

    if (account) {
      this.db
        .prepare(
          `
            UPDATE users
            SET email = ?, display_name = ?, avatar_url = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          input.email,
          input.displayName,
          input.avatarUrl,
          toSqlDate(input.now),
          String(account.user_id)
        );
      this.db
        .prepare("UPDATE oauth_accounts SET email = ? WHERE id = ?")
        .run(input.email, String(account.id));

      const user = await this.findUserById(String(account.user_id));

      if (!user) {
        throw new Error("OAuth account points to a missing user");
      }

      return user;
    }

    const user: User = {
      id: randomToken(16),
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      entryKeyRedeemedAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          user.id,
          user.email,
          user.displayName,
          user.avatarUrl,
          toSqlDate(user.createdAt),
          toSqlDate(user.updatedAt)
        );
      this.db
        .prepare(
          `
            INSERT INTO oauth_accounts (id, user_id, provider, provider_subject, email, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          randomToken(16),
          user.id,
          "google",
          input.providerSubject,
          input.email,
          toSqlDate(input.now)
        );
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return user;
  }

  async findUserById(userId: string) {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
      | Record<string, unknown>
      | undefined;

    return row ? mapUser(row) : null;
  }

  async createSession(input: {
    userId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    now: Date;
  }) {
    const session: Session = {
      id: randomToken(16),
      userId: input.userId,
      accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };

    this.db
      .prepare(
        `
          INSERT INTO sessions (
            id, user_id, access_token_hash, refresh_token_hash, user_agent, ip_address,
            expires_at, revoked_at, created_at, updated_at, rotated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        session.id,
        session.userId,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.userAgent,
        session.ipAddress,
        toSqlDate(session.expiresAt),
        null,
        toSqlDate(session.createdAt),
        toSqlDate(session.updatedAt),
        null
      );

    return session;
  }

  async findSessionByAccessTokenHash(accessTokenHash: string, now: Date) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM sessions
          WHERE access_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        `
      )
      .get(accessTokenHash, toSqlDate(now)) as Record<string, unknown> | undefined;

    return row ? mapSession(row) : null;
  }

  async rotateRefreshToken(input: {
    currentRefreshTokenHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    expiresAt: Date;
    now: Date;
  }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM sessions
          WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        `
      )
      .get(input.currentRefreshTokenHash, toSqlDate(input.now)) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare(
        `
          UPDATE sessions
          SET access_token_hash = ?,
              refresh_token_hash = ?,
              expires_at = ?,
              updated_at = ?,
              rotated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.nextAccessTokenHash,
        input.nextRefreshTokenHash,
        toSqlDate(input.expiresAt),
        toSqlDate(input.now),
        toSqlDate(input.now),
        String(row.id)
      );

    const updated = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(String(row.id)) as
      | Record<string, unknown>
      | undefined;

    return updated ? mapSession(updated) : null;
  }

  async revokeSessionByAccessTokenHash(accessTokenHash: string, now: Date) {
    const result = this.db
      .prepare(
        `
          UPDATE sessions
          SET revoked_at = ?, updated_at = ?
          WHERE access_token_hash = ? AND revoked_at IS NULL
        `
      )
      .run(toSqlDate(now), toSqlDate(now), accessTokenHash);

    return Number(result.changes) > 0;
  }

  async revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date) {
    const result = this.db
      .prepare(
        `
          UPDATE sessions
          SET revoked_at = ?, updated_at = ?
          WHERE refresh_token_hash = ? AND revoked_at IS NULL
        `
      )
      .run(toSqlDate(now), toSqlDate(now), refreshTokenHash);

    return Number(result.changes) > 0;
  }

  async savePendingSessionExchange(exchange: PendingSessionExchange) {
    this.db
      .prepare(
        `
          INSERT INTO pending_session_exchanges (
            code_hash, user_id, user_agent, ip_address, expires_at, consumed_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        exchange.codeHash,
        exchange.userId,
        exchange.userAgent,
        exchange.ipAddress,
        toSqlDate(exchange.expiresAt),
        exchange.consumedAt ? toSqlDate(exchange.consumedAt) : null
      );
  }

  async consumePendingSessionExchange(codeHash: string, now: Date) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM pending_session_exchanges
          WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `
      )
      .get(codeHash, toSqlDate(now)) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare("UPDATE pending_session_exchanges SET consumed_at = ? WHERE code_hash = ?")
      .run(toSqlDate(now), codeHash);

    return mapPendingSessionExchange(row);
  }

  async createEntryKey(input: {
    keyHash: string;
    keyPrefix: string;
    label: string | null;
    createdByUserId: string;
    now: Date;
  }) {
    const id = randomToken(16);

    this.db
      .prepare(
        `
          INSERT INTO entry_keys (
            id, key_hash, key_prefix, label, created_by_user_id, created_at,
            consumed_by_user_id, consumed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.keyHash,
        input.keyPrefix,
        input.label,
        input.createdByUserId,
        toSqlDate(input.now),
        null,
        null
      );

    const entryKey = this.findEntryKeyById(id);

    if (!entryKey) {
      throw new Error("Created entry key could not be loaded");
    }

    return entryKey;
  }

  async listEntryKeys() {
    return this.db
      .prepare(
        `
          SELECT entry_keys.*, consumed_user.email AS consumed_by_user_email
          FROM entry_keys
          LEFT JOIN users AS consumed_user
            ON consumed_user.id = entry_keys.consumed_by_user_id
          ORDER BY entry_keys.created_at DESC
        `
      )
      .all()
      .map((row) => mapEntryKey(row as Record<string, unknown>));
  }

  async redeemEntryKey(input: { keyHash: string; userId: string; now: Date }) {
    this.db.exec("BEGIN IMMEDIATE;");

    try {
      const entryKey = this.db
        .prepare("SELECT * FROM entry_keys WHERE key_hash = ? AND consumed_at IS NULL")
        .get(input.keyHash) as Record<string, unknown> | undefined;
      const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(input.userId) as
        | Record<string, unknown>
        | undefined;

      if (!entryKey || !user) {
        this.db.exec("ROLLBACK;");
        return null;
      }

      const consumedAt = toSqlDate(input.now);
      const consumeResult = this.db
        .prepare(
          `
            UPDATE entry_keys
            SET consumed_by_user_id = ?, consumed_at = ?
            WHERE id = ? AND consumed_at IS NULL
          `
        )
        .run(input.userId, consumedAt, String(entryKey.id));

      if (Number(consumeResult.changes) === 0) {
        this.db.exec("ROLLBACK;");
        return null;
      }

      this.db
        .prepare(
          `
            UPDATE users
            SET entry_key_redeemed_at = COALESCE(entry_key_redeemed_at, ?),
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(consumedAt, consumedAt, input.userId);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return this.findUserById(input.userId);
  }

  private findEntryKeyById(id: string) {
    const row = this.db
      .prepare(
        `
          SELECT entry_keys.*, consumed_user.email AS consumed_by_user_email
          FROM entry_keys
          LEFT JOIN users AS consumed_user
            ON consumed_user.id = entry_keys.consumed_by_user_id
          WHERE entry_keys.id = ?
        `
      )
      .get(id) as Record<string, unknown> | undefined;

    return row ? mapEntryKey(row) : null;
  }
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: nullableString(row.display_name),
    avatarUrl: nullableString(row.avatar_url),
    entryKeyRedeemedAt: row.entry_key_redeemed_at ? fromSqlDate(row.entry_key_redeemed_at) : null,
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    accessTokenHash: String(row.access_token_hash),
    refreshTokenHash: String(row.refresh_token_hash),
    userAgent: nullableString(row.user_agent),
    ipAddress: nullableString(row.ip_address),
    expiresAt: fromSqlDate(row.expires_at),
    revokedAt: row.revoked_at ? fromSqlDate(row.revoked_at) : null,
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapPendingSessionExchange(row: Record<string, unknown>): PendingSessionExchange {
  return {
    codeHash: String(row.code_hash),
    userId: String(row.user_id),
    userAgent: nullableString(row.user_agent),
    ipAddress: nullableString(row.ip_address),
    expiresAt: fromSqlDate(row.expires_at),
    consumedAt: row.consumed_at ? fromSqlDate(row.consumed_at) : null
  };
}

function mapEntryKey(row: Record<string, unknown>): EntryKey {
  return {
    id: String(row.id),
    keyHash: String(row.key_hash),
    keyPrefix: String(row.key_prefix),
    label: nullableString(row.label),
    createdByUserId: nullableString(row.created_by_user_id),
    createdAt: fromSqlDate(row.created_at),
    consumedByUserId: nullableString(row.consumed_by_user_id),
    consumedByUserEmail: nullableString(row.consumed_by_user_email),
    consumedAt: row.consumed_at ? fromSqlDate(row.consumed_at) : null
  };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function toSqlDate(date: Date) {
  return date.toISOString();
}

function fromSqlDate(value: unknown) {
  return new Date(String(value));
}
