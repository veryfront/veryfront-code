import type { TokenCacheStore } from "../../extensions/cache/index.ts";
import { register, tryResolve, unregister } from "../../extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { ENV_VAR_MISSING, getErrorMessage, INITIALIZATION_ERROR } from "#veryfront/errors";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  assertCacheOptionsObject,
  requireSynchronousCacheRegistryOperation,
  snapshotOwnedTokenCacheOperations,
  snapshotTokenCacheClose,
  snapshotTokenCacheOperations,
} from "./validation.ts";

const MAX_REDIS_URL_CODE_UNITS = 4_096;
const MAX_REDIS_PREFIX_CODE_UNITS = 256;
const MAX_REDIS_PASSWORD_CODE_UNITS = 4_096;
const REDIS_GLOB_META_PATTERN = /[*?[\]\\]/u;

type RedisCacheExtensionModule = {
  RedisTokenCacheStore?: unknown;
};

type RedisTokenCacheStoreConstructor = new (options: {
  url: string;
  prefix?: string;
  password?: string;
}) => TokenCacheStore;

export interface RedisCacheBootstrapDependencies {
  readEnv?: (name: string) => string | undefined;
  resolveStore?: () => TokenCacheStore | undefined;
  /** Publish the store synchronously; returned values and thenables are rejected. */
  registerStore?: (store: TokenCacheStore) => void;
  /** Remove the published store synchronously during failed registration rollback. */
  unregisterStore?: () => void;
  importModule?: () => Promise<unknown>;
}

export type RedisTokenCacheStoreAcquisition =
  | Readonly<{ kind: "disabled"; store: null }>
  | Readonly<{ kind: "borrowed"; store: TokenCacheStore }>
  | Readonly<{ kind: "created"; store: TokenCacheStore }>;

function readOwnDependency(
  dependencies: RedisCacheBootstrapDependencies,
  key: keyof RedisCacheBootstrapDependencies,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Redis cache bootstrap ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveDependency<TFunction extends (...args: never[]) => unknown>(
  dependencies: RedisCacheBootstrapDependencies,
  key: keyof RedisCacheBootstrapDependencies,
  fallback: TFunction,
): TFunction {
  const configured = readOwnDependency(dependencies, key);
  if (configured === undefined) return fallback;
  if (typeof configured !== "function") {
    throw new TypeError(`Redis cache bootstrap ${key} must be a function`);
  }
  return configured as TFunction;
}

function readEnvironmentValue(
  readEnv: (name: string) => string | undefined,
  name: string,
): string | undefined {
  const value = readEnv(name);
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`Redis cache environment ${name} must be a string`);
  }
  return value;
}

function validateRedisUrl(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_REDIS_URL_CODE_UNITS ||
    value !== value.trim()
  ) {
    throw new TypeError("REDIS_URL must be a bounded Redis connection URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("REDIS_URL must be a valid Redis connection URL");
  }
  if (
    (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") ||
    parsed.hostname.length === 0 ||
    parsed.hash.length > 0
  ) {
    throw new TypeError("REDIS_URL must use redis:// or rediss:// with a host");
  }
  return parsed.toString();
}

function validateRedisPrefix(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.length > MAX_REDIS_PREFIX_CODE_UNITS ||
    value !== value.trim() ||
    REDIS_GLOB_META_PATTERN.test(value)
  ) {
    throw new TypeError(
      "REDIS_PREFIX must be bounded and cannot contain Redis glob metacharacters",
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      throw new TypeError("REDIS_PREFIX must contain visible ASCII characters");
    }
  }
  return value;
}

function validateRedisPassword(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (value.length > MAX_REDIS_PASSWORD_CODE_UNITS) {
    throw new TypeError("REDIS_PASSWORD exceeds the supported length");
  }
  return value;
}

function readStoreConstructor(module: unknown): RedisTokenCacheStoreConstructor {
  if (module === null || typeof module !== "object") {
    throw INITIALIZATION_ERROR.create({
      detail: "@veryfront/ext-cache-redis returned an invalid module",
    });
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      module,
      "RedisTokenCacheStore",
    );
  } catch (error) {
    throw INITIALIZATION_ERROR.create({
      detail: "@veryfront/ext-cache-redis exports are unreadable",
      cause: error,
    });
  }
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function"
  ) {
    throw INITIALIZATION_ERROR.create({
      detail: "@veryfront/ext-cache-redis must export RedisTokenCacheStore as a data property",
    });
  }
  return descriptor.value as RedisTokenCacheStoreConstructor;
}

async function importRedisExtension(): Promise<unknown> {
  return await importFirstPartyExtensionModule<RedisCacheExtensionModule>(
    "ext-cache-redis",
    "@veryfront/ext-cache-redis",
  );
}

async function failAfterCleanup(
  detail: string,
  failure: unknown,
  cleanup: readonly (() => void | PromiseLike<void>)[],
): Promise<never> {
  const failures = [failure];
  for (const action of cleanup) {
    try {
      await action();
    } catch (cleanupFailure) {
      failures.push(cleanupFailure);
    }
  }
  const cause = failures.length === 1
    ? failure
    : new AggregateError(failures, `${detail}; cleanup also failed`);
  throw INITIALIZATION_ERROR.create({ detail, cause });
}

