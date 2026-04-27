import {
  type ExternalDiscoveryResult,
  type ImportEligibility,
  getImportPolicyModeCopy,
  parseImportPolicyMode,
  type ImportPolicyMode
} from "@tunely/shared";
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
    environment: normalizeEnvironment(env.TUNELY_APP_ENV ?? env.NODE_ENV),
    mode: parseImportPolicyMode(env.TUNELY_IMPORT_POLICY_MODE),
    openTestAllowedEnvironments: splitEnvList(
      env.TUNELY_IMPORT_OPEN_TEST_ENVIRONMENTS,
      ["development", "local", "staging", "test"]
    ),
    openTestAllowedUserEmails: splitEnvList(env.TUNELY_IMPORT_OPEN_TEST_USER_EMAILS),
    openTestAllowedUserIds: splitEnvList(env.TUNELY_IMPORT_OPEN_TEST_USER_IDS),
    adminUserEmails: splitEnvList(env.TUNELY_ADMIN_USER_EMAILS),
    adminUserIds: splitEnvList(env.TUNELY_ADMIN_USER_IDS),
    externalDiscoveryEnabled: envFlag(env.TUNELY_EXTERNAL_DISCOVERY_ENABLED, true),
    externalImportEnabled: envFlag(env.TUNELY_EXTERNAL_IMPORT_ENABLED, true),
    youtubeAdapterEnabled: envFlag(env.TUNELY_YOUTUBE_ADAPTER_ENABLED, true)
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
  const policyMatch = matchSourcePolicy(input.discovery, input.sourcePolicies ?? []);

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

  if (policyMatch?.action === "block") {
    return {
      state: "blocked",
      reasonCode: "source_policy_blocked",
      message: policyMatch.reason ?? "This source has been blocked by Tunely policy."
    };
  }

  if (canUseOpenTestImports(input.user, input.config)) {
    return {
      state: "importable",
      reasonCode: "open_test_allowed",
      message: "Open test mode allows this source for private product validation."
    };
  }

  if (policyMatch?.action === "allow") {
    return {
      state: "importable",
      reasonCode: "source_policy_allowed",
      message: policyMatch.reason ?? "This source is allowed by Tunely policy."
    };
  }

  if (policyMatch?.action === "review") {
    return {
      state: "review_required",
      reasonCode: "source_policy_review_required",
      message: policyMatch.reason ?? "This source needs review before import."
    };
  }

  if (input.config.mode === "review_required") {
    return {
      state: "review_required",
      reasonCode: "launch_review_required",
      message: "This source requires review before it can be imported."
    };
  }

  return {
    state: "preview_only",
    reasonCode: "licensed_source_required",
    message: "Preview is available, but import requires an approved or licensed source."
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

function matchSourcePolicy(
  discovery: ExternalDiscoveryResult,
  policies: readonly SourcePolicy[]
) {
  const sourceId = discovery.sourceId.toLowerCase();
  const provider = discovery.provider.toLowerCase();
  const host = hostnameForUrl(discovery.canonicalUrl);

  return (
    policies.find(
      (policy) =>
        policy.provider === discovery.provider &&
        policy.scopeType === "source" &&
        policy.scopeValue === sourceId
    ) ??
    policies.find(
      (policy) =>
        policy.provider === discovery.provider &&
        policy.scopeType === "domain" &&
        policy.scopeValue === host
    ) ??
    policies.find(
      (policy) =>
        policy.provider === discovery.provider &&
        policy.scopeType === "provider" &&
        policy.scopeValue === provider
    )
  );
}

function hostnameForUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
