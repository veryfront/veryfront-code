import {
  API_CLIENT_ERROR,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import { getEnvironmentConfig } from "#veryfront/config";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import {
  assertStyleArtifactResolutionTuple,
  createStyleArtifactTuple,
  STYLE_ARTIFACT_CONTENT_TYPE,
  type StyleArtifactSelector,
  type StyleArtifactTuple,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { StyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import {
  captureProjectStyleSourceSnapshot,
  createProjectStyleSourceSnapshot,
  type ProjectStyleSourceFileSnapshot,
  type ProjectStyleSourceSnapshot,
  snapshotProjectStyleSourceFiles,
} from "#veryfront/html/styles-builder/project-style-source-snapshot.ts";
import { MAX_CSS_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { buildConfigCacheKey } from "#veryfront/cache/keys.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import { findProjectRuntimeTask } from "#veryfront/task/project-runtime.ts";
import { runTask, type RunTaskOptions, type TaskRunResult } from "#veryfront/task/runner.ts";
import { type DiscoveredEval, findEvalById } from "#veryfront/eval/discovery.ts";
import { runEval } from "#veryfront/eval/runner.ts";
import {
  type AgentServiceEvalAdapterConfig,
  createAgentServiceEvalAdapter,
} from "#veryfront/eval/agent-service.ts";
import { createAgUiHandler } from "#veryfront/agent/ag-ui/handler.ts";
import type {
  EvalAgentAdapter,
  EvalDefinition,
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  RunEvalOptions,
} from "#veryfront/eval/types.ts";
import type { Logger } from "#veryfront/utils";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { type DiscoveredWorkflow, findWorkflowById } from "#veryfront/workflow/discovery";
import { createDistributedWorkflowBackend, createWorkflowClient } from "#veryfront/workflow";
import type { WorkflowClientConfig } from "#veryfront/workflow";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { ensureProjectDiscovery } from "./api/project-discovery.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { BaseHandler } from "../response/base.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";

const EXECUTE_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/execute$/;
const DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS = 100;
const DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_LOCAL_AG_UI_PORT = 3001;
const WORKFLOW_PERSISTENCE_REQUIRED_ERROR =
  "Workflow paused but runtime workflow persistence is not configured";

export interface ProjectRunExecuteRequest {
  runId: string;
  kind: "task" | "workflow" | "eval";
  target: string;
  projectId: string;
  runtimeAgUiEndpoint?: string;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch";
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
  config?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

export interface ProjectRunExecuteResponse {
  success: boolean;
  result?: unknown;
  logs?: string | null;
  error?: string | null;
  duration_ms?: number;
  artifacts?: unknown[];
}

interface EvalReportUploadInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  report: EvalReport;
  projectReference: string;
  reportPath: string;
}

interface WorkflowRunView {
  status: string;
  output?: unknown;
  error?: { message?: string } | null;
}

interface WorkflowStartHandle {
  runId: string;
  settled?(): Promise<void>;
}

interface WorkflowClientView {
  readonly statePersistence?: "durable" | "ephemeral";
  register(workflow: unknown): void;
  start(
    workflowId: string,
    input: unknown,
    options?: { runId?: string },
  ): Promise<WorkflowStartHandle>;
  getRun(runId: string): Promise<WorkflowRunView | null>;
  destroy(): Promise<void>;
}

export interface ProjectRunExecuteHandlerDeps {
  runTask(options: RunTaskOptions): Promise<TaskRunResult>;
  findWorkflowById(
    workflowId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
    },
  ): Promise<DiscoveredWorkflow | null>;
  findEvalById(
    evalId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
    },
  ): Promise<DiscoveredEval | null>;
  createWorkflowClient(
    config?: WorkflowClientConfig,
  ): WorkflowClientView | Promise<WorkflowClientView>;
  runEval(definition: EvalDefinition, options: RunEvalOptions): Promise<EvalReport>;
  createEvalAgentAdapter(config: AgentServiceEvalAdapterConfig): EvalAgentAdapter;
  uploadEvalReport(input: EvalReportUploadInput): Promise<string | null>;
  ensureProjectDiscovery(ctx: HandlerContext): Promise<DiscoveryResult>;
  executeKnowledgeIngest(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
  }): Promise<ProjectRunExecuteResponse>;
  executeReleaseAssetBuild(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
  }): Promise<ProjectRunExecuteResponse>;
  executeStyleArtifactBuild(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
  }): Promise<ProjectRunExecuteResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });
  return value;
}

function parseOptionalUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
    }
    return url.toString();
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
}

function parseRuntimeTargetKind(value: unknown): ProjectRunExecuteRequest["runtimeTargetKind"] {
  if (value === undefined || value === null) return undefined;
  if (value === "main_branch" || value === "environment" || value === "preview_branch") {
    return value;
  }
  throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtimeTargetKind" });
}

function parseOptionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
  return value;
}

