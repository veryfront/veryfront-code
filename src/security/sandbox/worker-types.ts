/**
 * Worker Isolation Types
 *
 * Shared type definitions for the worker isolation system.
 * Used by both the main process and worker script.
 *
 * @module security/sandbox/worker-types
 */

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
  /** RFC 9457 fields if the error originated from VFError */
  type?: string;
  status?: number;
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

export type WorkerRequest =
  | ExecuteAppRouteRequest
  | ExecutePagesRouteRequest
  | FetchDataRequest
  | RenderSSRRequest;

export interface ExecuteAppRouteRequest {
  type: "execute-app-route";
  id: string;
  modulePath: string;
  method: string;
  request: SerializedRequest;
  params: Record<string, string | string[]>;
  projectDir: string;
  /** Per-project env var overlay for multi-tenant proxy mode */
  projectEnv?: Record<string, string>;
}

export interface ExecutePagesRouteRequest {
  type: "execute-pages-route";
  id: string;
  modulePath: string;
  method: string;
  context: SerializedPagesContext;
  projectDir: string;
  /** Per-project env var overlay for multi-tenant proxy mode */
  projectEnv?: Record<string, string>;
}

export interface FetchDataRequest {
  type: "fetch-data";
  id: string;
  modulePath: string;
  context: SerializedDataContext;
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
  | WorkerDataResultResponse
  | WorkerSSRResultResponse
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
  /** Per-worker memory budget in MB (default: 64). Workers exceeding this are evicted. */
  memoryBudgetMb: number;
}

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  maxPoolSize: 20,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 30_000,
  maxRequestsPerWorker: 1_000,
  maxWorkerAgeMs: 600_000,
  memoryBudgetMb: 64,
};
