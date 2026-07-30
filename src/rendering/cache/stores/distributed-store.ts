/** Explicit extension-backed render cache selection. */

import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedRenderCacheStoreOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import type { CacheStore } from "../types.ts";

/** Create a render cache store from an already-activated distributed provider. */
export function createDistributedRenderCacheStore(
  options: DistributedRenderCacheStoreOptions = {},
): CacheStore {
  const provider = captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  );
  const store = provider.createRenderCacheStore(options);
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw new TypeError(
      `${DistributedRuntimeProviderName} returned an invalid render cache store`,
    );
  }
  return store;
}

export type { DistributedRenderCacheStoreOptions };
