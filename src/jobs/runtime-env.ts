import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("job-runtime-env");

export const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

const UNSAFE_INJECTED_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const RESERVED_TASK_ENV_KEYS = new Set([
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

function isReservedTaskEnvKey(key: string): boolean {
  return key.startsWith("TENANT_") || RESERVED_TASK_ENV_KEYS.has(key);
}

function filterSafeWorkflowEnv(
  env: Record<string, unknown> | undefined,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (
      UNSAFE_INJECTED_ENV_KEYS.has(key) ||
      isReservedTaskEnvKey(key) ||
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
  const rawInjectedEnv = allEnv[INJECTED_TASK_ENV_JSON];
  if (!rawInjectedEnv) {
    return {};
  }

  try {
    const parsedInjectedEnv = JSON.parse(rawInjectedEnv);
    if (
      !parsedInjectedEnv ||
      typeof parsedInjectedEnv !== "object" ||
      Array.isArray(parsedInjectedEnv)
    ) {
      return {};
    }

    return filterSafeWorkflowEnv(parsedInjectedEnv as Record<string, unknown>);
  } catch {
    logger.warn(`Ignoring invalid ${INJECTED_TASK_ENV_JSON}`);
    return {};
  }
}

export function buildTaskContextEnv(
  allEnv: Record<string, string>,
  envAllowlist?: string[],
): Record<string, string> {
  const allowedEnvKeys = envAllowlist ? new Set(envAllowlist) : null;
  const taskContextEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(allEnv)) {
    if (isReservedTaskEnvKey(key)) {
      continue;
    }
    if (allowedEnvKeys && !allowedEnvKeys.has(key)) {
      continue;
    }
    taskContextEnv[key] = value;
  }

  for (const [key, value] of Object.entries(readInjectedProjectEnv(allEnv))) {
    if (allowedEnvKeys && !allowedEnvKeys.has(key)) {
      continue;
    }
    taskContextEnv[key] = value;
  }

  return taskContextEnv;
}

export function mergeInjectedWorkflowEnv(
  existingEnv: Record<string, string> | undefined,
  allEnv: Record<string, string>,
): Record<string, string> | undefined {
  const mergedEnv = {
    ...filterSafeWorkflowEnv(existingEnv),
    ...readInjectedProjectEnv(allEnv),
  };

  return Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined;
}
