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
  | FetchDataRequest;

export interface ExecuteAppRouteRequest {
  type: "execute-app-route";
  id: string;
  modulePath: string;
  method: string;
  request: SerializedRequest;
}

export interface ExecutePagesRouteRequest {
  type: "execute-pages-route";
  id: string;
  modulePath: string;
  method: string;
  context: SerializedPagesContext;
  projectDir: string;
}

export interface FetchDataRequest {
  type: "fetch-data";
  id: string;
  modulePath: string;
  context: SerializedDataContext;
}

export type WorkerResponse =
  | WorkerResultResponse
  | WorkerDataResultResponse
  | WorkerErrorResponse;

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
}

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  maxPoolSize: 20,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 30_000,
  maxRequestsPerWorker: 1_000,
};
