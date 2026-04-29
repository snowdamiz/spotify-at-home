import { randomEntryKey, randomToken, sha256Base64Url, sha256Hex } from "./crypto.js";
import { createGoogleOAuthClient } from "./google.js";
import type { GoogleIdentity, GoogleOAuthClient } from "./google.js";
import { InMemoryAuthRepository, InMemoryOAuthStateStore } from "./repositories.js";
import type { AuthRepository, EntryKey, OAuthStateStore, User } from "./repositories.js";

const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const allowedGoogleIssuers = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface AuthServiceOptions {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleOAuthClient?: GoogleOAuthClient;
  authRepository?: AuthRepository;
  stateStore?: OAuthStateStore;
  adminEmail?: string;
  adminEmails?: readonly string[];
  now?: () => Date;
  stateTtlSeconds?: number;
  sessionExchangeTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  entryKeyRedeemedAt: string | null;
  hasEntryAccess: boolean;
  isAdmin: boolean;
}

export interface PublicEntryKey {
  id: string;
  keyPrefix: string;
  label: string | null;
  createdByUserId: string | null;
  createdAt: string;
  consumedByUserId: string | null;
  consumedByUserEmail: string | null;
  consumedAt: string | null;
}

export interface AuthStartResult {
  redirectUrl: string;
}

