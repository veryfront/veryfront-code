/**
 * Worker Isolation Types
 *
 * Shared type definitions for the worker isolation system.
 * Used by both the main process and worker script.
 *
 * @module security/sandbox/worker-types
 */

import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { ErrorCategory } from "#veryfront/errors";

/**
 * Serialized request data that can cross the Worker boundary via postMessage.
 * We cannot send a full Request object (it's not structured-cloneable),
 * so we extract the essential fields.
 */
export interface SerializedRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

/**
 * Serialized API context for Pages Router routes.
 */
export interface SerializedPagesContext {
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array | null;
  params: Record<string, string | string[]>;
  cookies: Record<string, string>;
}

/**
 * Serialized response data that can cross the Worker boundary.
 */
export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

/**
 * Serialized error for cross-boundary transport.
 */
export interface SerializedError {
  message: string;
  name: string;
  stack?: string;
  /** Detached, sanitized registered-error identity for the host boundary. */
  problem?: {
    slug: string;
    category: ErrorCategory;
    status: number;
    title: string;
    suggestion?: string;
    detail?: string;
    cause?: string;
    instance?: string;
  };
  /** @deprecated Legacy transport fields; never trusted by the host boundary. */
  type?: string;
  /** @deprecated Legacy transport fields; never trusted by the host boundary. */
  status?: number;
  /** @deprecated Legacy transport fields; never trusted by the host boundary. */
  detail?: string;
}

/**
 * Serialized DataContext for data fetcher isolation.
 * Request and URL are not structured-cloneable, so we serialize them.
 */
export interface SerializedDataContext {
  params: Record<string, string | string[]>;
  /** URLSearchParams.toString() */
  query: string;
  request: SerializedRequest;
  /** URL.toString() */
  url: string;
}

/**
 * Serialized DataResult — plain JSON, fully structured-cloneable.
 */
export interface SerializedDataResult {
  props?: unknown;
  redirect?: { destination: string; permanent?: boolean };
  notFound?: boolean;
  revalidate?: number | false;
}

// ---------------------------------------------------------------------------
// Worker Request / Response Protocol
// ---------------------------------------------------------------------------

/**
 * Immutable, host-prepared JavaScript sent across the worker boundary.
 *
 * `sha256` is the exact lowercase hexadecimal SHA-256 digest of the UTF-8
 * encoded `source`. Workers rehash before importing and key their module cache
 * by this content identity.
 */
export interface PreparedWorkerModule {
  source: string;
  sha256: string;
}

export type WorkerRequest =
  | ExecuteAppRouteRequest
  | ExecutePagesRouteRequest
  | InspectApiRouteMethodsRequest
  | FetchDataRequest
  | RenderSSRRequest;

export interface ExecuteAppRouteRequest {
  type: "execute-app-route";
  id: string;
  module: PreparedWorkerModule;
  /** Required logical route identity and bounded diagnostic; never imported by the worker. */
  modulePath: string;
  method: string;
  request: SerializedRequest;
  params: Record<string, string | string[]>;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Per-project env var overlay for multi-tenant proxy mode */
  projectEnv?: Record<string, string>;
}

export interface ExecutePagesRouteRequest {
  type: "execute-pages-route";
  id: string;
  module: PreparedWorkerModule;
  /** Required logical route identity and bounded diagnostic; never imported by the worker. */
  modulePath: string;
  method: string;
  context: SerializedPagesContext;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Per-project env var overlay for multi-tenant proxy mode */
  projectEnv?: Record<string, string>;
}

export interface InspectApiRouteMethodsRequest {
  type: "inspect-api-route-methods";
  id: string;
  module: PreparedWorkerModule;
  /** Required logical route identity and bounded diagnostic; never imported by the worker. */
  modulePath: string;
  /** Optional custom-method probe used for default-export capability parity. */
  requestedMethod?: string;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Per-project env var overlay for multi-tenant proxy mode. */
  projectEnv?: Record<string, string>;
}

