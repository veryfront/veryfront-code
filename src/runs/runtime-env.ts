import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

export const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";
/** Maximum UTF-8 size accepted for the platform-injected project environment. */
export const MAX_INJECTED_TASK_ENV_JSON_BYTES = DEFAULT_MAX_BODY_SIZE_BYTES;

const UNSAFE_INJECTED_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RESERVED_TASK_ENV_KEYS = new Set(["RUN_EXECUTION_ID", "WORKFLOW_RUN_ID"]);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_INJECTED_TASK_ENV_ENTRIES = 4_096;
const utf8Encoder = new TextEncoder();

function isReservedTaskEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return normalized.startsWith("VERYFRONT_") ||
    normalized.startsWith("TENANT_") ||
    RESERVED_TASK_ENV_KEYS.has(normalized);
}

function isSafeEnvEntry(key: string, value: unknown): value is string {
  return (
    !UNSAFE_INJECTED_ENV_KEYS.has(key) &&
    !isReservedTaskEnvKey(key) &&
    ENV_NAME_PATTERN.test(key) &&
    typeof value === "string" &&
    !value.includes("\0")
  );
}

function filterSafeWorkflowEnv(
  env: Record<string, unknown> | undefined,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!isSafeEnvEntry(key, value)) continue;
    filtered[key] = value;
  }
  return filtered;
}

function parseInjectedProjectEnv(raw: string): Record<string, unknown> {
  if (
    raw.length > MAX_INJECTED_TASK_ENV_JSON_BYTES ||
    utf8Encoder.encode(raw).byteLength > MAX_INJECTED_TASK_ENV_JSON_BYTES
  ) {
    throw new RangeError(
      `${INJECTED_TASK_ENV_JSON} exceeds ${MAX_INJECTED_TASK_ENV_JSON_BYTES} UTF-8 bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain valid JSON`, { cause });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function readInjectedProjectEnv(
  allEnv: Record<string, string>,
): Record<string, string> {
  const rawInjectedEnv = allEnv[INJECTED_TASK_ENV_JSON];
  if (rawInjectedEnv === undefined) return {};

  const entries = Object.entries(parseInjectedProjectEnv(rawInjectedEnv));
  if (entries.length > MAX_INJECTED_TASK_ENV_ENTRIES) {
    throw new RangeError(
      `${INJECTED_TASK_ENV_JSON} contains more than ${MAX_INJECTED_TASK_ENV_ENTRIES} entries`,
    );
  }

  const injectedEnv: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (UNSAFE_INJECTED_ENV_KEYS.has(key) || isReservedTaskEnvKey(key)) {
      continue;
    }
    if (!ENV_NAME_PATTERN.test(key)) {
      throw new TypeError(
        `${INJECTED_TASK_ENV_JSON} key ${JSON.stringify(key)} is not a portable environment name`,
      );
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw new TypeError(
        `${INJECTED_TASK_ENV_JSON} value for ${JSON.stringify(key)} must be a NUL-free string`,
      );
    }
    injectedEnv[key] = value;
  }
  return injectedEnv;
}

export function buildTaskContextEnv(
  allEnv: Record<string, string>,
  envAllowlist?: string[],
): Record<string, string> {
  const allowedEnvKeys = envAllowlist ? new Set(envAllowlist) : null;
  const taskContextEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(allEnv)) {
    if (!isSafeEnvEntry(key, value)) continue;
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