export interface AuthCallbackResult {
  mode: "web" | "mobile";
  returnTo: string;
  session?: IssuedSession;
  exchangeCode?: string;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export class AuthService {
  private readonly googleOAuthClient: GoogleOAuthClient;
  private readonly authRepository: AuthRepository;
  private readonly stateStore: OAuthStateStore;
  private readonly now: () => Date;
  private readonly stateTtlSeconds: number;
  private readonly sessionExchangeTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly adminEmails: Set<string>;

  constructor(private readonly options: AuthServiceOptions) {
    this.googleOAuthClient = options.googleOAuthClient ?? createGoogleOAuthClient();
    this.authRepository = options.authRepository ?? new InMemoryAuthRepository();
    this.stateStore = options.stateStore ?? new InMemoryOAuthStateStore();
    this.now = options.now ?? (() => new Date());
    this.stateTtlSeconds = options.stateTtlSeconds ?? 10 * 60;
    this.sessionExchangeTtlSeconds = options.sessionExchangeTtlSeconds ?? 2 * 60;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60;
    this.adminEmails = new Set(
      normalizeEmailList([...(options.adminEmails ?? []), options.adminEmail ?? ""])
    );
  }

  async startGoogleAuth(input: { mode: "web" | "mobile"; returnTo: string }): Promise<AuthStartResult> {
    const state = randomToken();
    const codeVerifier = randomToken(48);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const now = this.now();

    await this.stateStore.save({
      state,
      codeVerifier,
      mode: input.mode,
      returnTo: input.returnTo,
      expiresAt: addSeconds(now, this.stateTtlSeconds)
    });

    const redirectUrl = new URL(googleAuthorizationEndpoint);
    redirectUrl.searchParams.set("client_id", this.options.googleClientId);
    redirectUrl.searchParams.set("redirect_uri", this.options.googleRedirectUri);
    redirectUrl.searchParams.set("response_type", "code");
    redirectUrl.searchParams.set("scope", "openid email profile");
    redirectUrl.searchParams.set("state", state);
    redirectUrl.searchParams.set("code_challenge", codeChallenge);
    redirectUrl.searchParams.set("code_challenge_method", "S256");
    redirectUrl.searchParams.set("access_type", "offline");
    redirectUrl.searchParams.set("prompt", "consent");

    return { redirectUrl: redirectUrl.toString() };
  }

  async completeGoogleCallback(input: {
    code: string | undefined;
    state: string | undefined;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<AuthCallbackResult> {
    if (!input.code || !input.state) {
      throw new AuthError(
        "invalid_oauth_state",
        "OAuth state is missing, expired, or already used.",
        400
      );
    }

    const oauthState = await this.stateStore.consume(input.state, this.now());

    if (!oauthState) {
      throw new AuthError(
        "invalid_oauth_state",
        "OAuth state is missing, expired, or already used.",
        400
      );
    }

    const tokenResponse = await this.googleOAuthClient.exchangeCodeForTokens({
      code: input.code,
      codeVerifier: oauthState.codeVerifier,
      redirectUri: this.options.googleRedirectUri,
      clientId: this.options.googleClientId,
      clientSecret: this.options.googleClientSecret
    });
    const identity = await this.googleOAuthClient.verifyIdToken(tokenResponse.idToken);
    this.assertValidGoogleIdentity(identity);

    const now = this.now();
    const user = await this.authRepository.upsertUserFromGoogle({
      providerSubject: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      now
    });

    if (oauthState.mode === "mobile") {
      const exchangeCode = randomToken();
      await this.authRepository.savePendingSessionExchange({
        codeHash: sha256Hex(exchangeCode),
        userId: user.id,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt: addSeconds(now, this.sessionExchangeTtlSeconds),
        consumedAt: null
      });

      return {
        mode: "mobile",
        returnTo: appendQuery(oauthState.returnTo, "session_exchange_code", exchangeCode),
        exchangeCode
      };
    }

    const session = await this.issueSession({
      user,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress
    });

    return {
      mode: "web",
      returnTo: oauthState.returnTo,
      session
    };
  }

  async exchangeSessionCode(input: { code: string; userAgent: string | null; ipAddress: string | null }) {
    const exchange = await this.authRepository.consumePendingSessionExchange(
      sha256Hex(input.code),
      this.now()
    );

    if (!exchange) {
      throw new AuthError(
        "invalid_exchange_code",
        "Session exchange code is invalid or expired.",
        401
      );
    }

    const user = await this.authRepository.findUserById(exchange.userId);

    if (!user) {
      throw new AuthError("invalid_exchange_code", "Session exchange code is invalid or expired.", 401);
    }

    return this.issueSession({
      user,
      userAgent: input.userAgent ?? exchange.userAgent,
      ipAddress: input.ipAddress ?? exchange.ipAddress
    });
  }

  async refreshSession(refreshToken: string) {
    const now = this.now();
    const accessToken = randomToken();
    const nextRefreshToken = randomToken();
    const session = await this.authRepository.rotateRefreshToken({
      currentRefreshTokenHash: sha256Hex(refreshToken),
      nextAccessTokenHash: sha256Hex(accessToken),
      nextRefreshTokenHash: sha256Hex(nextRefreshToken),
      expiresAt: addSeconds(now, this.refreshTokenTtlSeconds),
      now
    });

    if (!session) {
      throw new AuthError(
        "invalid_refresh_token",
        "Refresh token is invalid, expired, revoked, or reused.",
        401
      );
    }

    const user = await this.authRepository.findUserById(session.userId);

    if (!user) {
      throw new AuthError(
        "invalid_refresh_token",
        "Refresh token is invalid, expired, revoked, or reused.",
        401
      );
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user: this.toPublicUser(user)
    };
  }

  async getUserForAccessToken(
    accessToken: string | null,
    options: { requireEntryKeyAccess?: boolean } = {}
  ) {
    if (!accessToken) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    const session = await this.authRepository.findSessionByAccessTokenHash(
      sha256Hex(accessToken),
      this.now()
    );

    if (!session) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    const user = await this.authRepository.findUserById(session.userId);

    if (!user) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    if (options.requireEntryKeyAccess !== false && !this.hasEntryAccess(user)) {
      throw new AuthError(
        "entry_key_required",
        "An entry key is required before this account can use OnVibe.",
        403
      );
    }

    return this.toPublicUser(user);
  }

  async logout(input: { accessToken: string | null; refreshToken: string | null }) {
    const now = this.now();

    if (input.accessToken) {
      await this.authRepository.revokeSessionByAccessTokenHash(sha256Hex(input.accessToken), now);
      return;
    }

    if (input.refreshToken) {
      await this.authRepository.revokeSessionByRefreshTokenHash(sha256Hex(input.refreshToken), now);
    }
  }

  async listEntryKeysForAccessToken(accessToken: string | null) {
    await this.getAdminUserForAccessToken(accessToken);

    return (await this.authRepository.listEntryKeys()).map(toPublicEntryKey);
  }

  async createEntryKey(input: { accessToken: string | null; label: string | null }) {
    const admin = await this.getAdminUserForAccessToken(input.accessToken);
    const secret = createEntryKeySecret();
    const now = this.now();
    const entryKey = await this.authRepository.createEntryKey({
      keyHash: sha256Hex(normalizeEntryKey(secret)),
      keyPrefix: entryKeyPrefix(secret),
      label: normalizeLabel(input.label),
      createdByUserId: admin.id,
      now
    });

    return {
      entryKey: toPublicEntryKey(entryKey),
      secret
    };
  }

  async redeemEntryKey(input: { accessToken: string | null; key: string }) {
    const user = await this.getRawUserForAccessToken(input.accessToken);

    if (this.hasEntryAccess(user)) {
      return this.toPublicUser(user);
    }

    const normalizedKey = normalizeEntryKey(input.key);

    if (!normalizedKey) {
      throw invalidEntryKeyError();
    }

    const updatedUser = await this.authRepository.redeemEntryKey({
      keyHash: sha256Hex(normalizedKey),
      userId: user.id,
      now: this.now()
    });

    if (!updatedUser) {
      throw invalidEntryKeyError();
    }

    return this.toPublicUser(updatedUser);
  }

  private async issueSession(input: { user: User; userAgent: string | null; ipAddress: string | null }) {
    const now = this.now();
    const accessToken = randomToken();
    const refreshToken = randomToken();

    await this.authRepository.createSession({
      userId: input.user.id,
      accessTokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(refreshToken),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: addSeconds(now, this.refreshTokenTtlSeconds),
      now
    });

    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(input.user)
    };
  }

  private async getAdminUserForAccessToken(accessToken: string | null) {
    const user = await this.getRawUserForAccessToken(accessToken);

    if (!this.isAdminUser(user)) {
      throw new AuthError("admin_required", "Admin access is required.", 403);
    }

    return this.toPublicUser(user);
  }

  private async getRawUserForAccessToken(accessToken: string | null) {
    if (!accessToken) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    const session = await this.authRepository.findSessionByAccessTokenHash(
      sha256Hex(accessToken),
      this.now()
    );

    if (!session) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    const user = await this.authRepository.findUserById(session.userId);

    if (!user) {
      throw new AuthError("unauthorized", "A valid session is required.", 401);
    }

    return user;
  }

  private hasEntryAccess(user: User) {
    return this.isAdminUser(user) || user.entryKeyRedeemedAt !== null;
  }

  private isAdminUser(user: Pick<User, "email">) {
    return this.adminEmails.has(user.email.trim().toLowerCase());
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      entryKeyRedeemedAt: user.entryKeyRedeemedAt?.toISOString() ?? null,
      hasEntryAccess: this.hasEntryAccess(user),
      isAdmin: this.isAdminUser(user)
    };
  }

  private assertValidGoogleIdentity(identity: GoogleIdentity) {
    if (
      !allowedGoogleIssuers.has(identity.iss) ||
      identity.aud !== this.options.googleClientId ||
      identity.exp <= Math.floor(this.now().getTime() / 1000) ||
      !identity.sub ||
      !identity.email ||
      !identity.emailVerified
    ) {
      throw new AuthError("invalid_google_identity", "Google identity token was rejected.", 401);
    }
  }
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function appendQuery(url: string, key: string, value: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function toPublicEntryKey(entryKey: EntryKey): PublicEntryKey {
  return {
    id: entryKey.id,
    keyPrefix: entryKey.keyPrefix,
    label: entryKey.label,
    createdByUserId: entryKey.createdByUserId,
    createdAt: entryKey.createdAt.toISOString(),
    consumedByUserId: entryKey.consumedByUserId,
    consumedByUserEmail: entryKey.consumedByUserEmail,
    consumedAt: entryKey.consumedAt?.toISOString() ?? null
  };
}

function createEntryKeySecret() {
  return randomEntryKey();
}

function entryKeyPrefix(secret: string) {
  return secret;
}

function normalizeEntryKey(value: string) {
  return value.trim().toUpperCase();
}

function normalizeLabel(value: string | null) {
  const label = value?.trim();

  if (!label) {
    return null;
  }

  return label.slice(0, 120);
}

function normalizeEmailList(values: readonly string[]) {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function invalidEntryKeyError() {
  return new AuthError(
    "invalid_entry_key",
    "Entry key is invalid or has already been used.",
    400
  );
}
