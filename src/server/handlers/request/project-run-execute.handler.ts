import { CONTROL_PLANE_RUNS_PATH_PREFIX } from "#veryfront/channels/control-plane.ts";
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
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { StyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { VeryfrontConfig } from "#veryfront/config";
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
import { createWorkflowClient, RedisBackend } from "#veryfront/workflow";
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
  if (!isRecord(value)) throw new Error("Expected object");
  return value;
}

function parseOptionalUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${fieldName}`);

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Invalid ${fieldName}`);
    }
    return url.toString();
  } catch {
    throw new Error(`Invalid ${fieldName}`);
  }
}

function parseRuntimeTargetKind(value: unknown): ProjectRunExecuteRequest["runtimeTargetKind"] {
  if (value === undefined || value === null) return undefined;
  if (value === "main_branch" || value === "environment" || value === "preview_branch") {
    return value;
  }
  throw new Error("Invalid runtimeTargetKind");
}

function parseOptionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${fieldName}`);
  return value;
}

function parseExecuteRequest(value: unknown, pathRunId: string): ProjectRunExecuteRequest {
  if (!isRecord(value)) throw new Error("Expected object");

  const runId = value.runId;
  const kind = value.kind;
  const target = value.target;
  const projectId = value.projectId;

  if (typeof runId !== "string" || !runId) throw new Error("Invalid runId");
  if (runId !== pathRunId) throw new Error("Run id does not match request path");
  if (kind !== "task" && kind !== "workflow" && kind !== "eval") {
    throw new Error("Invalid run kind");
  }
  if (typeof target !== "string" || !target) throw new Error("Invalid target");
  if (typeof projectId !== "string" || !projectId) throw new Error("Invalid projectId");
  if (kind === "task" && !target.startsWith("task:")) throw new Error("Invalid task target");
  if (kind === "workflow" && !target.startsWith("workflow:")) {
    throw new Error("Invalid workflow target");
  }
  if (kind === "eval" && !target.startsWith("eval:")) throw new Error("Invalid eval target");

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
  const redisUrl = getHostEnv("REDIS_URL")?.trim();
  if (!redisUrl) {
    return Object.assign(createWorkflowClient(clientConfig), {
      statePersistence: "ephemeral" as const,
    });
  }

  const backend = new RedisBackend({ url: redisUrl, debug: config?.debug });
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
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const taskId = stripTargetPrefix(request.target, "task:");
  if (taskId === "knowledge-ingest") {
    throw new Error("Knowledge ingest must be executed through the knowledge ingest executor");
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
    if (!run) throw new Error(`Workflow run not found: ${runId}`);

    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled" ||
      run.status === "waiting"
    ) {
      return run;
    }

    if (deps.now() >= deadline) {
      throw new Error(`Workflow run timed out: ${runId}`);
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

function getHeaderFirstValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function getForwardedProtocol(req: Request): "http:" | "https:" | undefined {
  const value = getHeaderFirstValue(req.headers.get("x-forwarded-proto"))?.replace(/:$/, "");
  return value === "http" || value === "https" ? `${value}:` : undefined;
}

function getRequestOriginCandidates(req: Request): Set<string> {
  const url = new URL(req.url);
  const protocols = new Set([url.protocol]);
  const forwardedProtocol = getForwardedProtocol(req);
  if (forwardedProtocol) protocols.add(forwardedProtocol);

  const hosts = new Set([url.host]);
  const hostHeader = getHeaderFirstValue(req.headers.get("host"));
  const forwardedHost = getHeaderFirstValue(req.headers.get("x-forwarded-host"));
  if (hostHeader) hosts.add(hostHeader);
  if (forwardedHost) hosts.add(forwardedHost);

  const origins = new Set<string>();
  for (const protocol of protocols) {
    for (const host of hosts) {
      origins.add(`${protocol}//${host}`);
    }
  }
  return origins;
}

