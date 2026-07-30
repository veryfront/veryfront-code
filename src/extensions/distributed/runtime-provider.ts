/**
 * Provider-neutral contracts for optional distributed runtime infrastructure.
 *
 * Core owns feature semantics and explicit provider selection. Extensions own
 * client libraries, connections, protocol-specific storage, and lifecycle.
 *
 * @module extensions/distributed/runtime-provider
 */

import type { Memory, MinimalMessage } from "#veryfront/agent/memory/memory-interface.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import type { RateLimitStore } from "#veryfront/middleware/builtin/security/types.ts";
import type {
  ProxyRoutingInvalidationEvent,
  ProxyRoutingInvalidationPublisher,
} from "#veryfront/proxy/routing-invalidation.ts";
import type { CacheStore as RenderCacheStore } from "#veryfront/rendering/cache/types.ts";
import type {
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "#veryfront/workflow/claude-code/types.ts";
import type { WorkflowBackend } from "#veryfront/workflow/backends/types.ts";

/** Registry name used by distributed-infrastructure extensions. */
export const DistributedRuntimeProviderName = "DistributedRuntimeProvider" as const;

const MAX_PROVIDER_ID_CODE_UNITS = 256;
const PROVIDER_METHODS = [
  "createCacheBackend",
  "createRenderCacheStore",
  "createWorkflowBackend",
  "getWorkflowWorkerEnvironment",
  "createRateLimitStore",
  "createAgentMemory",
  "createEventPublisher",
  "startRoutingInvalidationBus",
  "getCacheAdministration",
] as const;

const MAX_WORKFLOW_WORKER_ENV_ENTRIES = 256;
const MAX_WORKFLOW_WORKER_ENV_KEY_BYTES = 256;
const MAX_WORKFLOW_WORKER_ENV_VALUE_BYTES = 65_536;
const MAX_WORKFLOW_WORKER_ENV_TOTAL_BYTES = 1_048_576;
const WORKFLOW_WORKER_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_WORKFLOW_WORKER_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RESERVED_WORKFLOW_WORKER_ENV_KEYS = new Set([
  "MODE",
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "VERYFRONT_BRANCH_REF",
  "VERYFRONT_ENVIRONMENT_NAME",
]);
const workflowWorkerEnvironmentEncoder = new TextEncoder();

/** Feature-level cache options. Connection ownership belongs to the extension. */
export interface DistributedCacheBackendOptions {
  keyPrefix: string;
}

export interface DistributedRenderCacheStoreOptions {
  keyPrefix?: string;
  ttlSeconds?: number;
}

export interface DistributedWorkflowBackendOptions {
  prefix?: string;
  streamKey?: string;
  groupName?: string;
  consumerName?: string;
  runTtlSeconds?: number;
  debug?: boolean;
}

/** Provider-owned environment required by an isolated workflow worker process. */
export type DistributedWorkflowWorkerEnvironment = Readonly<Record<string, string>>;

export interface DistributedRateLimitStoreOptions {
  keyPrefix?: string;
  operationTimeoutMs?: number;
}

export interface DistributedAgentMemoryOptions {
  keyPrefix?: string;
  userId?: string;
  ttlSeconds?: number;
  maxMessages?: number;
  maxTokens?: number;
}

export interface DistributedEventPublisherOptions {
  channelPrefix?: string;
  debug?: boolean;
}

export interface DistributedRoutingInvalidationLogger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: unknown, extra?: Record<string, unknown>): void;
}

export interface DistributedRoutingInvalidationOptions {
  acknowledgementTimeoutMs?: number;
  expectedReplicas?: number;
  integritySecret: string;
  logger?: DistributedRoutingInvalidationLogger;
  onInvalidate(event: ProxyRoutingInvalidationEvent): unknown | Promise<unknown>;
  replicaId?: string;
}

export interface DistributedRoutingInvalidationBus extends ProxyRoutingInvalidationPublisher {
  close(): Promise<void>;
}

/** Bounded provider-neutral cache listing request. */
export interface DistributedCacheListOptions {
  readonly prefix: string;
  readonly limit: number;
}

/** Immutable bounded cache listing with explicit completeness. */
export interface DistributedCacheKeyListing {
  readonly keys: readonly string[];
  readonly truncated: boolean;
}