export interface FetchDataRequest {
  type: "fetch-data";
  id: string;
  modulePath: string;
  context: SerializedDataContext;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
}

export interface RenderSSRRequest {
  type: "render-ssr";
  id: string;
  /** Temp file path for the page component module */
  pageModulePath: string;
  /** Ordered layout module temp paths (innermost → outermost) */
  layoutModulePaths: string[];
  /** Page component props (JSON-serializable) */
  pageProps: Record<string, unknown>;
  /** Layout props keyed by layout index (matching layoutModulePaths order) */
  layoutProps: Record<string, unknown>[];
  /** Rendering delivery mode */
  delivery: "string" | "stream";
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
}

// ---------------------------------------------------------------------------
// Streaming SSR Protocol
// ---------------------------------------------------------------------------

export interface WorkerStreamChunk {
  type: "stream-chunk";
  id: string;
  chunk: Uint8Array;
}

export interface WorkerStreamEnd {
  type: "stream-end";
  id: string;
}

export type WorkerResponse =
  | WorkerResultResponse
  | WorkerRouteMethodsResponse
  | WorkerDataResultResponse
  | WorkerSSRResultResponse
  | WorkerPreparedModuleCapacityResponse
  | WorkerErrorResponse;

export interface WorkerSSRResultResponse {
  type: "ssr-result";
  id: string;
  html: string;
}

export interface WorkerResultResponse {
  type: "result";
  id: string;
  response: SerializedResponse;
}

export interface WorkerRouteMethodsResponse {
  type: "api-route-methods";
  id: string;
  methods: string[];
}

export interface WorkerDataResultResponse {
  type: "data-result";
  id: string;
  result: SerializedDataResult;
}

export interface WorkerErrorResponse {
  type: "error";
  id: string;
  error: SerializedError;
}

/**
 * Internal pre-execution rollover signal.
 *
 * The worker emits this only when a prepared API module cannot be reserved
 * within the current worker generation's retained-module limits. No project
 * module has been imported or executed for this request. The pool retires the
 * generation and may retry the request once in a fresh generation.
 */
export interface WorkerPreparedModuleCapacityResponse {
  type: "prepared-module-capacity";
  id: string;
}

// ---------------------------------------------------------------------------
// Worker Pool Configuration
// ---------------------------------------------------------------------------

export interface WorkerPoolConfig {
  /** Maximum number of concurrent workers (default: 20) */
  maxPoolSize: number;
  /** Idle timeout before evicting a worker (default: 300_000 = 5 minutes) */
  idleTimeoutMs: number;
  /** Per-request timeout inside the worker (default: 30_000) */
  requestTimeoutMs: number;
  /** Health check interval (default: 30_000) */
  healthCheckIntervalMs: number;
  /** Maximum requests before recycling a worker (default: 1000) */
  maxRequestsPerWorker: number;
  /** Maximum age of a worker in ms before recycling (default: 600_000 = 10 minutes) */
  maxWorkerAgeMs: number;
  /**
   * Legacy/advisory compatibility value (default: 64 MB).
   *
   * Same-process Workers cannot enforce a hard per-worker memory boundary:
   * retained ESM and top-level project allocations are process memory. Strong
   * containment requires process or container isolation.
   */
  memoryBudgetMb: number;
}

/** Maximum request body size for worker isolation (10 MB) */
export const MAX_WORKER_BODY_BYTES = 10 * 1024 * 1024;

/** Maximum UTF-8 size of one prepared API route module (4 MiB). */
export const MAX_WORKER_MODULE_SOURCE_BYTES = 4 * 1024 * 1024;

/** Maximum aggregate source retained by content-addressed API modules (16 MiB). */
export const MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES = 16 * 1024 * 1024;

/** Maximum number of distinct logical-route/source module identities per worker. */
export const MAX_WORKER_RETAINED_MODULES = 128;

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  maxPoolSize: 20,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 30_000,
  maxRequestsPerWorker: 1_000,
  maxWorkerAgeMs: 600_000,
  memoryBudgetMb: 64,
};