function isRequestSiblingAgUiEndpoint(endpoint: string, req: Request): boolean {
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname !== "/api/ag-ui") return false;
    return getRequestOriginCandidates(req).has(endpointUrl.origin);
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
    throw new Error("Missing project runtime API token");
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
      throw new Error(`Veryfront API request failed: ${response.status} ${response.statusText}`);
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
      throw new Error(`Upload not found: ${uploadId}`);
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
      throw new Error("Use upload paths or upload prefix, not both.");
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
      throw new Error("No supported knowledge sources were found.");
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
  const runInput = input.request.input ?? {};
  const authToken = getRuntimeApiToken(input.req, input.ctx);
  if (!authToken) {
    throw new Error("Missing project runtime API token");
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

  return {
    endpoint,
    authToken,
    agentId,
    projectId: input.request.projectId,
    projectSlug: input.ctx.projectSlug,
    releaseId: input.req.headers.get("x-release-id") ?? input.ctx.releaseId,
    contentSourceId: input.req.headers.get("x-content-source-id"),
    branchId: getStringConfig(config, ["branch_id", "branchId"]) ??
      getStringConfig(runInput, ["branch_id", "branchId"]) ??
      input.req.headers.get("x-branch-id"),
    branchName: input.req.headers.get("x-branch-name"),
    environment: managedEndpointContext?.environment ?? input.req.headers.get("x-environment") ??
      input.ctx.resolvedEnvironment,
    environmentId: input.req.headers.get("x-environment-id") ?? input.ctx.environmentId,
    forwardedHost: managedEndpointContext?.forwardedHost ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-host")) ??
      getEndpointHost(input.request.runtimeAgUiEndpoint),
    forwardedProto: managedEndpointContext?.forwardedProto ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-proto")) ??
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

  try {
    if (!releaseId || releaseVersion === undefined) {
      throw new Error("Missing release_id or release_version for release asset build");
    }

    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const { runReleaseAssetBuild } = await import("#veryfront/release-assets/build-executor.ts");
    const { createCompileProjectCss } = await import(
      "#veryfront/release-assets/css-compile.ts"
    );

    const apiBaseUrl = getEnvironmentConfig().apiBaseUrl;
    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw new Error("Missing project runtime API token");

    const apiClient = new VeryfrontApiClient({
      apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    const releaseVersionRef = releaseId;

    // Production CSS compiler: compiles the project's Tailwind CSS in-runtime
    // via the pure `generateTailwindCSS` primitive (no distributed-cache /
    // candidate-contract machinery). Defensive — returns null on any failure,
    // letting the executor keep its CSS gap.
    const compileProjectCss = createCompileProjectCss({
      projectScope: projectReference,
      config: input.ctx.config,
    });

    const result = await runReleaseAssetBuild({
      projectReference,
      projectId: input.ctx.projectId ?? input.request.projectId,
      releaseId,
      releaseVersion,
      releaseVersionRef,
      adapter: input.ctx.adapter,
      client: {
        beginReleaseAssetManifestBuild: (version) =>
          apiClient.beginReleaseAssetManifestBuild(version),
        listAllReleaseFiles: (version) => apiClient.listAllReleaseFiles(version),
        uploadReleaseAsset: (version, hash, contentType, bytes) =>
          apiClient.uploadReleaseAsset(version, hash, contentType, bytes),
        putReleaseAssetManifest: (version, manifest) =>
          apiClient.putReleaseAssetManifest(version, manifest),
        reportReleaseAssetManifestState: (version, state, error) =>
          apiClient.reportReleaseAssetManifestState(version, state, error),
        compileProjectCss,
      },
    }, tempDir);

    return {
      success: result.success,
      result,
      error: result.error ?? null,
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}

type StyleArtifactBuildSelector = {
  branch?: string;
  environmentName?: string;
  releaseId?: string;
};

type StyleArtifactSourceFile = { path: string; content?: string };

type StyleArtifactSourceProvider = {
  getAllSourceFiles: () => Promise<StyleArtifactSourceFile[]> | StyleArtifactSourceFile[];
  getContentContext?: () => ResolvedContentContext | null;
};

type OptionalTextFileReader = {
  readOptionalTextFile(path: string): Promise<string>;
};

const DEFAULT_STYLESHEET_PATHS = [
  "globals.css",
  "global.css",
  "styles/globals.css",
  "app/globals.css",
  "src/globals.css",
  "src/styles/globals.css",
];

function optionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveStyleArtifactBuildSelector(
  config: Record<string, unknown>,
  ctx: HandlerContext,
): StyleArtifactBuildSelector {
  const selector: StyleArtifactBuildSelector = {
    branch: getStringConfig(config, ["branch"]) ?? optionalString(ctx.parsedDomain?.branch),
    environmentName: getStringConfig(config, ["environment_name", "environmentName"]) ??
      optionalString(ctx.environmentName),
    releaseId: getStringConfig(config, ["release_id", "releaseId"]) ??
      optionalString(ctx.releaseId),
  };
  const count = [selector.branch, selector.environmentName, selector.releaseId]
    .filter((value) => typeof value === "string" && value.length > 0).length;

  if (count !== 1) {
    throw new Error("Exactly one style artifact selector is required");
  }

  return selector;
}

function getStyleArtifactSourceProvider(ctx: HandlerContext): StyleArtifactSourceProvider | null {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

  const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
    getAllSourceFiles?: StyleArtifactSourceProvider["getAllSourceFiles"];
    getContentContext?: StyleArtifactSourceProvider["getContentContext"];
  };
  if (typeof fsAdapter.getAllSourceFiles !== "function") return null;

  return {
    getAllSourceFiles: fsAdapter.getAllSourceFiles.bind(fsAdapter),
    getContentContext: typeof fsAdapter.getContentContext === "function"
      ? fsAdapter.getContentContext.bind(fsAdapter)
      : undefined,
  };
}

function stylesheetCandidatePaths(stylesheetPath?: string): string[] {
  return stylesheetPath ? [stylesheetPath.replace(/^\/+/, "")] : DEFAULT_STYLESHEET_PATHS;
}

function textFromFileContent(content: Uint8Array | string): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

function getOptionalTextFileReader(ctx: HandlerContext): OptionalTextFileReader | null {
  const wrappedFs = ctx.adapter.fs as {
    getUnderlyingAdapter?: () => unknown;
    readOptionalTextFile?: OptionalTextFileReader["readOptionalTextFile"];
  };

  if (typeof wrappedFs.readOptionalTextFile === "function") {
    return { readOptionalTextFile: wrappedFs.readOptionalTextFile.bind(wrappedFs) };
  }

  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;
  const underlying = wrappedFs.getUnderlyingAdapter() as Partial<OptionalTextFileReader>;
  if (typeof underlying.readOptionalTextFile !== "function") return null;

  return { readOptionalTextFile: underlying.readOptionalTextFile.bind(underlying) };
}

async function readStylesheetFromAdapter(
  ctx: HandlerContext,
  stylesheetPath?: string,
): Promise<string | undefined> {
  const optionalReader = getOptionalTextFileReader(ctx);

  for (const path of stylesheetCandidatePaths(stylesheetPath)) {
    try {
      const content = optionalReader
        ? await optionalReader.readOptionalTextFile(path)
        : textFromFileContent(await ctx.adapter.fs.readFile(path));
      if (content) return content;
    } catch {
      // keep searching
    }
  }

  return undefined;
}

async function resolveStyleArtifactSourceFiles(
  ctx: HandlerContext,
  styleProfile: StyleScopeProfile,
  collectLocalProjectSourceFiles: (
    options: { projectDir: string; styleProfile: StyleScopeProfile },
  ) => Promise<StyleArtifactSourceFile[]>,
): Promise<{ files: StyleArtifactSourceFile[]; contentContext: ResolvedContentContext | null }> {
  const sourceProvider = getStyleArtifactSourceProvider(ctx);
  if (sourceProvider) {
    return {
      files: await sourceProvider.getAllSourceFiles(),
      contentContext: sourceProvider.getContentContext?.() ?? null,
    };
  }

  return {
    files: await collectLocalProjectSourceFiles({
      projectDir: ctx.projectDir,
      styleProfile,
    }),
    contentContext: null,
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
  let selector: StyleArtifactBuildSelector | null = null;
  let styleProfileHash: string | null = null;

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
    const { resolveStyleContentVersion } = await import(
      "#veryfront/html/styles-builder/content-version.ts"
    );
    const { createStyleScopeProfile } = await import(
      "#veryfront/html/styles-builder/style-scope-profile.ts"
    );

    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw new Error("Missing project runtime API token");

    apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    selector = resolveStyleArtifactBuildSelector(config, input.ctx);
    const styleProfile = createStyleScopeProfile(input.ctx.config);
    const requestedStyleProfileHash = getStringConfig(config, [
      "style_profile_hash",
      "styleProfileHash",
    ]);
    styleProfileHash = requestedStyleProfileHash ?? styleProfile.hash;

    if (requestedStyleProfileHash && requestedStyleProfileHash !== styleProfile.hash) {
      throw new Error(
        `Style profile hash mismatch: expected ${requestedStyleProfileHash}, got ${styleProfile.hash}`,
      );
    }

    const { files, contentContext } = await resolveStyleArtifactSourceFiles(
      input.ctx,
      styleProfile,
      collectLocalProjectSourceFiles,
    );
    if (files.length === 0) {
      throw new Error("No project source files were available to build the style artifact");
    }

    const stylesheetPath = input.ctx.config?.tailwind?.stylesheet;
    const stylesheet = findStylesheetFromFiles(files, stylesheetPath) ??
      (getStyleArtifactSourceProvider(input.ctx)
        ? await readStylesheetFromAdapter(input.ctx, stylesheetPath)
        : await readLocalProjectStylesheet(input.ctx.projectDir, stylesheetPath));
    const result = await buildPreparedCSSArtifactFromFiles({
      projectSlug: projectReference,
      projectVersion: resolveStyleContentVersion(contentContext, {
        branch: selector.branch,
        environmentName: selector.environmentName,
        releaseId: selector.releaseId,
      }),
      projectDir: input.ctx.projectDir,
      files,
      styleProfile,
      stylesheet,
      stylesheetPath,
      minify: true,
      environment: "preview",
      buildMode: "production",
    });

    await apiClient.upsertStyleArtifact({
      ...selector,
      styleProfileHash,
      status: "ready",
      artifactHash: result.hash,
      assetPath: `/_vf/css/${result.hash}.css`,
      contentType: "text/css; charset=utf-8",
      buildRunId: input.request.runId,
    });

    return {
      success: true,
      result: {
        state: "ready",
        artifactHash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
        candidateCount: result.candidateCount,
        fromCache: result.fromCache,
      },
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    if (apiClient && selector && styleProfileHash) {
      await apiClient.upsertStyleArtifact({
        ...selector,
        styleProfileHash,
        status: "failed",
        buildRunId: input.request.runId,
        failureReason: errorMessage(error),
      }).catch(() => undefined);
    }

    return {
      success: false,
      error: errorMessage(error),
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
      { pattern: CONTROL_PLANE_RUNS_PATH_PREFIX, prefix: true, method: "POST" },
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
        const request = parseExecuteRequest(JSON.parse(rawBody), runId);
        const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });

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
            ? await executeTaskRun(request, ctx, this.deps)
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