/** Narrow administrative surface used by core cache diagnostics/invalidation. */
export interface DistributedCacheAdministration {
  isConfigured(): boolean;
  listKeys(options: DistributedCacheListOptions): Promise<DistributedCacheKeyListing>;
  deleteKeys(keys: readonly string[]): Promise<number>;
}

const MAX_DISTRIBUTED_CACHE_ADMIN_KEYS = 100_000;
const MAX_DISTRIBUTED_CACHE_PREFIX_BYTES = 512;
const MAX_DISTRIBUTED_CACHE_KEY_BYTES = 16_384;
const cacheAdministrationEncoder = new TextEncoder();

function requireBoundedCacheString(value: unknown, label: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /\p{Cc}/u.test(value) ||
    cacheAdministrationEncoder.encode(value).byteLength > maxBytes
  ) {
    throw new TypeError(`${label} must be a bounded non-empty string without control characters`);
  }
  return value;
}

function snapshotCacheListOptions(value: unknown): DistributedCacheListOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Distributed cache list options must be an object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("prefix") || !keys.includes("limit")) {
    throw new TypeError("Distributed cache list options must contain only prefix and limit");
  }
  const prefix = requireBoundedCacheString(
    readOwnDataProperty(value, "prefix", "Distributed cache list prefix"),
    "Distributed cache list prefix",
    MAX_DISTRIBUTED_CACHE_PREFIX_BYTES,
  );
  const limit = readOwnDataProperty(value, "limit", "Distributed cache list limit");
  if (
    !Number.isSafeInteger(limit) || (limit as number) < 0 ||
    (limit as number) > MAX_DISTRIBUTED_CACHE_ADMIN_KEYS
  ) {
    throw new RangeError(
      `Distributed cache list limit must be an integer between 0 and ${MAX_DISTRIBUTED_CACHE_ADMIN_KEYS}`,
    );
  }
  return Object.freeze({ prefix, limit: limit as number });
}

function snapshotCacheKeys(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_DISTRIBUTED_CACHE_ADMIN_KEYS) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const keys = value.map((key) =>
    requireBoundedCacheString(key, `${label} entry`, MAX_DISTRIBUTED_CACHE_KEY_BYTES)
  );
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(`${label} must not contain duplicate keys`);
  }
  return Object.freeze(keys);
}

/** Capture the administrative surface returned by a distributed provider. */
export function captureDistributedCacheAdministration(
  value: unknown,
): Readonly<DistributedCacheAdministration> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Distributed cache administration must be an object");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Distributed cache administration could not be inspected", { cause });
  }
  if (
    keys.length !== 3 ||
    !keys.includes("isConfigured") ||
    !keys.includes("listKeys") ||
    !keys.includes("deleteKeys")
  ) {
    throw new TypeError(
      "Distributed cache administration must contain only isConfigured, listKeys, and deleteKeys",
    );
  }
  const isConfigured = readOwnDataProperty(
    value,
    "isConfigured",
    "Distributed cache administration isConfigured",
  );
  const listKeys = readOwnDataProperty(
    value,
    "listKeys",
    "Distributed cache administration listKeys",
  );
  const deleteKeys = readOwnDataProperty(
    value,
    "deleteKeys",
    "Distributed cache administration deleteKeys",
  );
  if (
    typeof isConfigured !== "function" ||
    typeof listKeys !== "function" ||
    typeof deleteKeys !== "function"
  ) {
    throw new TypeError("Distributed cache administration operations must be functions");
  }
  return Object.freeze({
    isConfigured(): boolean {
      const result = Reflect.apply(isConfigured, value, []);
      if (typeof result !== "boolean") {
        throw new TypeError("Distributed cache administration isConfigured must return boolean");
      }
      return result;
    },
    async listKeys(options: DistributedCacheListOptions): Promise<DistributedCacheKeyListing> {
      const request = snapshotCacheListOptions(options);
      const result = await Promise.resolve(Reflect.apply(listKeys, value, [request]));
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Distributed cache administration returned an invalid listing");
      }
      const resultKeys = Reflect.ownKeys(result);
      if (
        resultKeys.length !== 2 || !resultKeys.includes("keys") ||
        !resultKeys.includes("truncated")
      ) {
        throw new TypeError("Distributed cache listing must contain only keys and truncated");
      }
      const snapshot = snapshotCacheKeys(
        readOwnDataProperty(result, "keys", "Distributed cache listing keys") as readonly string[],
        "Distributed cache listing",
      );
      const truncated = readOwnDataProperty(
        result,
        "truncated",
        "Distributed cache listing truncated",
      );
      if (typeof truncated !== "boolean") {
        throw new TypeError("Distributed cache listing truncated must be boolean");
      }
      if (
        snapshot.length > request.limit || snapshot.some((key) => !key.startsWith(request.prefix))
      ) {
        throw new TypeError("Distributed cache administration returned keys outside the request");
      }
      return Object.freeze({ keys: snapshot, truncated });
    },
    async deleteKeys(keys: readonly string[]): Promise<number> {
      const request = snapshotCacheKeys(keys, "Distributed cache deletion");
      const result = await Promise.resolve(Reflect.apply(deleteKeys, value, [request]));
      if (
        !Number.isSafeInteger(result) || (result as number) < 0 ||
        (result as number) > request.length
      ) {
        throw new TypeError("Distributed cache administration returned an invalid deletion count");
      }
      return result as number;
    },
  });
}

