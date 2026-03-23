import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("job-runtime-env");

export const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

const UNSAFE_INJECTED_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const HIDDEN_TASK_CONTEXT_ENV_KEYS = new Set([
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_PROJECT_API_URL",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_PROJECT_ID",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_BRANCH_REF",
  "VERYFRONT_API_USER",
  "VERYFRONT_API_PASS",
  "VERYFRONT_JOB_RESULT_PATH",
  INJECTED_TASK_ENV_JSON,
]);

const DISALLOWED_INJECTED_ENV_KEYS = new Set([
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_PROJECT_API_URL",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_PROJECT_ID",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_BRANCH_REF",
  "VERYFRONT_API_USER",
  "VERYFRONT_API_PASS",
  "VERYFRONT_JOB_RESULT_PATH",
  INJECTED_TASK_ENV_JSON,
]);

function isHiddenTaskContextEnvKey(key: string): boolean {
  return key.startsWith("TENANT_") || HIDDEN_TASK_CONTEXT_ENV_KEYS.has(key);
}

function isDisallowedInjectedEnvKey(key: string): boolean {
  return key.startsWith("TENANT_") || DISALLOWED_INJECTED_ENV_KEYS.has(key);
}

function filterExistingProjectEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (
      UNSAFE_INJECTED_ENV_KEYS.has(key) ||
      isDisallowedInjectedEnvKey(key) ||
      typeof value !== "string"
    ) {
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}

export function readInjectedProjectEnv(
  allEnv: Record<string, string>,
): Record<string, string> {
  const raw = allEnv[INJECTED_TASK_ENV_JSON];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const injectedEnv = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (
        UNSAFE_INJECTED_ENV_KEYS.has(key) ||
        isDisallowedInjectedEnvKey(key) ||
        typeof value !== "string"
      ) {
        continue;
      }
      injectedEnv[key] = value;
    }

    return injectedEnv;
  } catch {
    logger.warn(`Ignoring invalid ${INJECTED_TASK_ENV_JSON}`);
    return {};
  }
}

export function buildTaskContextEnv(
  allEnv: Record<string, string>,
  envAllowlist?: string[],
): Record<string, string> {
  const allowlistedEnvKeys = envAllowlist ? new Set(envAllowlist) : null;
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(allEnv)) {
    if (isHiddenTaskContextEnvKey(key)) {
      continue;
    }
    if (allowlistedEnvKeys && !allowlistedEnvKeys.has(key)) {
      continue;
    }
    env[key] = value;
  }

  for (const [key, value] of Object.entries(readInjectedProjectEnv(allEnv))) {
    if (allowlistedEnvKeys && !allowlistedEnvKeys.has(key)) {
      continue;
    }
    env[key] = value;
  }

  return env;
}

export function mergeInjectedWorkflowEnv(
  existingEnv: Record<string, string> | undefined,
  allEnv: Record<string, string>,
): Record<string, string> | undefined {
  const mergedEnv = {
    ...filterExistingProjectEnv(existingEnv),
    ...readInjectedProjectEnv(allEnv),
  };

  return Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined;
}
