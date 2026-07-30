/** Explicit extension-backed agent memory selection. */

import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedAgentMemoryOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import type { Memory, MinimalMessage } from "./memory-interface.ts";

/** Create persistent memory from an already-activated distributed provider. */
export function createDistributedAgentMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  options: DistributedAgentMemoryOptions = {},
): Memory<M> {
  const provider = captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  );
  const memory = provider.createAgentMemory<M>(agentId, options);
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    throw new TypeError(
      `${DistributedRuntimeProviderName} returned an invalid agent memory implementation`,
    );
  }
  return memory;
}

export type { DistributedAgentMemoryOptions };
