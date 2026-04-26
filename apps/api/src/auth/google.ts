export interface GoogleIdentity {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GoogleOAuthClient {
  exchangeCodeForTokens(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ idToken: string }>;
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

interface GoogleTokenInfoResponse {
  iss?: string;
  aud?: string;
  exp?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
}

export function createGoogleOAuthClient(): GoogleOAuthClient {
  return {
    async exchangeCodeForTokens(input) {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          client_id: input.clientId,
          client_secret: input.clientSecret
        })
      });

      if (!response.ok) {
        throw new Error("Google token exchange failed");
      }

      const body = (await response.json()) as { id_token?: string };

      if (!body.id_token) {
        throw new Error("Google token response did not include an id_token");
      }

      return { idToken: body.id_token };
    },

    async verifyIdToken(idToken) {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );

      if (!response.ok) {
        throw new Error("Google id token verification failed");
      }

      const body = (await response.json()) as GoogleTokenInfoResponse;

      return {
        iss: body.iss ?? "",
        aud: body.aud ?? "",
        exp: Number(body.exp ?? 0),
        sub: body.sub ?? "",
        email: body.email ?? "",
        emailVerified: body.email_verified === "true",
        displayName: body.name ?? null,
        avatarUrl: body.picture ?? null
      };
    }
  };
}