/**
 * Optional distributed runtime implementation supplied by an extension.
 *
 * Every factory is lazy. Activating an extension registers capabilities but
 * does not select a distributed backend. A feature selects it explicitly in
 * configuration, then core invokes the corresponding factory and fails closed
 * when the contract is absent or initialization fails.
 */
export interface DistributedRuntimeProvider {
  readonly id: string;
  createCacheBackend(options: DistributedCacheBackendOptions): Promise<CacheBackend>;
  createRenderCacheStore(options: DistributedRenderCacheStoreOptions): RenderCacheStore;
  /**
   * Create a dedicated caller-owned workflow backend. The caller must destroy
   * it before tearing down the activated provider extension.
   */
  createWorkflowBackend(options: DistributedWorkflowBackendOptions): WorkflowBackend;
  getWorkflowWorkerEnvironment(): Record<string, string>;
  createRateLimitStore(options: DistributedRateLimitStoreOptions): RateLimitStore;
  createAgentMemory<M extends MinimalMessage = MinimalMessage>(
    agentId: string,
    options: DistributedAgentMemoryOptions,
  ): Memory<M>;
  createEventPublisher(
    options: DistributedEventPublisherOptions,
  ): ClaudeCodeEventPublisher & ClaudeCodeEventSubscriber;
  startRoutingInvalidationBus(
    options: DistributedRoutingInvalidationOptions,
  ): Promise<DistributedRoutingInvalidationBus>;
  getCacheAdministration(): DistributedCacheAdministration;
}

type ProviderMethodName = typeof PROVIDER_METHODS[number];
type ProviderMethod = (...args: never[]) => unknown;

