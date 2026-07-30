/**
 * Explicit distributed token-cache acquisition.
 *
 * This module never imports, discovers, or constructs a provider. The selected
 * extension must already have registered `TokenCacheStore`
 * before standalone proxy startup reaches this boundary.
 */

import type { TokenCacheStore } from "../../extensions/cache/index.ts";
import { tryResolve } from "../../extensions/contracts.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { assertCacheOptionsObject, snapshotTokenCacheOperations } from "./validation.ts";

export interface ExtensionCacheBootstrapDependencies {
  readEnv?: (name: string) => string | undefined;
  resolveStore?: () => TokenCacheStore | undefined;
}

/**
 * Ownership descriptor consumed by proxy startup. `created` remains in the
 * structural type for embedding composition roots that construct a store
 * before calling core, but core itself only returns `disabled` or `borrowed`.
 */
export type ExtensionTokenCacheStoreAcquisition =
  | Readonly<{ kind: "disabled"; store: null }>
  | Readonly<{ kind: "borrowed"; store: TokenCacheStore }>
  | Readonly<{ kind: "created"; store: TokenCacheStore }>;

function readOwnDependency(
  dependencies: ExtensionCacheBootstrapDependencies,
  key: keyof ExtensionCacheBootstrapDependencies,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Extension cache bootstrap ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveDependency<TFunction extends (...args: never[]) => unknown>(
  dependencies: ExtensionCacheBootstrapDependencies,
  key: keyof ExtensionCacheBootstrapDependencies,
  fallback: TFunction,
): TFunction {
  const configured = readOwnDependency(dependencies, key);
  if (configured === undefined) return fallback;
  if (typeof configured !== "function") {
    throw new TypeError(`Extension cache bootstrap ${key} must be a function`);
  }
  return configured as TFunction;
}

function readEnvironmentValue(
  readEnv: (name: string) => string | undefined,
  name: string,
): string | undefined {
  const value = readEnv(name);
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`Extension cache environment ${name} must be a string`);
  }
  return value;
}

/**
 * Resolve an already-activated token-cache extension only when explicitly
 * selected with `CACHE_TYPE=extension`.
 */
export function acquireExtensionTokenCacheStoreFromEnv(
  dependencies: ExtensionCacheBootstrapDependencies = {},
): Promise<ExtensionTokenCacheStoreAcquisition> {
  assertCacheOptionsObject(
    dependencies,
    "Extension cache bootstrap dependencies",
    ["readEnv", "resolveStore"],
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

  const cacheType = readEnvironmentValue(readEnvValue, "CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "extension") {
    return Promise.reject(new TypeError("CACHE_TYPE must be memory or extension"));
  }
  if (cacheType !== "extension") {
    return Promise.resolve(Object.freeze({ kind: "disabled", store: null }));
  }

  const store = resolveStore();
  if (!store) {
    return Promise.reject(
      INITIALIZATION_ERROR.create({
        detail:
          'CACHE_TYPE=extension requires an explicitly activated extension that provides "TokenCacheStore".',
      }),
    );
  }
  snapshotTokenCacheOperations(store, "Registered extension token cache");
  return Promise.resolve(Object.freeze({ kind: "borrowed", store }));
}

/** Resolve only the selected store for composition roots that do not need ownership metadata. */
export async function ensureExtensionTokenCacheStoreFromEnv(
  dependencies: ExtensionCacheBootstrapDependencies = {},
): Promise<TokenCacheStore | null> {
  return (await acquireExtensionTokenCacheStoreFromEnv(dependencies)).store;
}
