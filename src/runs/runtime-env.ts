import { CONFIG_INVALID } from "#veryfront/errors";

export const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

const MAX_INJECTED_ENV_JSON_LENGTH = 1_048_576;
const MAX_ENV_ENTRIES = 10_000;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 1_048_576;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_INJECTED_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function invalidEnvironment(detail: string): Error {
  return CONFIG_INVALID.create({ detail });
}

function isReservedTaskEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return normalized.startsWith("TENANT_") || normalized.startsWith("VERYFRONT_");
}

function isValidEnvironmentName(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= MAX_ENV_KEY_LENGTH &&
    ENV_KEY_PATTERN.test(key) && !UNSAFE_INJECTED_ENV_KEYS.has(key);
}

function validateEnvironmentName(key: unknown): string {
  if (!isValidEnvironmentName(key)) {
    throw invalidEnvironment("Task environment contains an invalid environment variable name");
  }
  return key;
}

function validateEnvironmentValue(value: unknown, source: "injected" | "runtime"): string {
  if (typeof value !== "string") {
    throw invalidEnvironment(
      source === "injected"
        ? `Values in ${INJECTED_TASK_ENV_JSON} must be strings`
        : "Task environment values must be strings",
    );
  }
  if (value.length > MAX_ENV_VALUE_LENGTH || value.includes("\0")) {
    throw invalidEnvironment("Task environment contains an invalid or oversized value");
  }
  return value;
}

function ownEntries(value: Record<string, unknown>, label: string): [string, unknown][] {
  if (!value || typeof value !== "object") {
    throw invalidEnvironment(`${label} could not be read`);
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (_) {
    throw invalidEnvironment(`${label} could not be read`);
  }
  if (keys.length > MAX_ENV_ENTRIES) {
    throw invalidEnvironment(`${label} exceeds the supported entry count`);
  }

  const entries: [string, unknown][] = [];
  for (const key of keys) {
    if (typeof key !== "string") continue;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_) {
      throw invalidEnvironment(`${label} could not be read`);
    }
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor)) {
      throw invalidEnvironment(`${label} must contain only enumerable data properties`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function filterSafeWorkflowEnv(
  env: Record<string, unknown> | undefined,
  source: "injected" | "runtime" = "runtime",
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [rawKey, rawValue] of ownEntries(env ?? {}, "Task environment")) {
    if (UNSAFE_INJECTED_ENV_KEYS.has(rawKey) || isReservedTaskEnvKey(rawKey)) continue;
    if (!isValidEnvironmentName(rawKey)) {
      if (source === "injected") validateEnvironmentName(rawKey);
      continue;
    }
    const key = validateEnvironmentName(rawKey);
    const value = validateEnvironmentValue(rawValue, source);
    Object.defineProperty(filtered, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return filtered;
}

function parseInjectedEnvironment(raw: string): Record<string, unknown> {
  if (raw.length > MAX_INJECTED_ENV_JSON_LENGTH) {
    throw invalidEnvironment(
      `${INJECTED_TASK_ENV_JSON} exceeds the ${MAX_INJECTED_ENV_JSON_LENGTH}-character limit`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw invalidEnvironment(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidEnvironment(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Read and validate project environment values injected by the runtime. */
export function readInjectedProjectEnv(
  allEnv: Record<string, string>,
): Record<string, string> {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(allEnv, INJECTED_TASK_ENV_JSON);
  } catch (_) {
    throw invalidEnvironment("Task environment could not be read");
  }
  if (!descriptor) return {};
  if (!("value" in descriptor)) {
    throw invalidEnvironment(`${INJECTED_TASK_ENV_JSON} must be a data property`);
  }
  const rawInjectedEnv = descriptor.value;
  if (typeof rawInjectedEnv !== "string") {
    throw invalidEnvironment(`${INJECTED_TASK_ENV_JSON} must be a string`);
  }
  return filterSafeWorkflowEnv(parseInjectedEnvironment(rawInjectedEnv), "injected");
}

function createAllowedEnvironmentKeys(envAllowlist: string[] | undefined): Set<string> | null {
  if (envAllowlist === undefined) return null;
  if (!Array.isArray(envAllowlist) || envAllowlist.length > MAX_ENV_ENTRIES) {
    throw invalidEnvironment("Task environment allowlist is invalid or too large");
  }
  const allowed = new Set<string>();
  for (const key of envAllowlist) allowed.add(validateEnvironmentName(key));
  return allowed;
}

/** Build the environment exposed to a local task invocation. */
export function buildTaskContextEnv(
  allEnv: Record<string, string>,
  envAllowlist?: string[],
): Record<string, string> {
  const allowedEnvKeys = createAllowedEnvironmentKeys(envAllowlist);
  const taskContextEnv: Record<string, string> = {};

  for (const [rawKey, rawValue] of ownEntries(allEnv, "Task runtime environment")) {
    if (UNSAFE_INJECTED_ENV_KEYS.has(rawKey) || isReservedTaskEnvKey(rawKey)) continue;
    if (!isValidEnvironmentName(rawKey)) continue;
    const key = validateEnvironmentName(rawKey);
    const value = validateEnvironmentValue(rawValue, "runtime");
    if (allowedEnvKeys && !allowedEnvKeys.has(key)) continue;
    Object.defineProperty(taskContextEnv, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  for (const [key, value] of Object.entries(readInjectedProjectEnv(allEnv))) {
    if (allowedEnvKeys && !allowedEnvKeys.has(key)) continue;
    taskContextEnv[key] = value;
  }

  return taskContextEnv;
}

/** Merge validated project environment values into a workflow run context. */
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
