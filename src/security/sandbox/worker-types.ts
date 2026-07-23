/**
 * Worker Isolation Types
 *
 * Shared type definitions for the worker isolation system.
 * Used by both the main process and worker script.
 *
 * @module security/sandbox/worker-types
 */

import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { AgentRunExecutionBundle } from "./agent-run-worker-contract.ts";

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
  slug?: string;
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
  | RenderSSRRequest
  | GenerateOpenAPISpecRequest
  | ExecuteProjectRunRequest
  | ExecuteAgentRunRequest;

/** Start one streaming agent run in a fresh, non-reused project Worker. */
export interface ExecuteAgentRunRequest {
  type: "execute-agent-run";
  id: string;
  bundle: AgentRunExecutionBundle;
  initialCreditBytes: number;
}

export interface ExecuteAppRouteRequest {
  type: "execute-app-route";
  id: string;
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
  modulePath: string;
  method: string;
  context: SerializedPagesContext;
  projectDir: string;
  /** Exact source-owned integration policy for this project execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Per-project env var overlay for multi-tenant proxy mode */
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

export interface OpenAPIWorkerModule {
  pattern: string;
  moduleCode: string;
}

export interface GenerateOpenAPISpecRequest {
  type: "generate-openapi-spec";
  id: string;
  projectDir: string;
  routes: OpenAPIWorkerModule[];
  info: {
    title: string;
    version: string;
    description?: string;
    servers: Array<{ url: string; description?: string }>;
  };
  /** Exact source-owned integration policy for module evaluation. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Per-project env var overlay for module initialization. */
  projectEnv?: Record<string, string>;
}

/** One bundled project definition module evaluated only inside a Worker. */
export interface ProjectRunWorkerModule {
  /** Discovery file identity used to derive the definition id. */
  file: string;
  /** Discovery root containing the module. */
  dir: string;
  /** Self-contained ESM produced without importing the module in the host. */
  moduleCode: string;
}

/** A bounded project data file available to an isolated eval dataset loader. */
export interface ProjectRunWorkerDatasetFile {
  /** Canonical project-relative path. */
  path: string;
  /** UTF-8 JSON or JSONL content. */
  content: string;
}

/** Structured-cloneable subset of the agent-service eval adapter configuration. */
export interface ProjectRunWorkerEvalAgentAdapter {
  endpoint: string;
  authToken: string;
  agentId?: string;
  projectId?: string;
  projectSlug?: string;
  releaseId?: string;
  contentSourceId?: string;
  branchId?: string;
  branchName?: string;
  environment?: string;
  environmentId?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  model?: string;
  allowedTools?: string[];
  maxSteps?: number;
}

interface ExecuteProjectRunRequestBase {
  type: "execute-project-run";
  id: string;
  projectDir: string;
  targetId: string;
  modules: ProjectRunWorkerModule[];
  config: Record<string, unknown>;
  datasetFiles: ProjectRunWorkerDatasetFile[];
  /** Exact source-owned integration policy for module evaluation and execution. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Exact per-request project environment overlay. */
  projectEnv?: Record<string, string>;
}

export interface ExecuteProjectTaskRunRequest extends ExecuteProjectRunRequestBase {
  kind: "task";
  projectId: string;
  environmentId?: string;
  debug: boolean;
}

export interface ExecuteProjectEvalRunRequest extends ExecuteProjectRunRequestBase {
  kind: "eval";
  runId: string;
  evalAgentAdapter: ProjectRunWorkerEvalAgentAdapter;
}

/** Execute one project task or eval in an ephemeral isolation Worker. */
export type ExecuteProjectRunRequest =
  | ExecuteProjectTaskRunRequest
  | ExecuteProjectEvalRunRequest;

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
  | WorkerOpenAPIResultResponse
  | WorkerProjectRunResultResponse
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

export interface WorkerOpenAPIResultResponse {
  type: "openapi-result";
  id: string;
  /** Untrusted process-boundary value. The consumer must validate it. */
  spec: unknown;
}

/** JSON-detached result returned by isolated task and eval execution. */
export interface SerializedProjectRunResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkerProjectRunResultResponse {
  type: "project-run-result";
  id: string;
  result: SerializedProjectRunResult;
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
  /**
   * Legacy advisory value reported in pool statistics. Deno does not expose a
   * per-Worker heap limit, so this value is not enforced.
   * @deprecated Do not rely on this value as an isolation boundary.
   */
  memoryBudgetMb: number;
}

/** Maximum request body size for worker isolation (10 MB) */
export const MAX_WORKER_BODY_BYTES = 10 * 1024 * 1024;

/** Maximum buffered response body size transferred out of worker isolation (16 MB). */
export const MAX_WORKER_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;

/** Bounds the executable module payload accepted by OpenAPI worker requests. */
export const MAX_OPENAPI_WORKER_ROUTES = 10_000;
export const MAX_OPENAPI_WORKER_MODULE_BYTES = 10 * 1024 * 1024;
export const MAX_OPENAPI_WORKER_TOTAL_MODULE_BYTES = 16 * 1024 * 1024;

/** Bounds project-run code, data, configuration, environment, and output transfers. */
export const MAX_PROJECT_RUN_WORKER_MODULES = 10_000;
export const MAX_PROJECT_RUN_WORKER_MODULE_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_RUN_WORKER_TOTAL_MODULE_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_RUN_WORKER_DATASET_FILES = 10_000;
export const MAX_PROJECT_RUN_WORKER_DATASET_BYTES = 32 * 1024 * 1024;
export const MAX_PROJECT_RUN_WORKER_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_RUN_WORKER_ENV_ENTRIES = 10_000;
export const MAX_PROJECT_RUN_WORKER_ENV_BYTES = 16 * 1024 * 1024;

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  maxPoolSize: 20,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 30_000,
  maxRequestsPerWorker: 1_000,
  maxWorkerAgeMs: 600_000,
  memoryBudgetMb: 64,
};