function parseExecuteRequest(value: unknown, pathRunId: string): ProjectRunExecuteRequest {
  if (!isRecord(value)) throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });

  const runId = value.runId;
  const kind = value.kind;
  const target = value.target;
  const projectId = value.projectId;

  if (typeof runId !== "string" || !runId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runId" });
  }
  if (runId !== pathRunId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Run id does not match request path" });
  }
  if (kind !== "task" && kind !== "workflow" && kind !== "eval") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid run kind" });
  }
  if (typeof target !== "string" || !target) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid target" });
  }
  if (typeof projectId !== "string" || !projectId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid projectId" });
  }
  if (kind === "task" && !target.startsWith("task:")) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid task target" });
  }
  if (kind === "workflow" && !target.startsWith("workflow:")) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid workflow target" });
  }
  if (kind === "eval" && !target.startsWith("eval:")) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid eval target" });
  }

  return {
    runId,
    kind,
    target,
    projectId,
    runtimeAgUiEndpoint: parseOptionalUrl(value.runtimeAgUiEndpoint, "runtimeAgUiEndpoint"),
    runtimeTargetKind: parseRuntimeTargetKind(value.runtimeTargetKind),
    runtimeTargetEnvironmentId: parseOptionalNullableString(
      value.runtimeTargetEnvironmentId,
      "runtimeTargetEnvironmentId",
    ),
    runtimeTargetBranchId: parseOptionalNullableString(
      value.runtimeTargetBranchId,
      "runtimeTargetBranchId",
    ),
    config: parseRecord(value.config),
    input: parseRecord(value.input),
  };
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/^eval:/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function buildEvalReportPath(report: EvalReport, request: ProjectRunExecuteRequest): string {
  const evalId = sanitizePathSegment(report.definitionId || request.target, "eval");
  const runId = sanitizePathSegment(request.runId, "run");
  return `evals/reports/${evalId}/${runId}.json`;
}

function createEvalReportArtifact(path: string): Record<string, string> {
  return { kind: "eval-report", path, contentType: "application/json" };
}

function getRunId(pathname: string): string | null {
  return EXECUTE_PATH_REGEX.exec(pathname)?.[1] ?? null;
}

function stripTargetPrefix(target: string, prefix: "task:" | "workflow:"): string {
  return target.slice(prefix.length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createExecutionFailure(error: unknown, durationMs: number): ProjectRunExecuteResponse {
  return {
    success: false,
    error: errorMessage(error),
    logs: null,
    duration_ms: durationMs,
  };
}

async function createRuntimeWorkflowClient(
  config?: WorkflowClientConfig,
): Promise<WorkflowClientView> {
  const clientConfig = withRuntimeStepRegistries(config);
  const persistence = getHostEnv("VERYFRONT_WORKFLOW_PERSISTENCE")?.trim() || "ephemeral";
  if (persistence !== "ephemeral" && persistence !== "distributed") {
    throw new TypeError(
      "VERYFRONT_WORKFLOW_PERSISTENCE must be ephemeral or distributed",
    );
  }
  if (persistence === "ephemeral") {
    return Object.assign(createWorkflowClient(clientConfig), {
      statePersistence: "ephemeral" as const,
    });
  }

  const backend = createDistributedWorkflowBackend({
    debug: config?.debug,
  });
  if (backend.initialize) {
    await backend.initialize();
  }

  return Object.assign(createWorkflowClient({ ...clientConfig, backend, debug: config?.debug }), {
    statePersistence: "durable" as const,
  });
}

function withRuntimeStepRegistries(config?: WorkflowClientConfig): WorkflowClientConfig {
  return {
    ...config,
    executor: {
      ...config?.executor,
      stepExecutor: {
        ...config?.executor?.stepExecutor,
        agentRegistry: config?.executor?.stepExecutor?.agentRegistry ?? agentRegistry,
        toolRegistry: config?.executor?.stepExecutor?.toolRegistry ?? toolRegistry,
      },
    },
  };
}

async function executeTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const taskId = stripTargetPrefix(request.target, "task:");
  if (taskId === "knowledge-ingest") {
    throw NOT_SUPPORTED.create({
      detail: "Knowledge ingest must be executed through the knowledge ingest executor",
    });
  }

  const discovery = await deps.ensureProjectDiscovery(ctx);
  const task = findProjectRuntimeTask(discovery, taskId);

  if (!task) {
    return {
      success: false,
      error: `Task not found: ${taskId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const result = await deps.runTask({
    task,
    config: request.config ?? {},
    projectId: request.projectId,
    environmentId: request.runtimeTargetEnvironmentId === undefined
      ? ctx.environmentId
      : request.runtimeTargetEnvironmentId ?? undefined,
    signal,
    debug: ctx.debug,
  });

  return {
    success: result.success,
    result: result.result,
    error: result.error,
    duration_ms: result.durationMs,
    logs: null,
  };
}

async function waitForWorkflowResult(
  client: WorkflowClientView,
  runId: string,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<WorkflowRunView> {
  const deadline = deps.now() + DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS;

  while (true) {
    const run = await client.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Workflow run not found: ${runId}` });

    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled" ||
      run.status === "waiting"
    ) {
      return run;
    }

    if (deps.now() >= deadline) {
      throw TIMEOUT_ERROR.create({ detail: `Workflow run timed out: ${runId}` });
    }

    await deps.sleep(DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS);
  }
}

