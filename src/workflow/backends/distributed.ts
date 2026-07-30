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
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { WorkflowBackend } from "./types.ts";

const MAX_WORKFLOW_BACKEND_PROTOTYPE_DEPTH = 16;
const MAX_WORKFLOW_BACKEND_SURFACE_KEYS = 256;

const REQUIRED_WORKFLOW_BACKEND_METHODS = [
  "createRun",
  "getRun",
  "updateRun",
  "updateRunIfStatus",
  "listRuns",
  "saveCheckpoint",
  "getLatestCheckpoint",
  "savePendingApproval",
  "updatePendingApproval",
  "getPendingApprovals",
  "getApproval",
  "updateApproval",
  "listPendingApprovals",
  "destroy",
] as const satisfies readonly (keyof WorkflowBackend)[];

const OPTIONAL_WORKFLOW_BACKEND_CAPABILITY_GROUPS = [
  ["acquireLock", "extendLock", "releaseLock", "updateRunIfStatusAndLock"],
  ["enqueue", "dequeue", "acknowledge"],
  [
    "updateRunIfStatusAndWorker",
    "saveCheckpointIfStatusAndWorker",
    "savePendingApprovalIfStatusAndWorker",
  ],
  ["findStalledRuns", "claimStalledRun"],
  ["publishEvent", "subscribeEvents"],
] as const satisfies readonly (readonly (keyof WorkflowBackend)[])[];

const OPTIONAL_WORKFLOW_BACKEND_METHODS = [
  "updateRunIfStatusAndWorker",
  "updateRunIfStatusAndLock",
  "deleteRun",
  "countRuns",
  "saveCheckpointIfStatusAndWorker",
  "getCheckpoints",
  "deleteCheckpoint",
  "deleteCheckpoints",
  "savePendingApprovalIfStatusAndWorker",
  "enqueue",
  "dequeue",
  "acknowledge",
  "nack",
  "acquireLock",
  "releaseLock",
  "extendLock",
  "isLocked",
  "findStalledRuns",
  "claimStalledRun",
  "publishEvent",
  "subscribeEvents",
  "initialize",
  "healthCheck",
] as const satisfies readonly (keyof WorkflowBackend)[];

const WORKFLOW_BACKEND_METHODS = [
  ...REQUIRED_WORKFLOW_BACKEND_METHODS,
  ...OPTIONAL_WORKFLOW_BACKEND_METHODS,
] as const;
const WORKFLOW_BACKEND_METHOD_SET = new Set<PropertyKey>(WORKFLOW_BACKEND_METHODS);

type WorkflowBackendMethodName = typeof WORKFLOW_BACKEND_METHODS[number];
type WorkflowBackendMethod = (...args: never[]) => unknown;

function invalidWorkflowBackend(detail?: string, cause?: unknown): TypeError {
  const message = `${DistributedRuntimeProviderName} returned an invalid workflow backend${
    detail ? `: ${detail}` : ""
  }`;
  return cause === undefined ? new TypeError(message) : new TypeError(message, { cause });
}