/**
 * Register the Redis token-cache extension only when `CACHE_TYPE=redis`.
 * Explicit Redis selection is fail-closed for missing or invalid
 * configuration; an unavailable Redis service is handled later by
 * {@link ResilientCache}.
 */
export async function acquireRedisTokenCacheStoreFromEnv(
  dependencies: RedisCacheBootstrapDependencies = {},
): Promise<RedisTokenCacheStoreAcquisition> {
  assertCacheOptionsObject(
    dependencies,
    "Redis cache bootstrap dependencies",
    ["readEnv", "resolveStore", "registerStore", "unregisterStore", "importModule"],
  );
  const readEnvValue = resolveDependency(
    dependencies,
    "readEnv",
    getEnv,
  ) as (name: string) => string | undefined;
  const resolveStore = resolveDependency(
    dependencies,
    "resolveStore",
    () => tryResolve<TokenCacheStore>("TokenCacheStore"),
  ) as () => TokenCacheStore | undefined;
  const registerStore = resolveDependency(
    dependencies,
    "registerStore",
    (store: TokenCacheStore) => register("TokenCacheStore", store),
  ) as (store: TokenCacheStore) => void;
  const unregisterStore = resolveDependency(
    dependencies,
    "unregisterStore",
    () => unregister("TokenCacheStore"),
  ) as () => void;
  const importModule = resolveDependency(
    dependencies,
    "importModule",
    importRedisExtension,
  ) as () => Promise<unknown>;

  const cacheType = readEnvironmentValue(readEnvValue, "CACHE_TYPE") || "memory";
  if (cacheType !== "redis") {
    return Object.freeze({ kind: "disabled", store: null });
  }

  const existing = resolveStore();
  if (existing) {
    snapshotTokenCacheOperations(existing, "Registered Redis token cache");
    return Object.freeze({ kind: "borrowed", store: existing });
  }

  const redisUrl = readEnvironmentValue(readEnvValue, "REDIS_URL");
  if (!redisUrl) {
    throw ENV_VAR_MISSING.create({
      detail: "REDIS_URL is required when CACHE_TYPE=redis",
    });
  }
  const redisPrefix = validateRedisPrefix(
    readEnvironmentValue(readEnvValue, "REDIS_PREFIX"),
  );
  const redisPassword = validateRedisPassword(
    readEnvironmentValue(readEnvValue, "REDIS_PASSWORD"),
  );
  const options = Object.freeze({
    url: validateRedisUrl(redisUrl),
    ...(redisPrefix === undefined ? {} : { prefix: redisPrefix }),
    ...(redisPassword === undefined ? {} : { password: redisPassword }),
  });

  let module: unknown;
  try {
    module = await importModule();
  } catch (error) {
    throw INITIALIZATION_ERROR.create({
      detail: `CACHE_TYPE=redis requires @veryfront/ext-cache-redis. ${getErrorMessage(error)}`,
      cause: error,
    });
  }

  const Store = readStoreConstructor(module);
  let store: TokenCacheStore;
  try {
    store = new Store(options);
  } catch (error) {
    throw INITIALIZATION_ERROR.create({
      detail: "Failed to initialize @veryfront/ext-cache-redis",
      cause: error,
    });
  }
  const detail = "Failed to initialize @veryfront/ext-cache-redis";
  let close: () => Promise<void>;
  try {
    close = snapshotTokenCacheClose(store, "Redis token cache extension");
  } catch (error) {
    throw INITIALIZATION_ERROR.create({ detail, cause: error });
  }

  let stableStore: TokenCacheStore;
  try {
    stableStore = snapshotOwnedTokenCacheOperations(
      store,
      "Redis token cache extension",
    );
  } catch (error) {
    return await failAfterCleanup(detail, error, [close]);
  }

  try {
    requireSynchronousCacheRegistryOperation(
      (registerStore as (store: TokenCacheStore) => unknown)(stableStore),
      "Redis cache registration",
    );
  } catch (error) {
    return await failAfterCleanup(
      "Failed to register @veryfront/ext-cache-redis",
      error,
      [
        () => {
          if (resolveStore() !== stableStore) return;
          requireSynchronousCacheRegistryOperation(
            (unregisterStore as () => unknown)(),
            "Redis cache registration rollback",
          );
        },
        stableStore.close,
      ],
    );
  }
  return Object.freeze({ kind: "created", store: stableStore });
}

/**
 * Preserve the historical bootstrap API for consumers that only need the
 * selected store. Startup coordinators should use
 * {@link acquireRedisTokenCacheStoreFromEnv} so close ownership is explicit.
 */
export async function ensureRedisTokenCacheStoreFromEnv(
  dependencies: RedisCacheBootstrapDependencies = {},
): Promise<TokenCacheStore | null> {
  return (await acquireRedisTokenCacheStoreFromEnv(dependencies)).store;
}