async function executeWorkflowRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = deps.now();
  const workflowId = stripTargetPrefix(request.target, "workflow:");
  await deps.ensureProjectDiscovery(ctx);
  const workflow = await deps.findWorkflowById(workflowId, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
  });

  if (!workflow) {
    return {
      success: false,
      error: `Workflow not found: ${workflowId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const client = await deps.createWorkflowClient(withRuntimeStepRegistries({ debug: ctx.debug }));
  try {
    client.register(workflow.definition);
    const handle = await client.start(workflow.id, request.input ?? {}, { runId: request.runId });
    const run = await waitForWorkflowResult(client, handle.runId, deps);
    await handle.settled?.();
    const durationMs = Math.max(0, deps.now() - startedAt);

    if (run.status === "waiting") {
      if (client.statePersistence !== "durable") {
        return {
          success: false,
          error: WORKFLOW_PERSISTENCE_REQUIRED_ERROR,
          logs: null,
          duration_ms: durationMs,
        };
      }

      return {
        success: true,
        result: run.output,
        logs: null,
        duration_ms: durationMs,
      };
    }

    if (run.status === "completed") {
      return {
        success: true,
        result: run.output,
        logs: null,
        duration_ms: durationMs,
      };
    }

    return {
      success: false,
      result: run.output,
      error: run.error?.message ?? `Workflow ended with status: ${run.status}`,
      logs: null,
      duration_ms: durationMs,
    };
  } finally {
    await client.destroy();
  }
}

interface RuntimeApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

function getRuntimeApiToken(req: Request, ctx: HandlerContext): string {
  return req.headers.get("x-token") ?? ctx.proxyToken ?? ctx.requestContext?.token ?? "";
}

function isRequestSiblingAgUiEndpoint(endpoint: string, req: Request): boolean {
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname !== "/api/ag-ui") return false;
    return endpointUrl.origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLocalAgUiEndpoint(endpoint: string): boolean {
  try {
    return isLocalHostname(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

interface ManagedProjectAgUiEndpointContext {
  forwardedHost: string;
  forwardedProto: string;
  environment: "preview" | "production";
  branchName: string | undefined;
}

function getManagedProjectAgUiEndpointContext(
  endpoint?: string,
  projectSlug?: string,
): ManagedProjectAgUiEndpointContext | null {
  if (!endpoint || !projectSlug) return null;
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname !== "/api/ag-ui") return null;
    const parsed = parseProjectDomain(endpointUrl.host);
    if (!parsed.isVeryfrontDomain || parsed.slug !== projectSlug) return null;
    return {
      forwardedHost: endpointUrl.host,
      forwardedProto: endpointUrl.protocol.replace(/:$/, ""),
      environment: parsed.environment === "preview" ? "preview" : "production",
      branchName: parsed.branch ?? undefined,
    };
  } catch {
    return null;
  }
}

function getRuntimeLocalPort(req: Request): number {
  const url = new URL(req.url);
  const requestPort = isLocalHostname(url.hostname) ? url.port : "";
  for (const value of [getHostEnv("PORT"), getHostEnv("VERYFRONT_PORT"), requestPort]) {
    if (!value) continue;
    const port = Number.parseInt(value, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  }
  return DEFAULT_LOCAL_AG_UI_PORT;
}

function getLocalAgUiEndpoint(req: Request): string {
  return `http://127.0.0.1:${getRuntimeLocalPort(req)}/api/ag-ui`;
}

function resolveEvalAgUiEndpoint(
  req: Request,
  endpoint?: string,
  projectSlug?: string,
): string {
  if (!endpoint) {
    return getLocalAgUiEndpoint(req);
  }
  const shouldUseLocalEndpoint = isRequestSiblingAgUiEndpoint(endpoint, req) ||
    !!getManagedProjectAgUiEndpointContext(endpoint, projectSlug) ||
    isLocalAgUiEndpoint(endpoint);
  if (!shouldUseLocalEndpoint) {
    return endpoint;
  }
  return getLocalAgUiEndpoint(req);
}

function createLocalEvalAgentFetch(input: {
  endpoint: string;
  agentId?: string;
}): AgentServiceEvalAdapterConfig["fetch"] | undefined {
  if (!input.agentId || !isLocalAgUiEndpoint(input.endpoint)) return undefined;

  const agent = agentRegistry.get(input.agentId);
  if (!agent) return undefined;

  const handler = createAgUiHandler({ agent });
  return async (requestInput, init) => {
    const request = new Request(requestInput, init);
    if (!isLocalAgUiEndpoint(request.url)) return fetch(request);
    return await handler(request);
  };
}

function getEndpointHost(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

function getEndpointProtocol(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).protocol.replace(/:$/, "");
  } catch {
    return undefined;
  }
}

function createRuntimeApiClient(req: Request, ctx: HandlerContext): RuntimeApiClient {
  const apiUrl = getEnvironmentConfig().apiBaseUrl;
  const token = getRuntimeApiToken(req, ctx);
  if (!token) {
    throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
  }

  async function requestJson<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw API_CLIENT_ERROR.create({
        detail: `Veryfront API request failed: ${response.status} ${response.statusText}`,
      });
    }

    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  return {
    get<T>(path: string, params?: Record<string, string>): Promise<T> {
      return requestJson<T>("GET", path, undefined, params);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return requestJson<T>("POST", path, body);
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return requestJson<T>("PUT", path, body);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return requestJson<T>("PATCH", path, body);
    },
    delete<T>(path: string): Promise<T> {
      return requestJson<T>("DELETE", path);
    },
  };
}

