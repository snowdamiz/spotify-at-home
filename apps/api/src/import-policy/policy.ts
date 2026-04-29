import {
  type ExternalDiscoveryResult,
  type ImportEligibility,
  getImportPolicyModeCopy,
  parseImportPolicyMode,
  type ImportPolicyMode
} from "@broadside/shared";
import type { PublicUser } from "../auth/service.js";
import type { SourcePolicy } from "../db/repositories.js";

export interface ImportPolicyRuntimeConfig {
  environment: string;
  mode: ImportPolicyMode;
  openTestAllowedEnvironments: readonly string[];
  openTestAllowedUserEmails: readonly string[];
  openTestAllowedUserIds: readonly string[];
  adminUserEmails: readonly string[];
  adminUserIds: readonly string[];
  externalDiscoveryEnabled: boolean;
  externalImportEnabled: boolean;
  youtubeAdapterEnabled: boolean;
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
    environment: normalizeEnvironment(env.BROADSIDE_APP_ENV ?? env.NODE_ENV),
    mode: parseImportPolicyMode(env.BROADSIDE_IMPORT_POLICY_MODE),
    openTestAllowedEnvironments: splitEnvList(
      env.BROADSIDE_IMPORT_OPEN_TEST_ENVIRONMENTS,
      ["development", "local", "staging", "test"]
    ),
    openTestAllowedUserEmails: splitEnvList(env.BROADSIDE_IMPORT_OPEN_TEST_USER_EMAILS),
    openTestAllowedUserIds: splitEnvList(env.BROADSIDE_IMPORT_OPEN_TEST_USER_IDS),
    adminUserEmails: splitEnvList(env.BROADSIDE_ADMIN_USER_EMAILS),
    adminUserIds: splitEnvList(env.BROADSIDE_ADMIN_USER_IDS),
    externalDiscoveryEnabled: envFlag(env.BROADSIDE_EXTERNAL_DISCOVERY_ENABLED, true),
    externalImportEnabled: envFlag(env.BROADSIDE_EXTERNAL_IMPORT_ENABLED, true),
    youtubeAdapterEnabled: envFlag(env.BROADSIDE_YOUTUBE_ADAPTER_ENABLED, true)
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

export function evaluateExternalImportEligibility(input: {
  config: ImportPolicyRuntimeConfig;
  discovery: ExternalDiscoveryResult;
  sourcePolicies?: readonly SourcePolicy[];
  user: PublicUser;
}): ImportEligibility {
  if (!input.config.externalImportEnabled) {
    return {
      state: "blocked",
      reasonCode: "external_import_disabled",
      message: "External imports are currently disabled."
    };
  }

  if (!input.config.youtubeAdapterEnabled && input.discovery.provider === "youtube") {
    return {
      state: "blocked",
      reasonCode: "youtube_adapter_disabled",
      message: "YouTube imports are currently disabled."
    };
  }

  return {
    state: "importable",
    reasonCode: "external_import_allowed",
    message: "This source can be added to your library."
  };
}

export function assertExternalImportAllowed(input: {
  config: ImportPolicyRuntimeConfig;
  discovery: ExternalDiscoveryResult;
  sourcePolicies?: readonly SourcePolicy[];
  user: PublicUser;
}) {
  const eligibility = evaluateExternalImportEligibility(input);

  if (eligibility.state === "importable") {
    return eligibility;
  }

  throw new ImportPolicyError(eligibility.reasonCode, eligibility.message, 403);
}

export function isAdminUser(user: PublicUser, config: ImportPolicyRuntimeConfig) {
  return (
    listIncludes(config.adminUserIds, user.id) ||
    listIncludes(config.adminUserEmails, user.email.toLowerCase())
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

function envFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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
    adminUserEmails: config.adminUserEmails.map((value) => value.toLowerCase()),
    adminUserIds: config.adminUserIds.map((value) => value.toLowerCase()),
    externalDiscoveryEnabled: config.externalDiscoveryEnabled,
    externalImportEnabled: config.externalImportEnabled,
    openTestAllowedEnvironments: config.openTestAllowedEnvironments.map((value) =>
      value.toLowerCase()
    ),
    openTestAllowedUserEmails: config.openTestAllowedUserEmails.map((value) =>
      value.toLowerCase()
    ),
    openTestAllowedUserIds: config.openTestAllowedUserIds.map((value) => value.toLowerCase()),
    youtubeAdapterEnabled: config.youtubeAdapterEnabled
  };
}