function readOwnDataProperty(
  value: object,
  key: string,
  label: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label} must be an enumerable own data property`);
  }
  return descriptor.value;
}

function assertProviderId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_ID_CODE_UNITS ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Distributed runtime provider id must be a bounded canonical string");
  }
}

/**
 * Snapshot and bound provider-owned environment passed to isolated workflow
 * processes. Core reserves execution/tenant identity variables and never
 * evaluates provider-specific names or values.
 */
export function captureDistributedWorkflowWorkerEnvironment(
  value: unknown,
): DistributedWorkflowWorkerEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Distributed workflow worker environment must be an object");
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Distributed workflow worker environment could not be inspected", {
      cause,
    });
  }
  if (keys.length > MAX_WORKFLOW_WORKER_ENV_ENTRIES) {
    throw new RangeError(
      `Distributed workflow worker environment cannot exceed ${MAX_WORKFLOW_WORKER_ENV_ENTRIES} entries`,
    );
  }

  const snapshot: Record<string, string> = Object.create(null);
  let totalBytes = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !WORKFLOW_WORKER_ENV_NAME_PATTERN.test(key)) {
      throw new TypeError("Distributed workflow worker environment contains an invalid name");
    }
    const normalizedKey = key.toUpperCase();
    if (
      UNSAFE_WORKFLOW_WORKER_ENV_KEYS.has(key) ||
      RESERVED_WORKFLOW_WORKER_ENV_KEYS.has(normalizedKey) ||
      normalizedKey.startsWith("TENANT_")
    ) {
      throw new TypeError(`Distributed workflow worker environment cannot set ${key}`);
    }

    const entry = readOwnDataProperty(
      value,
      key,
      `Distributed workflow worker environment ${key}`,
    );
    if (typeof entry !== "string" || entry.includes("\0")) {
      throw new TypeError(
        `Distributed workflow worker environment ${key} must be a NUL-free string`,
      );
    }

    const keyBytes = workflowWorkerEnvironmentEncoder.encode(key).byteLength;
    const valueBytes = workflowWorkerEnvironmentEncoder.encode(entry).byteLength;
    if (
      keyBytes > MAX_WORKFLOW_WORKER_ENV_KEY_BYTES ||
      valueBytes > MAX_WORKFLOW_WORKER_ENV_VALUE_BYTES
    ) {
      throw new RangeError(`Distributed workflow worker environment ${key} exceeds its size limit`);
    }
    totalBytes += keyBytes + valueBytes;
    if (totalBytes > MAX_WORKFLOW_WORKER_ENV_TOTAL_BYTES) {
      throw new RangeError(
        `Distributed workflow worker environment cannot exceed ${MAX_WORKFLOW_WORKER_ENV_TOTAL_BYTES} bytes`,
      );
    }
    Object.defineProperty(snapshot, key, {
      value: entry,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return Object.freeze(snapshot);
}

/**
 * Capture a provider's complete callable surface without invoking accessors.
 * Later mutation of the registry object cannot redirect active operations.
 */
export function captureDistributedRuntimeProvider(
  value: unknown,
): Readonly<DistributedRuntimeProvider> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("DistributedRuntimeProvider must be an object");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("DistributedRuntimeProvider could not be inspected", { cause });
  }
  const allowedKeys = new Set<PropertyKey>(["id", ...PROVIDER_METHODS]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new TypeError("DistributedRuntimeProvider contains an unexpected property");
  }

  const id = readOwnDataProperty(value, "id", "DistributedRuntimeProvider id");
  assertProviderId(id);
  const methods = new Map<ProviderMethodName, ProviderMethod>();
  for (const name of PROVIDER_METHODS) {
    const method = readOwnDataProperty(
      value,
      name,
      `DistributedRuntimeProvider ${name}`,
    );
    if (typeof method !== "function") {
      throw new TypeError(`DistributedRuntimeProvider ${name} must be a function`);
    }
    methods.set(name, method as ProviderMethod);
  }

  const call = (name: ProviderMethodName, args: unknown[]): unknown =>
    Reflect.apply(methods.get(name)!, value, args);

  const capturedProvider: DistributedRuntimeProvider = {
    id,
    createCacheBackend: (options) => call("createCacheBackend", [options]) as Promise<CacheBackend>,
    createRenderCacheStore: (options) =>
      call("createRenderCacheStore", [options]) as RenderCacheStore,
    createWorkflowBackend: (options) => call("createWorkflowBackend", [options]) as WorkflowBackend,
    getWorkflowWorkerEnvironment: () =>
      call("getWorkflowWorkerEnvironment", []) as Record<string, string>,
    createRateLimitStore: (options) => call("createRateLimitStore", [options]) as RateLimitStore,
    createAgentMemory: <M extends MinimalMessage = MinimalMessage>(
      agentId: string,
      options: DistributedAgentMemoryOptions,
    ) => call("createAgentMemory", [agentId, options]) as Memory<M>,
    createEventPublisher: (options) =>
      call("createEventPublisher", [options]) as
        & ClaudeCodeEventPublisher
        & ClaudeCodeEventSubscriber,
    startRoutingInvalidationBus: (options) =>
      call("startRoutingInvalidationBus", [options]) as Promise<DistributedRoutingInvalidationBus>,
    getCacheAdministration: () =>
      call("getCacheAdministration", []) as DistributedCacheAdministration,
  };
  return Object.freeze(capturedProvider);
}
