import {
  getImportPolicyModeCopy,
  parseImportPolicyMode,
  type ImportPolicyMode
} from "@tunely/shared";
import type { PublicUser } from "../auth/service.js";

export interface ImportPolicyRuntimeConfig {
  environment: string;
  mode: ImportPolicyMode;
  openTestAllowedEnvironments: readonly string[];
  openTestAllowedUserEmails: readonly string[];
  openTestAllowedUserIds: readonly string[];
}

export interface ImportPolicyStatus {
  configuredMode: ImportPolicyMode;
  copy: ReturnType<typeof getImportPolicyModeCopy>;
  environment: string;
  mode: ImportPolicyMode;
  openTestAllowed: boolean;
}

export class ImportPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export function readImportPolicyRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ImportPolicyRuntimeConfig {
  return normalizeImportPolicyRuntimeConfig({
    environment: normalizeEnvironment(env.TUNELY_APP_ENV ?? env.NODE_ENV),
    mode: parseImportPolicyMode(env.TUNELY_IMPORT_POLICY_MODE),
    openTestAllowedEnvironments: splitEnvList(
      env.TUNELY_IMPORT_OPEN_TEST_ENVIRONMENTS,
      ["development", "local", "staging", "test"]
    ),
    openTestAllowedUserEmails: splitEnvList(env.TUNELY_IMPORT_OPEN_TEST_USER_EMAILS),
    openTestAllowedUserIds: splitEnvList(env.TUNELY_IMPORT_OPEN_TEST_USER_IDS)
  });
}

export function createImportPolicyRuntimeConfig(
  overrides: Partial<ImportPolicyRuntimeConfig> = {},
  env: NodeJS.ProcessEnv = process.env
): ImportPolicyRuntimeConfig {
  return normalizeImportPolicyRuntimeConfig({
    ...readImportPolicyRuntimeConfig(env),
    ...overrides
  });
}

export function resolveImportPolicyStatus(
  user: PublicUser | null,
  config: ImportPolicyRuntimeConfig
): ImportPolicyStatus {
  const openTestAllowed = canUseOpenTestImports(user, config);
  const mode = config.mode === "open_test" && !openTestAllowed ? "review_required" : config.mode;

  return {
    configuredMode: config.mode,
    copy: getImportPolicyModeCopy(mode),
    environment: config.environment,
    mode,
    openTestAllowed
  };
}

export function assertImportPolicyAllowsRequestedMode(input: {
  config: ImportPolicyRuntimeConfig;
  requestedMode: ImportPolicyMode;
  user: PublicUser;
}) {
  if (input.requestedMode !== "open_test") {
    return;
  }

  if (canUseOpenTestImports(input.user, input.config)) {
    return;
  }

  throw new ImportPolicyError(
    "open_test_import_not_allowed",
    "Open test imports require an allowlisted user and a non-production test environment.",
    403
  );
}

export function canUseOpenTestImports(
  user: PublicUser | null,
  config: ImportPolicyRuntimeConfig
) {
  if (config.mode !== "open_test" || !user) {
    return false;
  }

  return environmentAllowsOpenTest(config) && userAllowsOpenTest(user, config);
}

function environmentAllowsOpenTest(config: ImportPolicyRuntimeConfig) {
  if (isProductionEnvironment(config.environment)) {
    return false;
  }

  return listIncludes(config.openTestAllowedEnvironments, config.environment);
}

function userAllowsOpenTest(user: PublicUser, config: ImportPolicyRuntimeConfig) {
  return (
    listIncludes(config.openTestAllowedUserIds, user.id) ||
    listIncludes(config.openTestAllowedUserEmails, user.email.toLowerCase())
  );
}

function normalizeEnvironment(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "production";
}

function isProductionEnvironment(environment: string) {
  return environment === "production" || environment === "prod";
}

function splitEnvList(value: string | undefined, fallback: string[] = []) {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function listIncludes(list: readonly string[], value: string) {
  return list.includes("*") || list.includes(value.toLowerCase());
}

function normalizeImportPolicyRuntimeConfig(
  config: ImportPolicyRuntimeConfig
): ImportPolicyRuntimeConfig {
  return {
    environment: normalizeEnvironment(config.environment),
    mode: config.mode,
    openTestAllowedEnvironments: config.openTestAllowedEnvironments.map((value) =>
      value.toLowerCase()
    ),
    openTestAllowedUserEmails: config.openTestAllowedUserEmails.map((value) =>
      value.toLowerCase()
    ),
    openTestAllowedUserIds: config.openTestAllowedUserIds.map((value) => value.toLowerCase())
  };
}