function inspectWorkflowBackendMethods(value: object): Map<WorkflowBackendMethodName, unknown> {
  const captured = new Map<WorkflowBackendMethodName, unknown>();
  let current: object | null = value;
  let depth = 0;
  let inspectedKeys = 0;
  let candidatePrototype: object | null;
  try {
    candidatePrototype = Object.getPrototypeOf(value) as object | null;
  } catch (cause) {
    throw invalidWorkflowBackend("prototype could not be inspected", cause);
  }
  const allowsOpaqueInstanceState = candidatePrototype !== null &&
    candidatePrototype !== Object.prototype;

  while (current !== null && current !== Object.prototype) {
    if (isProxyWithoutHooks(current)) {
      throw invalidWorkflowBackend("backend and its prototypes must not be Proxies");
    }
    if (depth > MAX_WORKFLOW_BACKEND_PROTOTYPE_DEPTH) {
      throw invalidWorkflowBackend(
        `prototype chain cannot exceed ${MAX_WORKFLOW_BACKEND_PROTOTYPE_DEPTH} levels`,
      );
    }

    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(current);
    } catch (cause) {
      throw invalidWorkflowBackend("surface could not be inspected", cause);
    }
    inspectedKeys += keys.length;
    if (inspectedKeys > MAX_WORKFLOW_BACKEND_SURFACE_KEYS) {
      throw invalidWorkflowBackend(
        `surface cannot contain more than ${MAX_WORKFLOW_BACKEND_SURFACE_KEYS} properties`,
      );
    }

    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch (cause) {
        throw invalidWorkflowBackend(`property ${String(key)} could not be inspected`, cause);
      }
      if (!descriptor || !("value" in descriptor)) {
        throw invalidWorkflowBackend(`property ${String(key)} must be a data property`);
      }
      if (typeof key !== "string") {
        throw invalidWorkflowBackend("symbol properties are not supported");
      }

      if (WORKFLOW_BACKEND_METHOD_SET.has(key)) {
        if (!captured.has(key as WorkflowBackendMethodName)) {
          captured.set(key as WorkflowBackendMethodName, descriptor.value);
        }
        continue;
      }
      if (key === "constructor" && current !== value && !descriptor.enumerable) continue;

      if (
        current === value && allowsOpaqueInstanceState &&
        typeof descriptor.value !== "function"
      ) {
        continue;
      }
      if (current !== value && !descriptor.enumerable) continue;
      throw invalidWorkflowBackend(`contains unexpected property ${key}`);
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(current) as object | null;
    } catch (cause) {
      throw invalidWorkflowBackend("prototype could not be inspected", cause);
    }
    if (prototype !== null && isProxyWithoutHooks(prototype)) {
      throw invalidWorkflowBackend("backend and its prototypes must not be Proxies");
    }
    current = prototype;
    depth++;
  }

  return captured;
}

function resolveDistributedRuntimeProvider(): Readonly<DistributedRuntimeProvider> {
  return captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  );
}

function requireWorkflowBackend(value: unknown): WorkflowBackend {
  if (
    !value || typeof value !== "object" || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    throw invalidWorkflowBackend();
  }
  const surface = inspectWorkflowBackendMethods(value);
  const methods = new Map<WorkflowBackendMethodName, WorkflowBackendMethod>();
  for (const method of REQUIRED_WORKFLOW_BACKEND_METHODS) {
    const candidate = surface.get(method);
    if (candidate === undefined) {
      throw invalidWorkflowBackend(`missing required method ${method}`);
    }
    if (typeof candidate !== "function" || isProxyWithoutHooks(candidate)) {
      throw invalidWorkflowBackend(`method ${method} must be a non-Proxy function`);
    }
    methods.set(method, candidate as WorkflowBackendMethod);
  }
  for (const method of OPTIONAL_WORKFLOW_BACKEND_METHODS) {
    const candidate = surface.get(method);
    if (candidate === undefined) continue;
    if (typeof candidate !== "function" || isProxyWithoutHooks(candidate)) {
      throw invalidWorkflowBackend(`method ${method} must be a non-Proxy function`);
    }
    methods.set(method, candidate as WorkflowBackendMethod);
  }
  for (const group of OPTIONAL_WORKFLOW_BACKEND_CAPABILITY_GROUPS) {
    const implemented = group.filter((method) => methods.has(method));
    if (implemented.length !== 0 && implemented.length !== group.length) {
      throw invalidWorkflowBackend(
        `optional capability must implement all of ${group.join(", ")}`,
      );
    }
  }

  const backend = Object.create(null) as Record<PropertyKey, unknown>;
  for (const [name, method] of methods) {
    Object.defineProperty(backend, name, {
      value: (...args: unknown[]) => Reflect.apply(method, value, args),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(backend) as unknown as WorkflowBackend;
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