async function uploadEvalReportToProjectFiles(
  input: EvalReportUploadInput,
): Promise<string | null> {
  const client = createRuntimeApiClient(input.req, input.ctx);
  const encodedProject = encodeURIComponent(input.projectReference);
  const encodedPath = encodeURIComponent(input.reportPath);
  const reportWithPath = { ...input.report, reportPath: input.reportPath };
  const response = await client.put<{ path?: string }>(
    `/projects/${encodedProject}/files/${encodedPath}`,
    { content: `${JSON.stringify(reportWithPath, null, 2)}\n` },
  );
  return response.path ?? input.reportPath;
}

function getStringArrayConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }
  }

  return [];
}

function getStringConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

async function resolveUploadIdsToPaths(
  client: RuntimeApiClient,
  projectReference: string,
  uploadIds: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const uploadId of uploadIds) {
    const upload = await client.get<{ path?: string }>(
      `/projects/${encodeURIComponent(projectReference)}/uploads/${encodeURIComponent(uploadId)}`,
    );
    if (!upload.path) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Upload not found: ${uploadId}` });
    }
    paths.push(upload.path);
  }
  return paths;
}

function createKnowledgeEventLogger(lines: string[]): Logger {
  const append = (level: string, message: string, metadata?: Record<string, unknown>) => {
    lines.push(JSON.stringify({ level, message, ...(metadata ?? {}) }));
  };
  const logger: Logger = {
    info: (message: string, metadata?: Record<string, unknown>) =>
      append("info", message, metadata),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      append("warn", message, metadata),
    error: (message: string, metadata?: Record<string, unknown>) =>
      append("error", message, metadata),
    debug: (message: string, metadata?: Record<string, unknown>) =>
      append("debug", message, metadata),
    async time<T>(_label: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    child: () => logger,
    component: () => logger,
  };
  return logger;
}

async function executeKnowledgeIngestRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const client = createRuntimeApiClient(input.req, input.ctx);
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const outputDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-run-" });
  const logLines: string[] = [];

  try {
    const {
      buildKnowledgeIngestRunResult,
    } = await import("#cli/commands/knowledge/result");
    const {
      collectKnowledgeSources,
      ingestResolvedSources,
      resolveKnowledgeDownloadOutputDir,
      runKnowledgeParser,
    } = await import("#cli/commands/knowledge/command");
    const { downloadUploadToFile } = await import("#cli/commands/uploads/command");
    const { putRemoteFileFromLocal } = await import("#cli/commands/files/command");

    const uploadIds = getStringArrayConfig(config, ["upload_ids", "uploadIds"]);
    const paths = getStringArrayConfig(config, ["paths", "upload_paths", "uploadPaths"]);
    const uploadPaths = [
      ...paths,
      ...await resolveUploadIdsToPaths(client, projectReference, uploadIds),
    ];
    const pathPrefix = getStringConfig(config, [
      "path_prefix",
      "upload_prefix",
      "pathPrefix",
      "uploadPrefix",
    ]);
    const knowledgePath = getStringConfig(config, ["knowledge_path", "knowledgePath"]) ??
      "knowledge";
    const description = getStringConfig(config, ["description"]);
    const recursive = config.recursive === undefined ? true : Boolean(config.recursive);

    if (uploadPaths.length > 0 && pathPrefix) {
      throw INVALID_ARGUMENT.create({ detail: "Use upload paths or upload prefix, not both." });
    }

    const options = {
      projectSlug: projectReference,
      projectDir: input.ctx.projectDir,
      sources: uploadPaths,
      path: pathPrefix,
      all: pathPrefix !== undefined,
      recursive,
      outputDir,
      knowledgePath,
      description,
      slug: getStringConfig(config, ["slug"]),
      json: true,
      quiet: true,
    };
    const downloadOutputDir = resolveKnowledgeDownloadOutputDir(outputDir);
    const sourceMode = pathPrefix ? "path_prefix" : "explicit_sources";
    const collection = await collectKnowledgeSources(options, {
      client,
      projectSlug: projectReference,
      downloadUploads: (uploadTargets) =>
        Promise.all(
          uploadTargets.map((uploadPath) =>
            downloadUploadToFile(client, projectReference, uploadPath, downloadOutputDir)
          ),
        ),
    });
    const requestedCount = collection.sources.length + collection.skipped.length;
    if (requestedCount === 0) {
      throw INVALID_ARGUMENT.create({ detail: "No supported knowledge sources were found." });
    }

    const results = await ingestResolvedSources(collection.sources, options, {
      client,
      projectSlug: projectReference,
      outputDir,
      runParser: runKnowledgeParser,
      eventLogger: createKnowledgeEventLogger(logLines),
      uploadKnowledgeFile: (remotePath, localPath) =>
        putRemoteFileFromLocal(client, projectReference, remotePath, localPath),
    });
    const result = buildKnowledgeIngestRunResult({
      requestedCount,
      sourceMode,
      knowledgePath,
      ingested: results.ingested,
      skipped: collection.skipped,
      failed: results.failed,
    });
    const failedCount = result.summary.failed_count;
    const ingestedCount = result.summary.ingested_count;

    return {
      success: failedCount === 0 && ingestedCount > 0,
      result,
      error: failedCount > 0
        ? `${failedCount} knowledge source${failedCount === 1 ? "" : "s"} failed`
        : ingestedCount === 0
        ? "No knowledge sources were ingested"
        : null,
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => undefined);
  }
}

function getNumberConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getPositiveIntConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const value = getNumberConfig(config, keys);
  if (value === undefined) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function isBlockingEvalResult(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function evalRecordFailed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return true;
  return [...(record.metrics ?? []), ...(record.checks ?? [])].some(isBlockingEvalResult);
}

function countFailedEvalRecords(report: EvalReport): number {
  return report.records.filter(evalRecordFailed).length;
}

function withEvalRunConfig(
  definition: EvalDefinition,
  config: Record<string, unknown>,
): EvalDefinition {
  const repetitions = getPositiveIntConfig(config, ["repetitions", "repeat", "repetitionCount"]);
  if (repetitions === undefined || repetitions === definition.repetitions) {
    return definition;
  }

  return {
    ...definition,
    repetitions,
  };
}

function getEvalTargetAgentId(definition: EvalDefinition): string | undefined {
  if (definition.targetKind !== "agent") return undefined;
  const target = definition.target.startsWith("agent:")
    ? definition.target.slice("agent:".length)
    : definition.target;
  return target.length > 0 ? target : undefined;
}

function createEvalAdapterConfig(input: {
  request: ProjectRunExecuteRequest;
  definition: EvalDefinition;
  req: Request;
  ctx: HandlerContext;
}): AgentServiceEvalAdapterConfig {
  const config = input.request.config ?? {};
  const authToken = getRuntimeApiToken(input.req, input.ctx);
  if (!authToken) {
    throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
  }
  const managedEndpointContext = getManagedProjectAgUiEndpointContext(
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  const endpoint = resolveEvalAgUiEndpoint(
    input.req,
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  const agentId = getEvalTargetAgentId(input.definition);
  const branchId = input.request.runtimeTargetBranchId ?? undefined;
  const environmentId = input.request.runtimeTargetEnvironmentId === undefined
    ? input.ctx.environmentId
    : input.request.runtimeTargetEnvironmentId ?? undefined;

  return {
    endpoint,
    authToken,
    agentId,
    projectId: input.request.projectId,
    projectSlug: input.ctx.projectSlug,
    releaseId: input.ctx.releaseId,
    contentSourceId: input.ctx.enriched?.contentSourceId,
    branchId,
    branchName: managedEndpointContext
      ? managedEndpointContext.branchName
      : input.ctx.requestContext?.branch ?? undefined,
    environment: managedEndpointContext?.environment ?? input.ctx.resolvedEnvironment,
    environmentId,
    forwardedHost: managedEndpointContext?.forwardedHost ??
      getEndpointHost(input.request.runtimeAgUiEndpoint),
    forwardedProto: managedEndpointContext?.forwardedProto ??
      getEndpointProtocol(input.request.runtimeAgUiEndpoint),
    model: getStringConfig(config, ["model"]),
    allowedTools: getStringArrayConfig(config, ["allowed_tools", "allowedTools"]),
    maxSteps: getPositiveIntConfig(config, ["max_steps", "maxSteps"]),
    fetch: createLocalEvalAgentFetch({ endpoint, agentId }),
  };
}

async function executeEvalRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = deps.now();
  await deps.ensureProjectDiscovery(ctx);
  const evalItem = await deps.findEvalById(request.target, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
  });

  if (!evalItem) {
    return {
      success: false,
      error: `Eval not found: ${request.target}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const config = request.config ?? {};
  const report = await deps.runEval(withEvalRunConfig(evalItem.definition, config), {
    adapters: {
      agent: deps.createEvalAgentAdapter(
        createEvalAdapterConfig({ request, definition: evalItem.definition, req, ctx }),
      ),
    },
    baseDir: ctx.projectDir,
    runId: request.runId,
  });
  const failed = Math.max(report.summary.failed, countFailedEvalRecords(report));
  const projectReference = ctx.projectSlug ?? request.projectId;
  const requestedReportPath = buildEvalReportPath(report, request);
  let uploadError: string | null = null;
  const reportPath = await deps.uploadEvalReport({
    request,
    ctx,
    req,
    report,
    projectReference,
    reportPath: requestedReportPath,
  }).catch((error) => {
    uploadError = `Eval report upload failed: ${errorMessage(error)}`;
    return null;
  });
  const result = reportPath ? { ...report, reportPath } : report;

  return {
    success: failed === 0,
    result,
    ...(reportPath ? { artifacts: [createEvalReportArtifact(reportPath)] } : {}),
    ...(failed > 0 ? { error: `${failed} eval record${failed === 1 ? "" : "s"} failed` } : {}),
    logs: uploadError,
    duration_ms: Math.max(0, deps.now() - startedAt),
  };
}

async function executeReleaseAssetBuildRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const releaseId = getStringConfig(config, ["release_id", "releaseId"]);
  const releaseVersion = getNumberConfig(config, ["release_version", "releaseVersion"]);
  const tempDir = await Deno.makeTempDir({ prefix: "veryfront-release-assets-" });
  let response: ProjectRunExecuteResponse;

  try {
    if (!releaseId || releaseVersion === undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing release_id or release_version for release asset build",
      });
    }

    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const { runReleaseAssetBuild } = await import("#veryfront/release-assets/build-executor.ts");
    const { transformToESM } = await import("#veryfront/transforms/esm-transform.ts");
    const { createCompileProjectCss } = await import(
      "#veryfront/release-assets/css-compile.ts"
    );
    const { evaluateHostedConfigSource } = await import("#veryfront/config/loader.ts");

    const apiBaseUrl = getEnvironmentConfig().apiBaseUrl;
    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    const apiClient = new VeryfrontApiClient({
      apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    const releaseVersionRef = releaseId;

    // Production CSS compiler: compiles the project's configured CSS in-runtime
    // through the provider-neutral `generateCSS` primitive. It returns null only
    // when the release has no stylesheet and no candidates; invalid input and
    // compilation failures propagate so the release fails closed.
    const compileProjectCss = createCompileProjectCss({
      projectScope: projectReference,
    });

    const result = await runReleaseAssetBuild({
      projectReference,
      projectId: input.ctx.projectId ?? input.request.projectId,
      releaseId,
      releaseVersion,
      releaseVersionRef,
      adapter: input.ctx.adapter,
      dependencyMode: "source",
      transform: (source, sourceFile, projectDir, adapter, options) =>
        transformToESM(source, sourceFile, projectDir, adapter, {
          projectId: options.projectId,
          dev: options.dev,
          ssr: options.ssr,
          studioEmbed: false,
          reactVersion: options.reactVersion,
        }),
      loadConfig: (source) =>
        evaluateHostedConfigSource({
          cacheKey: buildConfigCacheKey(
            input.ctx.projectId ?? input.request.projectId,
            true,
            { productionMode: true, releaseId },
          ),
          source,
          environmentName: "release",
          environment: {},
          signal: input.req.signal,
        }),
      client: {
        beginReleaseAssetManifestBuild: (version) =>
          apiClient.beginReleaseAssetManifestBuild(version),
        listAllReleaseFiles: async (version) => {
          const files = await apiClient.listAllReleaseFiles(version);
          return files.map((file) => {
            if (typeof file.content !== "string") {
              throw API_CLIENT_ERROR.create({
                detail: "Release file list omitted file content",
                status: 502,
              });
            }
            return { path: file.path, content: file.content };
          });
        },
        uploadReleaseAsset: (version, hash, contentType, bytes) =>
          apiClient.uploadReleaseAsset(version, hash, contentType, bytes),
        putReleaseAssetManifest: (version, manifest) =>
          apiClient.putReleaseAssetManifest(version, manifest),
        reportReleaseAssetManifestState: (version, state, error) =>
          apiClient.reportReleaseAssetManifestState(version, state, error),
        compileProjectCss,
      },
    }, tempDir);

    response = {
      success: result.success,
      result,
      error: result.error ?? null,
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    response = {
      success: false,
      error: errorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  }

  return await finalizeReleaseAssetBuildTempDir({
    tempDir,
    response,
    startedAt,
    removeTempDir: (path) => Deno.remove(path, { recursive: true }),
    now: Date.now,
  });
}

async function finalizeReleaseAssetBuildTempDir(input: {
  tempDir: string;
  response: ProjectRunExecuteResponse;
  startedAt: number;
  removeTempDir: (path: string) => Promise<void>;
  now: () => number;
}): Promise<ProjectRunExecuteResponse> {
  try {
    await input.removeTempDir(input.tempDir);
    return input.response;
  } catch {
    const cleanupLog = "Temporary release build cleanup failed";
    return {
      ...input.response,
      logs: input.response.logs ? `${input.response.logs}\n${cleanupLog}` : cleanupLog,
      duration_ms: input.now() - input.startedAt,
    };
  }
}

/** @internal Deterministic lifecycle seams for focused handler tests. */
export const projectRunExecuteHandlerInternals = Object.freeze({
  finalizeReleaseAssetBuildTempDir,
});

const DEFAULT_STYLESHEET_PATHS = [
  "globals.css",
  "global.css",
  "styles/globals.css",
  "app/globals.css",
  "src/globals.css",
  "src/styles/globals.css",
];

function resolveStyleArtifactBuildSelector(
  config: Record<string, unknown>,
): StyleArtifactSelector {
  const entries = ["branch", "environment_name", "release_id"]
    .flatMap((key) => config[key] === undefined ? [] : [[key, config[key]] as const]);
  if (entries.length !== 1) {
    throw INVALID_ARGUMENT.create({ detail: "Exactly one style artifact selector is required" });
  }
  const selected = entries[0];
  if (!selected || typeof selected[1] !== "string") {
    throw INVALID_ARGUMENT.create({ detail: "Style artifact selector must be a string" });
  }
  if (selected[0] === "branch") return { branch: selected[1] };
  if (selected[0] === "environment_name") return { environmentName: selected[1] };
  return { releaseId: selected[1] };
}

function assertStyleArtifactSourceSelector(
  tuple: StyleArtifactTuple,
  contentContext: ResolvedContentContext | null,
): void {
  const matches = tuple.branch !== undefined
    ? contentContext?.sourceType === "branch" && contentContext.branch === tuple.branch
    : tuple.environmentName !== undefined
    ? contentContext?.sourceType === "environment" &&
      contentContext.environmentName === tuple.environmentName
    : contentContext?.sourceType === "release" && contentContext.releaseId === tuple.releaseId;
  if (!matches) {
    throw INVALID_ARGUMENT.create({
      detail: "Resolved project source did not match the requested style artifact selector",
    });
  }
}

function styleArtifactResultTuple(tuple: StyleArtifactTuple): Record<string, unknown> {
  const selector = tuple.branch !== undefined
    ? { type: "branch", value: tuple.branch }
    : tuple.environmentName !== undefined
    ? { type: "environment", value: tuple.environmentName }
    : { type: "release", value: tuple.releaseId };
  return {
    css_pipeline_identity: tuple.cssPipelineIdentity,
    style_profile_hash: tuple.styleProfileHash,
    selector,
  };
}

function stylesheetCandidatePaths(stylesheetPath?: string): string[] {
  return stylesheetPath ? [stylesheetPath.replace(/^\/+/, "")] : DEFAULT_STYLESHEET_PATHS;
}

async function readStylesheetFromAdapter(
  ctx: HandlerContext,
  stylesheetPath?: string,
): Promise<string | undefined> {
  const reader = captureBoundedTextReader(
    ctx.adapter.fs,
    "Style artifact stylesheet filesystem",
  );

  for (const path of stylesheetCandidatePaths(stylesheetPath)) {
    try {
      return (await reader.readUtf8(path, MAX_CSS_FILE_BYTES, "Style artifact stylesheet"))
        .content;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  return undefined;
}

async function resolveStyleArtifactSourceFiles(
  ctx: HandlerContext,
  styleProfile: StyleScopeProfile,
  tuple: StyleArtifactTuple,
  collectLocalProjectSourceFiles: (
    options: { projectDir: string; styleProfile: StyleScopeProfile },
  ) => Promise<Array<{ path: string; content?: string }>>,
): Promise<
  ProjectStyleSourceSnapshot & {
    readonly files: readonly ProjectStyleSourceFileSnapshot[];
  }
> {
  const snapshotOptions = {
    adapter: ctx.adapter,
    projectDir: ctx.projectDir,
    config: ctx.config ?? {},
    includeStylesheets: true,
    validateContentContext: (contentContext: Readonly<ResolvedContentContext> | null) =>
      assertStyleArtifactSourceSelector(tuple, contentContext),
  };
  const providerSnapshot = await captureProjectStyleSourceSnapshot(snapshotOptions);
  if (providerSnapshot !== null && providerSnapshot.files !== null) {
    return providerSnapshot as ProjectStyleSourceSnapshot & {
      readonly files: readonly ProjectStyleSourceFileSnapshot[];
    };
  }

  assertStyleArtifactSourceSelector(tuple, null);
  const files = await snapshotProjectStyleSourceFiles(
    await collectLocalProjectSourceFiles({
      projectDir: ctx.projectDir,
      styleProfile,
    }),
    snapshotOptions,
  );
  return createProjectStyleSourceSnapshot("local", null, files) as ProjectStyleSourceSnapshot & {
    readonly files: readonly ProjectStyleSourceFileSnapshot[];
  };
}

async function executeStyleArtifactBuildRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  let apiClient: VeryfrontApiClient | null = null;
  let tuple: StyleArtifactTuple | null = null;

  try {
    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const {
      buildPreparedCSSArtifactFromFiles,
      collectLocalProjectSourceFiles,
      findStylesheetFromFiles,
      readLocalProjectStylesheet,
    } = await import("#veryfront/html/styles-builder/css-pregeneration.ts");
    const { acquireCSSGenerationSession } = await import(
      "#veryfront/html/styles-builder/css-compiler.ts"
    );
    const { resolveStyleContentVersion } = await import(
      "#veryfront/html/styles-builder/content-version.ts"
    );
    const { createStyleScopeProfile } = await import(
      "#veryfront/html/styles-builder/style-scope-profile.ts"
    );

    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    const selector = resolveStyleArtifactBuildSelector(config);
    const styleProfile = createStyleScopeProfile(input.ctx.config);
    const requestedStyleProfileHash = getStringConfig(config, ["style_profile_hash"]);
    const requestedCSSPipelineIdentity = getStringConfig(config, ["css_pipeline_identity"]);

    if (!requestedCSSPipelineIdentity || !requestedStyleProfileHash) {
      throw INVALID_ARGUMENT.create({
        detail: "Style artifact build requires CSS pipeline and style profile identities",
      });
    }

    try {
      tuple = createStyleArtifactTuple({
        ...selector,
        cssPipelineIdentity: requestedCSSPipelineIdentity,
        styleProfileHash: requestedStyleProfileHash,
      });
    } catch (cause) {
      throw INVALID_ARGUMENT.create({
        detail: cause instanceof Error ? cause.message : "Invalid style artifact identity",
        cause,
      });
    }

    if (tuple.styleProfileHash !== styleProfile.hash) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Style profile hash mismatch: expected ${tuple.styleProfileHash}, got ${styleProfile.hash}`,
      });
    }

    const generationSession = await acquireCSSGenerationSession(true);
    if (tuple.cssPipelineIdentity !== generationSession.cacheIdentity) {
      throw INVALID_ARGUMENT.create({
        detail:
          `CSS pipeline identity mismatch: expected ${tuple.cssPipelineIdentity}, got ${generationSession.cacheIdentity}`,
      });
    }

    const sourceSnapshot = await resolveStyleArtifactSourceFiles(
      input.ctx,
      styleProfile,
      tuple,
      collectLocalProjectSourceFiles,
    );
    const { files, contentContext } = sourceSnapshot;
    if (files.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: "No project source files were available to build the style artifact",
      });
    }

    const stylesheetPath = input.ctx.config?.styles?.stylesheet;
    const stylesheet = findStylesheetFromFiles(files, stylesheetPath, input.ctx.projectDir) ??
      (sourceSnapshot.origin === "provider"
        ? await readStylesheetFromAdapter(input.ctx, stylesheetPath)
        : await readLocalProjectStylesheet(input.ctx.projectDir, stylesheetPath));
    const result = await buildPreparedCSSArtifactFromFiles({
      projectSlug: projectReference,
      projectVersion: resolveStyleContentVersion(contentContext, {
        branch: tuple.branch,
        environmentName: tuple.environmentName,
        releaseId: tuple.releaseId,
      }),
      projectDir: input.ctx.projectDir,
      files,
      styleProfile,
      stylesheet,
      stylesheetPath,
      minify: true,
      environment: "preview",
      buildMode: "production",
      generationSession,
    });

    const resolution = await apiClient.upsertStyleArtifact({
      ...tuple,
      artifactHash: result.hash,
      assetPath: `/_vf/css/${result.hash}.css`,
      contentType: STYLE_ARTIFACT_CONTENT_TYPE,
      etag: `"${result.hash}"`,
      buildRunId: input.request.runId,
    });
    assertStyleArtifactResolutionTuple(resolution, tuple);
    if (resolution.status !== "ready" || resolution.artifactHash !== result.hash) {
      throw API_CLIENT_ERROR.create({
        detail: "Control plane did not acknowledge the built style artifact",
        status: 502,
      });
    }

    return {
      success: true,
      result: {
        kind: "style_artifact",
        state: "ready",
        ...styleArtifactResultTuple(tuple),
        artifact_hash: resolution.artifactHash,
        asset_path: resolution.assetPath,
        content_type: resolution.contentType,
        etag: resolution.etag,
        candidateCount: result.candidateCount,
        fromCache: result.fromCache,
      },
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    let failure = errorMessage(error);
    if (apiClient && tuple) {
      try {
        const resolution = await apiClient.upsertStyleArtifact({
          ...tuple,
          status: "failed",
          buildRunId: input.request.runId,
          failureReason: failure,
        });
        assertStyleArtifactResolutionTuple(resolution, tuple);
        if (resolution.status !== "failed") {
          throw API_CLIENT_ERROR.create({
            detail: "Control plane did not acknowledge the failed style artifact",
            status: 502,
          });
        }
      } catch (reportError) {
        failure = `${failure}; failed to report style artifact failure: ${
          errorMessage(reportError)
        }`;
      }
    }

    return {
      success: false,
      ...(tuple
        ? {
          result: {
            kind: "style_artifact",
            state: "failed",
            ...styleArtifactResultTuple(tuple),
          },
        }
        : {}),
      error: failure,
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  }
}

const defaultDeps: ProjectRunExecuteHandlerDeps = {
  runTask,
  findWorkflowById,
  findEvalById,
  createWorkflowClient: createRuntimeWorkflowClient,
  runEval,
  createEvalAgentAdapter: createAgentServiceEvalAdapter,
  uploadEvalReport: uploadEvalReportToProjectFiles,
  ensureProjectDiscovery,
  executeKnowledgeIngest: executeKnowledgeIngestRun,
  executeReleaseAssetBuild: executeReleaseAssetBuildRun,
  executeStyleArtifactBuild: executeStyleArtifactBuildRun,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export class ProjectRunExecuteHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ProjectRunExecuteHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: EXECUTE_PATH_REGEX, method: "POST" },
    ],
  };

  constructor(private readonly deps: ProjectRunExecuteHandlerDeps = defaultDeps) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const runId = getRunId(new URL(req.url).pathname);
    if (!runId) {
      return this.continue();
    }

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      try {
        const rawBody = await readInternalAgentRequestBody(
          req,
          INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
        );
        const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });
        const request = parseExecuteRequest(JSON.parse(rawBody), runId);

        if (
          request.projectId !== claims.project_id ||
          (ctx.projectId !== undefined && request.projectId !== ctx.projectId)
        ) {
          return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
        }

        const startedAt = this.deps.now();
        try {
          const response = request.kind === "task" && request.target === "task:knowledge-ingest"
            ? await this.deps.executeKnowledgeIngest({ request, ctx, req })
            : request.kind === "task" && request.target === "task:release-asset-build"
            ? await this.deps.executeReleaseAssetBuild({ request, ctx, req })
            : request.kind === "task" && request.target === "task:style-artifact-build"
            ? await this.deps.executeStyleArtifactBuild({ request, ctx, req })
            : request.kind === "task"
            ? await executeTaskRun(request, ctx, req.signal, this.deps)
            : request.kind === "eval"
            ? await executeEvalRun(request, ctx, req, this.deps)
            : await executeWorkflowRun(request, ctx, this.deps);
          return this.respond(builder.json(response, 200));
        } catch (error) {
          return this.respond(
            builder.json(
              createExecutionFailure(error, Math.max(0, this.deps.now() - startedAt)),
              200,
            ),
          );
        }
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof SyntaxError || error instanceof Error) {
          return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
        }

        return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
      }
    });
  }
}
