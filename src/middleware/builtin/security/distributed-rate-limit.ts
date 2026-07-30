/** Explicit extension-backed rate-limit store selection. */

import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedRateLimitStoreOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import type { RateLimitStore } from "./types.ts";

export function createDistributedRateLimitStore(
  options: DistributedRateLimitStoreOptions = {},
): RateLimitStore {
  const provider = captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  );
  const store = provider.createRateLimitStore(options);
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw new TypeError(
      `${DistributedRuntimeProviderName} returned an invalid rate-limit store`,
    );
  }
  return store;
}

export type { DistributedRateLimitStoreOptions };
