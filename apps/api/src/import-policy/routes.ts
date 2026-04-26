import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService } from "../auth/service.js";
import { readAccessToken } from "../auth/routes.js";
import {
  readImportPolicyRuntimeConfig,
  resolveImportPolicyStatus,
  type ImportPolicyRuntimeConfig
} from "./policy.js";

export interface ImportPolicyRoutesOptions {
  authService: AuthService;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
}

export function registerImportPolicyRoutes(
  app: FastifyInstance,
  options: ImportPolicyRoutesOptions
) {
  const config = options.importPolicyConfig ?? readImportPolicyRuntimeConfig();

  app.get("/api/import-policy", async (request) => {
    const user = await optionalAuthenticate(options.authService, readAccessToken(request));

    return {
      importPolicy: resolveImportPolicyStatus(user, config)
    };
  });
}

async function optionalAuthenticate(authService: AuthService, accessToken: string | null) {
  try {
    return await authService.getUserForAccessToken(accessToken);
  } catch (error) {
    if (error instanceof AuthError && error.statusCode === 401) {
      return null;
    }

    throw error;
  }
}
