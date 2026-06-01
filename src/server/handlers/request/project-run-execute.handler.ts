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
import type { VeryfrontConfig } from "#veryfront/config";
import { type DiscoveredTask, findTaskById } from "#veryfront/task/discovery.ts";
import { runTask, type RunTaskOptions, type TaskRunResult } from "#veryfront/task/runner.ts";
import type { Logger } from "#veryfront/utils";
import { type DiscoveredWorkflow, findWorkflowById } from "#veryfront/workflow/discovery";
import { createWorkflowClient } from "#veryfront/workflow";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { BaseHandler } from "../response/base.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

const EXECUTE_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/execute$/;
const DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS = 100;
const DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS = 15 * 60 * 1_000;

export interface ProjectRunExecuteRequest {
  runId: string;
  kind: "task" | "workflow";
  target: string;
  projectId: string;
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

interface WorkflowRunView {
  status: string;
  output?: unknown;
  error?: { message?: string } | null;
}

interface WorkflowClientView {
  register(workflow: unknown): void;
  start(
    workflowId: string,
    input: unknown,
    options?: { runId?: string },
  ): Promise<{ runId: string }>;
  getRun(runId: string): Promise<WorkflowRunView | null>;
  destroy(): Promise<void>;
}

export interface ProjectRunExecuteHandlerDeps {
  findTaskById(
    taskId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
    },
  ): Promise<DiscoveredTask | null>;
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
  createWorkflowClient(config?: { debug?: boolean }): WorkflowClientView;
  executeKnowledgeIngest(input: {
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

function parseExecuteRequest(value: unknown, pathRunId: string): ProjectRunExecuteRequest {
  if (!isRecord(value)) throw new Error("Expected object");

  const runId = value.runId;
  const kind = value.kind;
  const target = value.target;
  const projectId = value.projectId;

  if (typeof runId !== "string" || !runId) throw new Error("Invalid runId");
  if (runId !== pathRunId) throw new Error("Run id does not match request path");
  if (kind !== "task" && kind !== "workflow") throw new Error("Invalid run kind");
  if (typeof target !== "string" || !target) throw new Error("Invalid target");
  if (typeof projectId !== "string" || !projectId) throw new Error("Invalid projectId");
  if (kind === "task" && !target.startsWith("task:")) throw new Error("Invalid task target");
  if (kind === "workflow" && !target.startsWith("workflow:")) {
    throw new Error("Invalid workflow target");
  }

  return {
    runId,
    kind,
    target,
    projectId,
    config: parseRecord(value.config),
    input: parseRecord(value.input),
  };
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

async function executeTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const taskId = stripTargetPrefix(request.target, "task:");
  if (taskId === "knowledge-ingest") {
    throw new Error("Knowledge ingest must be executed through the knowledge ingest executor");
  }

  const task = await deps.findTaskById(taskId, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
  });

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

  const client = deps.createWorkflowClient({ debug: ctx.debug });
  try {
    client.register(workflow.definition);
    const handle = await client.start(workflow.id, request.input ?? {}, { runId: request.runId });
    const run = await waitForWorkflowResult(client, handle.runId, deps);
    const durationMs = Math.max(0, deps.now() - startedAt);

    if (run.status === "completed" || run.status === "waiting") {
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

function createRuntimeApiClient(req: Request, ctx: HandlerContext): RuntimeApiClient {
  const apiUrl = getEnvironmentConfig().apiBaseUrl;
  const token = req.headers.get("x-token") ?? ctx.proxyToken ?? ctx.requestContext?.token ?? "";
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

const defaultDeps: ProjectRunExecuteHandlerDeps = {
  findTaskById,
  runTask,
  findWorkflowById,
  createWorkflowClient: (config) => createWorkflowClient(config) as unknown as WorkflowClientView,
  executeKnowledgeIngest: executeKnowledgeIngestRun,
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
            : request.kind === "task"
            ? await executeTaskRun(request, ctx, this.deps)
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
