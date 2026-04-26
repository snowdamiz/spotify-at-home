import { randomToken } from "./crypto.js";

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
}
