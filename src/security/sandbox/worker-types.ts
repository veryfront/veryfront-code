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
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";

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
  /** Application identity snapshot admitted by the host boundary. */
  applicationIdentity?: ApplicationIdentity | null;
}

/**
 * Serialized DataResult — plain JSON, fully structured-cloneable.
 */
export interface SerializedDataResult {
  props?: unknown;
  redirect?: { destination: string; permanent?: boolean };
  notFound?: boolean;
  revalidate?: number | false;
  headers?: Record<string, string>;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  }>;
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
  /** App Router's public handler contract uses slash-flattened catch-all values. */
  params: Record<string, string>;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Immutable per-request project env snapshot exposed through the handler context. */
  projectEnv?: Record<string, string>;
  /** Required per-request application identity snapshot admitted by the host boundary. */
  applicationIdentity: ApplicationIdentity | null;
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
  /** Immutable per-request project env snapshot exposed through the handler context. */
  projectEnv?: Record<string, string>;
  /** Required per-request application identity snapshot admitted by the host boundary. */
  applicationIdentity: ApplicationIdentity | null;
}

export interface InspectApiRouteMethodsRequest {
  type: "inspect-api-route-methods";
  id: string;
  module: PreparedWorkerModule;
  /** Required logical route identity and bounded diagnostic; never imported by the worker. */
  modulePath: string;
  /** Optional custom-method probe used for default-export capability parity. */
  requestedMethod?: string;
  /** Whether method discovery includes the framework-provided OPTIONS fallback. */
  includeFrameworkOptions?: boolean;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Immutable per-request project env snapshot used in module semantics. */
  projectEnv?: Record<string, string>;
}

export interface FetchDataRequest {
  type: "fetch-data";
  id: string;
  modulePath: string;
  context: SerializedDataContext;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Immutable project env snapshot included in worker generation semantics. */
  projectEnv?: Record<string, string>;
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
  /**
   * Exact dependency snapshot selected by the host renderer.
   *
   * Omitted is the legacy flag-off wire shape. "off" is accepted explicitly;
   * enabled snapshots require the paired immutable dependency map.
   */
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
}

// ---------------------------------------------------------------------------
// Internal SSR Wire Protocol
// ---------------------------------------------------------------------------

/** @internal Opens one host-owned SSR execution on this worker generation. */
export interface WorkerSSRExecutionOpen {
  type: "ssr-execution-open";
  id: string;
  generation: string;
  token: string;
  delivery: "string" | "stream";
}

/** @internal Grants exactly one additional framework-owned SSR frame. */
export interface WorkerStreamCredit {
  type: "stream-credit";
  id: string;
  generation: string;
  token: string;
  sequence: number;
}

/** @internal One fixed, tightly owned framework SSR frame. */
export interface WorkerStreamFrame {
  type: "stream-frame";
  id: string;
  generation: string;
  token: string;
  sequence: number;
  chunk: Uint8Array;
}

/** @internal Successful terminal message for streaming delivery. */
export interface WorkerStreamEnd {
  type: "stream-end";
  id: string;
  generation: string;
  token: string;
  sequence: number;
}

/** @internal Successful terminal message for string delivery. */
export interface WorkerSSRWireResult {
  type: "ssr-wire-result";
  id: string;
  generation: string;
  token: string;
  sequence: number;
  html: string;
}

/** @internal Bounded worker-side SSR output failure. */
export interface WorkerSSROutputLimit {
  type: "ssr-output-limit";
  id: string;
  generation: string;
  token: string;
  sequence: number;
  limit: "bytes" | "chunks";
}

/** @internal Token-bound SSR failure serialized by the worker. */
export interface WorkerSSRWireError {
  type: "ssr-wire-error";
  id: string;
  generation: string;
  token: string;
  sequence: number;
  error: SerializedError;
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
  /**
   * Absolute wall-clock request deadline, including stream backpressure
   * (default: 30_000).
   */
  requestTimeoutMs: number;
  /** Health check interval (default: 30_000) */
  healthCheckIntervalMs: number;
  /** Maximum requests before recycling a worker (default: 1000) */
  maxRequestsPerWorker: number;
  /** Maximum age of a worker in ms before recycling (default: 600_000 = 10 minutes) */
  maxWorkerAgeMs: number;
  /** Host-owned snapshot allowing internal network egress (default: false). */
  allowInternalEgress?: boolean;
}

/** Maximum request body size for worker isolation (10 MB) */
export const MAX_WORKER_BODY_BYTES = 10 * 1024 * 1024;

/** Compatibility boundary: isolated SSR rejects HTML above 16 MiB. */
export const MAX_WORKER_SSR_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Maximum chunks one isolated streaming SSR request may emit. */
export const MAX_WORKER_SSR_OUTPUT_CHUNKS = 16_384;

/** Maximum bytes accepted in one isolated streaming SSR chunk (1 MiB). */
export const MAX_WORKER_SSR_CHUNK_BYTES = 1024 * 1024;

/** Maximum number of UTF-16 code units in one worker protocol request ID. */
export const MAX_WORKER_REQUEST_ID_CHARS = 256;

/** Maximum UTF-8 size of one prepared API route module (4 MiB). */
export const MAX_WORKER_MODULE_SOURCE_BYTES = 4 * 1024 * 1024;

/** Maximum aggregate source retained by content-addressed API modules (16 MiB). */
export const MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES = 16 * 1024 * 1024;

/** Maximum number of distinct logical-route/source module identities per worker. */
export const MAX_WORKER_RETAINED_MODULES = 128;

export const DEFAULT_WORKER_POOL_CONFIG: Readonly<Required<WorkerPoolConfig>> = Object.freeze({
  maxPoolSize: 20,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 30_000,
  maxRequestsPerWorker: 1_000,
  maxWorkerAgeMs: 600_000,
  allowInternalEgress: false,
});
