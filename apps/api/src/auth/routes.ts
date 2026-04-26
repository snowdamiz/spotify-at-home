import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, AuthService } from "./service.js";
import type { AuthServiceOptions, IssuedSession } from "./service.js";

export type AuthRoutesOptions = AuthServiceOptions & {
  cookieSecure?: boolean;
  allowedReturnToOrigins?: string[];
};

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions) {
  const authService = new AuthService(options);
  const cookieSecure = options.cookieSecure ?? process.env.NODE_ENV === "production";

  app.get("/api/auth/google/start", async (request, reply) => {
    const query = asRecord(request.query);
    const mode = query.mode === "mobile" ? "mobile" : "web";
    const returnTo = normalizeReturnTo(
      typeof query.returnTo === "string" ? query.returnTo : undefined,
      mode,
      options.allowedReturnToOrigins ?? []
    );
    const result = await authService.startGoogleAuth({ mode, returnTo });

    return reply.redirect(result.redirectUrl);
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const query = asRecord(request.query);

    try {
      const result = await authService.completeGoogleCallback({
        code: typeof query.code === "string" ? query.code : undefined,
        state: typeof query.state === "string" ? query.state : undefined,
        userAgent: headerValue(request.headers["user-agent"]),
        ipAddress: request.ip
      });

      if (result.mode === "web" && result.session) {
        setSessionCookies(reply, result.session, cookieSecure);
      }

      return reply.redirect(result.returnTo);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/api/auth/session/exchange", async (request, reply) => {
    const body = asRecord(request.body);

    try {
      const result = await authService.exchangeSessionCode({
        code: typeof body.code === "string" ? body.code : "",
        userAgent: headerValue(request.headers["user-agent"]),
        ipAddress: request.ip
      });

      return result;
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const body = asRecord(request.body);
    const refreshToken =
      typeof body.refreshToken === "string" ? body.refreshToken : readCookie(request, "tunely_refresh");

    try {
      const result = await authService.refreshSession(refreshToken ?? "");
      setSessionCookies(reply, result, cookieSecure);
      return result;
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await authService.logout({
      accessToken: readAccessToken(request),
      refreshToken: readCookie(request, "tunely_refresh")
    });
    clearSessionCookies(reply, cookieSecure);
    return reply.code(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    try {
      const user = await authService.getUserForAccessToken(readAccessToken(request));
      return { user };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
}

function setSessionCookies(reply: FastifyReply, session: IssuedSession, secure: boolean) {
  reply.header("set-cookie", [
    serializeCookie("tunely_access", session.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 15
    }),
    serializeCookie("tunely_refresh", session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 60 * 60 * 24 * 30
    })
  ]);
}

function clearSessionCookies(reply: FastifyReply, secure: boolean) {
  reply.header("set-cookie", [
    serializeCookie("tunely_access", "", {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 0
    }),
    serializeCookie("tunely_refresh", "", {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 0
    })
  ]);
}

function readAccessToken(request: FastifyRequest) {
  const authorization = headerValue(request.headers.authorization);

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return readCookie(request, "tunely_access");
}

function readCookie(request: FastifyRequest, name: string) {
  const cookieHeader = headerValue(request.headers.cookie);

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");

    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict" | "None";
    path: string;
    maxAge: number;
  }
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message
    });
  }

  throw error;
}

function normalizeReturnTo(
  returnTo: string | undefined,
  mode: "web" | "mobile",
  allowedOrigins: string[]
) {
  const fallback = mode === "mobile" ? "tunely://auth/callback" : "/";

  if (!returnTo) {
    return fallback;
  }

  if (mode === "mobile") {
    return returnTo.startsWith("tunely://") ? returnTo : fallback;
  }

  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }

  try {
    const url = new URL(returnTo);
    return allowedOrigins.includes(url.origin) ? returnTo : fallback;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? null;
}
