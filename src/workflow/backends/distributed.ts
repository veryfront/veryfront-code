/** Explicit extension-backed workflow backend selection. */

import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  captureDistributedWorkflowWorkerEnvironment,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
  type DistributedWorkflowBackendOptions,
  type DistributedWorkflowWorkerEnvironment,
} from "#veryfront/extensions/distributed/index.ts";
import type { WorkflowBackend } from "./types.ts";

function resolveDistributedRuntimeProvider(): Readonly<DistributedRuntimeProvider> {
  return captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  );
}

function requireWorkflowBackend(value: unknown): WorkflowBackend {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `${DistributedRuntimeProviderName} returned an invalid workflow backend`,
    );
  }
  return value as WorkflowBackend;
}

/** Create a workflow backend from an already-activated distributed provider. */
export function createDistributedWorkflowBackend(
  options: DistributedWorkflowBackendOptions,
): WorkflowBackend {
  return requireWorkflowBackend(
    resolveDistributedRuntimeProvider().createWorkflowBackend(options),
  );
}

export interface DistributedWorkflowWorkerResources {
  readonly backend: WorkflowBackend;
  readonly environment: DistributedWorkflowWorkerEnvironment;
}

/** Create a backend and its provider-owned isolated-process environment. */
export async function createDistributedWorkflowWorkerResources(
  options: DistributedWorkflowBackendOptions,
): Promise<DistributedWorkflowWorkerResources> {
  const provider = resolveDistributedRuntimeProvider();
  const backend = requireWorkflowBackend(provider.createWorkflowBackend(options));

  try {
    const environment = captureDistributedWorkflowWorkerEnvironment(
      provider.getWorkflowWorkerEnvironment(),
    );
    return Object.freeze({ backend, environment });
  } catch (environmentError) {
    try {
      await backend.destroy();
    } catch (cleanupError) {
      throw new AggregateError(
        [environmentError, cleanupError],
        "Distributed workflow worker environment validation and backend cleanup failed",
      );
    }
    throw environmentError;
  }
}

export type { DistributedWorkflowBackendOptions, DistributedWorkflowWorkerEnvironment };
