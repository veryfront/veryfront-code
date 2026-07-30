import { getMCPRegistry, getMCPStats } from "#veryfront/mcp";
import {
  ERROR_CATALOG,
  ERROR_REGISTRY,
  type ErrorCategory,
  type ErrorSlug,
} from "#veryfront/errors";
import { isToolVisibleTo, type ToolExecutionContext, toolRegistry } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import {
  getRegisteredModelProviders,
  hasModelProvider,
} from "#veryfront/provider/model-registry.ts";
import { WorkflowClient, type WorkflowHandle } from "#veryfront/workflow";
import type { NodeState, WorkflowContext, WorkflowDefinition } from "#veryfront/workflow/types.ts";
import {
  getPrimaryAbortReason,
  isAbortCleanupError,
  runAbortableOperation,
} from "#veryfront/workflow/executor/abortable-operation.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { getErrorCollector, getLogBuffer, metrics } from "#veryfront/observability";
import {
  checkMemoryPressure,
  getCacheStats,
  getHeapStats,
} from "#veryfront/utils/memory/profiler.ts";
import { TransformStage } from "#veryfront/transforms/pipeline/types.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isRequestBodyTooLargeError, readBodyWithLimit, validatePath } from "#veryfront/security";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { serverLogger } from "#veryfront/utils";
import {
  ResourceParamsValidationError,
  ResourceUriSyntaxError,
  ResourceUriValidationError,
} from "#veryfront/resource/errors.ts";
import { ReloadNotifier } from "../../../reload-notifier.ts";
import type { HandlerContext } from "../../types.ts";
import {
  errorResponse as createErrorResponse,
  jsonResponse as createJsonResponse,
} from "../http-helpers.ts";
import {
  DASHBOARD_ACCESS_DENIED_MESSAGE,
  hasValidDashboardMutationSession,
  isTrustedDashboardRequest,
} from "./access-policy.ts";

export const WORKFLOW_EXECUTION_TIMEOUT_MS = 30_000;
export const TOOL_EXECUTION_TIMEOUT_MS = 30_000;
export const RESOURCE_READ_TIMEOUT_MS = 30_000;
export const PROMPT_RENDER_TIMEOUT_MS = 30_000;
export const MAX_DASHBOARD_API_BODY_BYTES = 1024 * 1024;
export const MAX_DASHBOARD_REGISTRY_ENTRIES = 2_000;
// Each relationship becomes at least one key/value node in the JSON payload.
// Keep expansion comfortably below the shared 100,000-node JSON response cap.
export const MAX_DASHBOARD_AGENT_TOOL_RELATIONSHIPS = 50_000;
export const MAX_DASHBOARD_DIRECTORY_ENTRIES = 2_000;
export const MAX_DASHBOARD_DIRECTORY_NAME_BYTES = 4 * 1024;
export const MAX_DASHBOARD_DIRECTORY_TOTAL_NAME_BYTES = 512 * 1024;
export const MAX_DASHBOARD_FILE_CONTENT_BYTES = 1024 * 1024;
const dashboardApiLogger = serverLogger.component("dashboard-api");
const dashboardTextEncoder = new TextEncoder();
const dashboardTextDecoder = new TextDecoder("utf-8", { fatal: true });

function withDashboardNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorResponse(message: string, status = 500): Response {
  return withDashboardNoStore(createErrorResponse(message, status));
}

function jsonResponse(data: unknown, status = 200): Response {
  return withDashboardNoStore(createJsonResponse(data, status));
}

function boundedJsonResponse(
  data: unknown,
  invalidOutputMessage: string,
  status = 200,
): Response {
  const snapshot = snapshotBoundedJsonValue(data);
  return snapshot.success
    ? jsonResponse(snapshot.value, status)
    : errorResponse(invalidOutputMessage, 500);
}

function getDashboardErrorType(error: unknown): string {
  try {
    if (error instanceof Error) {
      const name = error.name;
      return typeof name === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(name) ? name : "Error";
    }
  } catch {
    return "Unknown";
  }
  return typeof error;
}

function logDashboardFailure(
  message: string,
  error: unknown,
  metadata: Record<string, string | number | boolean | null | undefined> = {},
): void {
  dashboardApiLogger.warn(message, {
    ...metadata,
    errorType: getDashboardErrorType(error),
  });
}

function isDashboardTimeoutError(error: unknown): boolean {
  try {
    const reason = isAbortCleanupError(error) ? getPrimaryAbortReason(error) : error;
    return reason instanceof DOMException && reason.name === "TimeoutError";
  } catch {
    return false;
  }
}

function isProductionDashboardContext(ctx: HandlerContext): boolean {
  return ctx.resolvedEnvironment === undefined
    ? ctx.requestContext?.mode === "production"
    : ctx.resolvedEnvironment === "production";
}

function createDashboardToolContext(
  abortSignal: AbortSignal,
  ctx: HandlerContext,
): ToolExecutionContext {
  const productionMode = isProductionDashboardContext(ctx);
  const requestContext = ctx.requestContext;
  const hasProjectBoundToken = requestContext?.tokenProvenance === "project-bound" &&
    requestContext.token.length > 0;
  const authToken = hasProjectBoundToken ? requestContext.token : undefined;
  return {
    abortSignal,
    projectId: ctx.projectId ?? ctx.enriched?.projectId,
    projectSlug: ctx.projectSlug?.trim() || requestContext?.slug.trim() ||
      ctx.enriched?.projectSlug,
    productionMode,
    releaseId: productionMode ? (ctx.releaseId ?? ctx.enriched?.releaseId ?? null) : null,
    branch: productionMode ? null : (requestContext?.branch ?? ctx.enriched?.branch ?? null),
    environmentName: ctx.environmentName ?? ctx.enriched?.environmentName ?? null,
    ...(authToken === undefined ? {} : { authToken }),
  };
}

function runWithDashboardProjectContext<T>(
  ctx: HandlerContext,
  operation: () => Promise<T>,
): Promise<T> {
  const projectSlug = ctx.projectSlug?.trim() || ctx.requestContext?.slug.trim() ||
    ctx.enriched?.projectSlug.trim();
  const requestContext = ctx.requestContext;
  if (!projectSlug) return operation();

  const productionMode = isProductionDashboardContext(ctx);
  const hasProjectBoundToken = requestContext?.tokenProvenance === "project-bound" &&
    requestContext.token.length > 0;
  const token = hasProjectBoundToken ? requestContext.token : "";
  return runWithRequestContext(
    {
      projectSlug,
      projectId: ctx.projectId ?? ctx.enriched?.projectId,
      token,
      tokenProvenance: hasProjectBoundToken ? "project-bound" : "untrusted",
      productionMode,
      releaseId: productionMode ? (ctx.releaseId ?? ctx.enriched?.releaseId ?? null) : null,
      branch: productionMode ? null : (requestContext?.branch ?? ctx.enriched?.branch ?? null),
      environmentName: ctx.environmentName ?? ctx.enriched?.environmentName ?? null,
    },
    operation,
  );
}

/**
 * Validate a relative path against the project directory.
 *
 * Uses physical strict-mode validation (rejects absolute paths, null bytes,
 * traversal, and symlink escapes from `baseDir`).
 *
 * Note: `searchParams.get()` already percent-decodes; no extra decoding needed
 * (double-decoding would itself be a vulnerability).
 *
 * Returns the canonicalized absolute path on success, or `null` when invalid.
 */
async function validateRelativePath(
  path: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  const result = await validatePath(path, {
    baseDir: projectDir,
    adapter,
    allowAbsolute: false,
    level: "strict",
  });
  if (!result.valid || !result.canonicalPath) return null;
  return result.canonicalPath;
}

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "css",
  "html",
  "yaml",
  "yml",
  "txt",
  "env",
  "gitignore",
  "dockerignore",
]);

type DashboardApiMethod = "GET" | "POST";
type DashboardApiRouteHandler = (
  req: Request,
  ctx: HandlerContext,
) => Promise<Response> | Response;
type DashboardJsonObject = Record<string, unknown>;
type DashboardApiPostHandler = (
  req: Request,
  body: DashboardJsonObject,
  ctx: HandlerContext,
) => Promise<Response> | Response;

const GET_DASHBOARD_API_ROUTES: Record<string, DashboardApiRouteHandler> = {
  "/_dev/api/stats": () => handleStats(),
  "/_dev/api/tools": () => handleListTools(),
  "/_dev/api/resources": () => handleListResources(),
  "/_dev/api/prompts": () => handleListPrompts(),
  "/_dev/api/agents": () => handleListAgents(),
  "/_dev/api/workflows": () => handleListWorkflows(),
  "/_dev/api/handlers": (_req, ctx) => handleListHandlers(ctx),
  "/_dev/api/metrics": () => handleGetMetrics(),
  "/_dev/api/files": (req, ctx) => handleListFiles(req, ctx),
  "/_dev/api/file-content": (req, ctx) => handleReadFileContent(req, ctx),
  "/_dev/api/infrastructure": () => handleGetInfrastructure(),
  "/_dev/api/memory": () => handleGetMemory(),
  "/_dev/api/build": () => handleGetBuild(),
  "/_dev/api/errors": () => handleGetErrors(),
  "/_dev/api/config": (_req, ctx) => handleGetConfig(ctx),
  "/_dev/api/live-errors": (req) => handleLiveErrors(req),
  "/_dev/api/live-logs": (req) => handleLiveLogs(req),
};

const POST_DASHBOARD_API_ROUTES: Record<string, DashboardApiPostHandler> = {
  "/_dev/api/hmr-trigger": (_req, body, ctx) => handleHmrTrigger(body, ctx),
  "/_dev/api/execute-tool": (req, body, ctx) => handleExecuteTool(req, body, ctx),
  "/_dev/api/read-resource": (req, body) => handleReadResource(req, body),
  "/_dev/api/render-prompt": (req, body) => handleRenderPrompt(req, body),
  "/_dev/api/start-workflow": (req, body, ctx) => handleStartWorkflow(req, body, ctx),
};

function validateDashboardPostCaller(req: Request): Response | null {
  const requestUrl = new URL(req.url);
  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin || rawOrigin === "null") {
    return errorResponse("Dashboard request origin is not trusted", 403);
  }
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return errorResponse("Dashboard request origin is not trusted", 403);
  }
  if (
    rawOrigin !== origin.origin ||
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.origin !== requestUrl.origin
  ) {
    return errorResponse("Dashboard request origin is not trusted", 403);
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return errorResponse("Dashboard request origin is not trusted", 403);
  }
  if (req.headers.get("sec-fetch-mode") === "no-cors") {
    return errorResponse("Dashboard request mode is not trusted", 403);
  }
  if (!hasValidDashboardMutationSession(req)) {
    return errorResponse("Dashboard mutation session is invalid", 403);
  }
  if (req.headers.get("content-type")?.trim().toLowerCase() !== "application/json") {
    return errorResponse("Dashboard POST requests require application/json", 415);
  }
  return null;
}

function cancelDashboardBody(
  body: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null,
  reason: Error,
): void {
  if (!body) return;
  try {
    void body.cancel(reason).catch(() => {});
  } catch {
    // The response still fails closed when a malformed local stream cannot be cancelled.
  }
}

async function readDashboardJsonObject(
  req: Request,
): Promise<
  | { success: true; body: DashboardJsonObject }
  | { success: false; response: Response }
> {
  let text: string;
  try {
    text = await readBodyWithLimit(req, MAX_DASHBOARD_API_BODY_BYTES);
  } catch (error) {
    return {
      success: false,
      response: isRequestBodyTooLargeError(error)
        ? errorResponse("Dashboard request body is too large", 413)
        : errorResponse(
          req.signal.aborted
            ? "Dashboard request body was aborted"
            : "Dashboard request body could not be read",
          400,
        ),
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      success: false,
      response: errorResponse("Dashboard request body must be valid JSON", 400),
    };
  }
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  ) {
    return {
      success: false,
      response: errorResponse("Dashboard request body must be a bounded JSON object", 400),
    };
  }
  return { success: true, body: snapshot.value as DashboardJsonObject };
}

export function getDashboardApiRoutePaths(method: DashboardApiMethod): string[] {
  const routes = method === "GET" ? GET_DASHBOARD_API_ROUTES : POST_DASHBOARD_API_ROUTES;
  return Object.keys(routes).sort();
}

export async function handleDashboardAPI(
  req: Request,
  ctx: HandlerContext,
): Promise<Response | null> {
  if (!ctx.isLocalProject) return errorResponse("Unauthorized", 401);
  if (!isTrustedDashboardRequest(req)) {
    cancelDashboardBody(req.body, new Error("Dashboard request host rejected"));
    return errorResponse(DASHBOARD_ACCESS_DENIED_MESSAGE, 403);
  }

  const { pathname } = new URL(req.url);
  try {
    if (req.method === "GET") {
      const handler = GET_DASHBOARD_API_ROUTES[pathname];
      return handler ? await handler(req, ctx) : null;
    }
    if (req.method !== "POST") return null;

    const handler = POST_DASHBOARD_API_ROUTES[pathname];
    if (!handler) return null;

    const callerError = validateDashboardPostCaller(req);
    if (callerError) {
      cancelDashboardBody(req.body, new Error("Dashboard POST request rejected"));
      return callerError;
    }
    const parsed = await readDashboardJsonObject(req);
    if (!parsed.success) return parsed.response;

    return await handler(req, parsed.body, ctx);
  } catch (error) {
    logDashboardFailure("Dashboard API request failed", error);
    return errorResponse("Dashboard request could not be completed", 500);
  }
}

function handleStats(): Response {
  const mcpStats = getMCPStats();
  return jsonResponse({
    mcp: {
      tools: mcpStats.tools,
      resources: mcpStats.resources,
      prompts: mcpStats.prompts,
      total: mcpStats.total,
    },
    agents: agentRegistry.getAll().size,
    workflows: workflowRegistry.getAll().size,
    timestamp: new Date().toISOString(),
  });
}

function handleListTools(): Response {
  const { tools } = getMCPRegistry();
  if (tools.size > MAX_DASHBOARD_REGISTRY_ENTRIES) {
    return errorResponse("Tool registry exceeds the dashboard listing limit", 500);
  }
  const list = Array.from(tools.entries()).map(([id, t]) => ({
    id,
    type: t.type,
    description: t.description,
    schema: t.inputSchemaJson ?? null,
    mcp: t.mcp ?? { enabled: true },
  }));
  return boundedJsonResponse(
    { tools: list, count: list.length },
    "Tool registry contains data that cannot be displayed",
  );
}

function handleListResources(): Response {
  const { resources } = getMCPRegistry();
  if (resources.size > MAX_DASHBOARD_REGISTRY_ENTRIES) {
    return errorResponse("Resource registry exceeds the dashboard listing limit", 500);
  }
  const list = Array.from(resources.entries()).map(([id, r]) => ({
    id,
    pattern: r.pattern,
    description: r.description,
    mcp: r.mcp ?? { enabled: true },
  }));
  return boundedJsonResponse(
    { resources: list, count: list.length },
    "Resource registry contains data that cannot be displayed",
  );
}

function handleListPrompts(): Response {
  const { prompts } = getMCPRegistry();
  if (prompts.size > MAX_DASHBOARD_REGISTRY_ENTRIES) {
    return errorResponse("Prompt registry exceeds the dashboard listing limit", 500);
  }
  const list = Array.from(prompts.entries()).map(([id, p]) => ({
    id,
    description: p.description,
    suggestion: p.suggestion,
  }));
  return boundedJsonResponse(
    { prompts: list, count: list.length },
    "Prompt registry contains data that cannot be displayed",
  );
}

function handleListAgents(): Response {
  const registeredTools = toolRegistry.getAll();
  const allAgents = agentRegistry.getAll();
  if (
    registeredTools.size > MAX_DASHBOARD_REGISTRY_ENTRIES ||
    allAgents.size > MAX_DASHBOARD_REGISTRY_ENTRIES
  ) {
    return errorResponse("Agent registry exceeds the dashboard listing limit", 500);
  }
  const allTools = Array.from(registeredTools.entries());

  let toolRelationshipCount = 0;
  const list: Record<string, unknown>[] = [];
  for (const [id, agent] of allAgents.entries()) {
    const cfg = agent.config as unknown as Record<string, unknown>;

    let system: string | null = null;
    if (typeof cfg.system === "string") system = cfg.system;
    else if (typeof cfg.system === "function") system = "(dynamic)";

    let tools: Record<string, boolean> = {};
    if (cfg.tools === true) {
      // Owner-aware: list only tools this agent can actually resolve.
      const visibleTools = allTools.filter(([, registryTool]) =>
        isToolVisibleTo(registryTool, { agentId: id })
      );
      toolRelationshipCount += visibleTools.length;
      if (toolRelationshipCount > MAX_DASHBOARD_AGENT_TOOL_RELATIONSHIPS) {
        return errorResponse("Agent registry exceeds the dashboard relationship limit", 500);
      }
      tools = Object.fromEntries(visibleTools.map(([tid]) => [tid, true]));
    } else if (typeof cfg.tools === "object" && cfg.tools !== null) {
      tools = cfg.tools as Record<string, boolean>;
    }

    list.push({
      id,
      description: (cfg.description as string) || `Model: ${agent.config.model}`,
      model: agent.config.model,
      system,
      tools,
      memory: cfg.memory ?? null,
      streaming: cfg.streaming ?? false,
      maxSteps: cfg.maxSteps ?? null,
    });
  }

  return boundedJsonResponse(
    { agents: list, count: list.length },
    "Agent registry contains data that cannot be displayed",
  );
}

function handleListWorkflows(): Response {
  const registeredWorkflows = workflowRegistry.getAll();
  if (registeredWorkflows.size > MAX_DASHBOARD_REGISTRY_ENTRIES) {
    return errorResponse("Workflow registry exceeds the dashboard listing limit", 500);
  }
  const workflows = Array.from(registeredWorkflows.values());
  const stats = workflowRegistry.getStats();
  return boundedJsonResponse(
    {
      workflows,
      count: workflows.length,
      stats,
      timestamp: new Date().toISOString(),
    },
    "Workflow registry contains data that cannot be displayed",
  );
}

async function handleExecuteTool(
  req: Request,
  body: DashboardJsonObject,
  ctx: HandlerContext,
): Promise<Response> {
  const { toolId, args } = body;
  if (typeof toolId !== "string" || toolId.length === 0) {
    return errorResponse("toolId is required", 400);
  }
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    return errorResponse("args must be an object", 400);
  }

  const executionContext = createDashboardToolContext(req.signal, ctx);
  const registeredTool = toolRegistry.get(toolId);
  if (!registeredTool || !isToolVisibleTo(registeredTool, executionContext)) {
    return errorResponse(`Tool not found: ${toolId}`, 404);
  }
  if (req.signal.aborted) return errorResponse("Tool execution was cancelled", 408);

  const startTime = Date.now();
  const timeoutReason = new DOMException(
    "Dashboard tool execution timed out",
    "TimeoutError",
  );
  try {
    const result = await runAbortableOperation(
      (abortSignal) =>
        registeredTool.execute(
          (args as Record<string, unknown> | undefined) ?? {},
          { ...executionContext, abortSignal },
        ),
      {
        label: `Dashboard tool "${toolId}" execution`,
        parentSignal: req.signal,
        timeout: {
          milliseconds: TOOL_EXECUTION_TIMEOUT_MS,
          reason: timeoutReason,
        },
        cancellationGracePeriod: 0,
      },
    );
    if (req.signal.aborted) return errorResponse("Tool execution was cancelled", 408);
    return boundedJsonResponse(
      { success: true, toolId, result, duration: Date.now() - startTime },
      `Tool "${toolId}" returned data that is not bounded JSON`,
    );
  } catch (error) {
    if (req.signal.aborted) return errorResponse("Tool execution was cancelled", 408);
    if (isDashboardTimeoutError(error)) {
      return errorResponse(`Tool "${toolId}" execution timed out`, 408);
    }
    logDashboardFailure("Dashboard tool execution failed", error, { tool: toolId });
    return errorResponse(`Tool "${toolId}" could not be executed`, 500);
  }
}

async function handleReadResource(
  req: Request,
  body: DashboardJsonObject,
): Promise<Response> {
  try {
    const { uri } = body;
    if (typeof uri !== "string" || uri.length === 0) {
      return errorResponse("uri is required", 400);
    }

    let resource: ReturnType<typeof resourceRegistry.findByPattern>;
    try {
      resource = resourceRegistry.findByPattern(uri);
    } catch (error) {
      if (error instanceof ResourceUriSyntaxError) {
        return errorResponse(error.message, 400);
      }
      dashboardApiLogger.warn("Resource URI lookup failed", {
        errorType: getDashboardErrorType(error),
      });
      return errorResponse("Resource URI could not be resolved", 500);
    }
    if (!resource) return errorResponse(`Resource not found for URI: ${uri}`, 404);

    let params: Record<string, string>;
    try {
      params = resourceRegistry.extractParams(uri, resource.pattern);
    } catch (error) {
      if (error instanceof ResourceUriValidationError) {
        return errorResponse(error.message, 400);
      }
      dashboardApiLogger.warn("Resource URI resolution failed", {
        resource: resource.id,
        errorType: getDashboardErrorType(error),
      });
      return errorResponse(`Resource "${resource.id}" could not be resolved`, 500);
    }
    const startTime = Date.now();
    const timeoutReason = new DOMException("Dashboard resource read timed out", "TimeoutError");
    let data: unknown;
    try {
      data = await runAbortableOperation(
        (abortSignal) => resource.load(params, { abortSignal, uri }),
        {
          label: `Dashboard resource "${resource.id}" read`,
          parentSignal: req.signal,
          timeout: {
            milliseconds: RESOURCE_READ_TIMEOUT_MS,
            reason: timeoutReason,
          },
          cancellationGracePeriod: 0,
        },
      );
    } catch (error) {
      if (error instanceof ResourceParamsValidationError) {
        return errorResponse(
          `Resource URI does not satisfy parameters for "${resource.id}"`,
          400,
        );
      }
      if (req.signal.aborted) return errorResponse("Resource read was cancelled", 408);
      if (isDashboardTimeoutError(error)) {
        return errorResponse(`Resource "${resource.id}" read timed out`, 408);
      }
      dashboardApiLogger.warn("Resource loading failed", {
        resource: resource.id,
        errorType: getDashboardErrorType(error),
      });
      return errorResponse(`Resource "${resource.id}" could not be loaded`, 500);
    }
    if (req.signal.aborted) return errorResponse("Resource read was cancelled", 408);
    const snapshot = snapshotBoundedJsonValue(data);
    if (!snapshot.success) {
      return errorResponse(
        `Resource "${resource.id}" returned data that is not bounded JSON`,
        500,
      );
    }

    return boundedJsonResponse(
      {
        success: true,
        uri,
        resourceId: resource.id,
        data: snapshot.value,
        duration: Date.now() - startTime,
      },
      `Resource "${resource.id}" returned data that is not bounded JSON`,
    );
  } catch (error) {
    if (req.signal.aborted) return errorResponse("Resource read was cancelled", 408);
    logDashboardFailure("Dashboard resource read failed", error);
    return errorResponse("Resource could not be read", 500);
  }
}

async function handleRenderPrompt(
  req: Request,
  body: DashboardJsonObject,
): Promise<Response> {
  try {
    const { promptId, variables } = body;
    if (typeof promptId !== "string" || promptId.length === 0) {
      return errorResponse("promptId is required", 400);
    }
    const registeredPrompt = promptRegistry.get(promptId);
    if (!registeredPrompt) {
      return errorResponse(`Prompt not found: ${promptId}`, 404);
    }
    if (
      variables !== undefined &&
      (variables === null || typeof variables !== "object" || Array.isArray(variables))
    ) {
      return errorResponse("variables must be an object", 400);
    }

    const vars = (variables ?? {}) as Record<string, unknown>;
    if (req.signal.aborted) return errorResponse("Prompt rendering was cancelled", 408);
    const deadline = Date.now() + PROMPT_RENDER_TIMEOUT_MS;
    const timeoutReason = new DOMException("Dashboard prompt rendering timed out", "TimeoutError");
    let content: string;
    try {
      content = await runAbortableOperation(
        (abortSignal) => registeredPrompt.getContent(vars, { abortSignal, deadline }),
        {
          label: `Dashboard prompt "${promptId}" rendering`,
          parentSignal: req.signal,
          timeout: {
            milliseconds: PROMPT_RENDER_TIMEOUT_MS,
            reason: timeoutReason,
          },
          cancellationGracePeriod: 0,
        },
      );
    } catch (error) {
      if (req.signal.aborted) return errorResponse("Prompt rendering was cancelled", 408);
      if (isDashboardTimeoutError(error)) {
        return errorResponse(`Prompt "${promptId}" rendering timed out`, 408);
      }
      dashboardApiLogger.warn("Prompt rendering failed", {
        prompt: promptId,
        errorType: getDashboardErrorType(error),
      });
      return errorResponse(`Prompt "${promptId}" could not be rendered`, 500);
    }
    if (req.signal.aborted) return errorResponse("Prompt rendering was cancelled", 408);

    return boundedJsonResponse(
      { success: true, promptId, content, variablesUsed: vars },
      `Prompt "${promptId}" returned content that is not bounded JSON`,
    );
  } catch (error) {
    if (req.signal.aborted) return errorResponse("Prompt rendering was cancelled", 408);
    logDashboardFailure("Dashboard prompt rendering failed", error);
    return errorResponse("Prompt could not be rendered", 500);
  }
}

type DashboardWorkflowCancellationKind = "request" | "timeout";

interface DashboardWorkflowWaitScope {
  readonly signal: AbortSignal;
  cancellationKind(): DashboardWorkflowCancellationKind | null;
  cleanup(): void;
}

function createDashboardWorkflowWaitScope(requestSignal: AbortSignal): DashboardWorkflowWaitScope {
  const controller = new AbortController();
  let cancellationKind: DashboardWorkflowCancellationKind | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromRequest = () => {
    if (cancellationKind !== null) return;
    cancellationKind = "request";
    controller.abort(new DOMException("Dashboard request aborted", "AbortError"));
  };

  if (requestSignal.aborted) abortFromRequest();
  else requestSignal.addEventListener("abort", abortFromRequest, { once: true });

  if (cancellationKind === null) {
    timeoutId = setTimeout(() => {
      if (cancellationKind !== null) return;
      cancellationKind = "timeout";
      controller.abort(new DOMException("Dashboard workflow timed out", "TimeoutError"));
    }, WORKFLOW_EXECUTION_TIMEOUT_MS);
  }

  return {
    signal: controller.signal,
    cancellationKind: () => cancellationKind,
    cleanup: () => {
      requestSignal.removeEventListener("abort", abortFromRequest);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    },
  };
}

function createDashboardWorkflowNodeStates(
  nodeStates: Readonly<Record<string, NodeState>>,
): Record<string, unknown> {
  const dashboardNodeStates: Record<string, unknown> = Object.create(null);
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    dashboardNodeStates[nodeId] = {
      nodeId: state.nodeId,
      status: state.status,
      attempt: state.attempt,
      ...(state.input === undefined ? {} : { input: state.input }),
      ...(state.output === undefined ? {} : { output: state.output }),
      ...(state.error === undefined ? {} : { error: "Workflow node failed" }),
      ...(state.startedAt instanceof Date ? { startedAt: state.startedAt.toISOString() } : {}),
      ...(state.completedAt instanceof Date
        ? { completedAt: state.completedAt.toISOString() }
        : {}),
    };
  }
  return dashboardNodeStates;
}

function createDashboardWorkflowDefinition(
  definition: WorkflowDefinition,
  signal: AbortSignal,
): WorkflowDefinition {
  const onComplete = definition.onComplete;
  const onError = definition.onError;
  return Object.freeze({
    ...definition,
    ...(onComplete === undefined ? {} : {
      onComplete: (result: unknown, context: WorkflowContext) =>
        runAbortableOperation(
          () => onComplete(result, context),
          {
            label: `Dashboard workflow "${definition.id}" completion hook`,
            parentSignal: signal,
            cancellationGracePeriod: 0,
          },
        ),
    }),
    ...(onError === undefined ? {} : {
      onError: (error: Error, context: WorkflowContext) =>
        runAbortableOperation(
          () => onError(error, context),
          {
            label: `Dashboard workflow "${definition.id}" failure hook`,
            parentSignal: signal,
            cancellationGracePeriod: 0,
          },
        ),
    }),
  });
}

async function cancelAndSettleDashboardWorkflow(
  handle: WorkflowHandle,
  workflowId: string,
): Promise<void> {
  const [statusOutcome] = await Promise.allSettled([handle.status()]);
  const shouldCancel = statusOutcome?.status === "rejected" ||
    statusOutcome?.value.status === "pending" ||
    statusOutcome?.value.status === "running" ||
    statusOutcome?.value.status === "waiting";
  if (shouldCancel) {
    const [cancelOutcome] = await Promise.allSettled([handle.cancel()]);
    if (cancelOutcome?.status === "rejected") {
      logDashboardFailure("Dashboard workflow cancellation failed", cancelOutcome.reason, {
        workflow: workflowId,
      });
    }
  }
  await Promise.allSettled([handle.settled()]);
}

function createDashboardWorkflowClient(ctx: HandlerContext): WorkflowClient {
  // Capture the request-visible collaborators before workflow execution enters
  // its own tenant scope. This prevents registry mutations or a scope switch
  // from changing the definitions admitted for this request.
  const tools = new Map(toolRegistry.getAll());
  const agents = new Map(agentRegistry.getAll());
  return new WorkflowClient({
    debug: ctx.debug ?? false,
    executor: {
      stepExecutor: {
        toolRegistry: Object.freeze({
          get: (id: string) => tools.get(id),
          list: () => Array.from(tools.keys()),
        }),
        agentRegistry: Object.freeze({
          get: (id: string) => agents.get(id),
          list: () => Array.from(agents.keys()),
        }),
      },
    },
  });
}

async function handleStartWorkflow(
  req: Request,
  body: DashboardJsonObject,
  ctx: HandlerContext,
): Promise<Response> {
  const { workflowId, input } = body;
  if (typeof workflowId !== "string" || workflowId.length === 0) {
    return errorResponse("workflowId is required", 400);
  }
  if (
    input !== undefined &&
    (input === null || typeof input !== "object" || Array.isArray(input))
  ) {
    return errorResponse("input must be an object", 400);
  }

  const definition = workflowRegistry.getDefinition(workflowId);
  if (!definition) return errorResponse(`Workflow not found: ${workflowId}`, 404);
  if (req.signal.aborted) return errorResponse("Workflow execution was cancelled", 408);

  let client: WorkflowClient;
  try {
    client = createDashboardWorkflowClient(ctx);
  } catch (error) {
    logDashboardFailure("Dashboard workflow client creation failed", error, {
      workflow: workflowId,
    });
    return errorResponse(`Workflow "${workflowId}" could not be started`, 500);
  }

  const waitScope = createDashboardWorkflowWaitScope(req.signal);
  const startTime = Date.now();
  let handle: WorkflowHandle | undefined;
  let response = errorResponse(`Workflow "${workflowId}" could not be completed`, 500);
  let teardownFailed = false;

  try {
    client.register(createDashboardWorkflowDefinition(definition, waitScope.signal));
    handle = await runWithDashboardProjectContext(
      ctx,
      () => client.start(workflowId, (input as Record<string, unknown>) ?? {}),
    );
    await runAbortableOperation(
      () => handle!.settled(),
      {
        label: `Dashboard workflow "${workflowId}" settlement`,
        parentSignal: waitScope.signal,
        cancellationGracePeriod: 0,
      },
    );
    waitScope.signal.throwIfAborted();
    let run = await client.getRun(handle.runId);
    waitScope.signal.throwIfAborted();
    if (!run) throw new Error("Workflow run disappeared before response serialization");
    if (run.status === "pending" || run.status === "running" || run.status === "waiting") {
      await handle.result(waitScope.signal);
      waitScope.signal.throwIfAborted();
      run = await client.getRun(handle.runId);
      waitScope.signal.throwIfAborted();
      if (!run) throw new Error("Workflow run disappeared before response serialization");
    }
    if (run.status !== "completed") {
      throw new Error("Workflow did not complete successfully");
    }

    response = boundedJsonResponse(
      {
        success: true,
        workflowId,
        runId: handle.runId,
        status: run.status,
        result: run.output,
        duration: Date.now() - startTime,
        nodeStates: createDashboardWorkflowNodeStates(run.nodeStates),
      },
      `Workflow "${workflowId}" returned data that is not bounded JSON`,
    );
  } catch (error) {
    const cancellationKind = waitScope.cancellationKind();
    if (cancellationKind !== null) {
      if (handle) await cancelAndSettleDashboardWorkflow(handle, workflowId);
      response = jsonResponse(
        {
          success: false,
          error: cancellationKind === "timeout"
            ? "Workflow execution timed out and was cancelled"
            : "Workflow execution was cancelled",
        },
        408,
      );
    } else {
      if (handle) await Promise.allSettled([handle.settled()]);
      logDashboardFailure("Dashboard workflow execution failed", error, {
        workflow: workflowId,
      });
      response = errorResponse(`Workflow "${workflowId}" could not be completed`, 500);
    }
  } finally {
    try {
      await client.destroy();
    } catch (error) {
      teardownFailed = true;
      logDashboardFailure("Dashboard workflow client teardown failed", error, {
        workflow: workflowId,
      });
    } finally {
      waitScope.cleanup();
    }
  }

  if (teardownFailed) {
    return errorResponse("Workflow execution resources could not be released", 500);
  }
  const finalCancellationKind = waitScope.cancellationKind();
  return finalCancellationKind === null ? response : jsonResponse(
    {
      success: false,
      error: finalCancellationKind === "timeout"
        ? "Workflow execution timed out and was cancelled"
        : "Workflow execution was cancelled",
    },
    408,
  );
}

function handleListHandlers(ctx: HandlerContext): Response {
  const registry = ctx.routeRegistry;
  if (!registry) {
    return jsonResponse({ handlers: [], count: 0, error: "No route registry available" });
  }

  const handlers = registry.getHandlers().map((h) => ({
    name: h.metadata.name,
    priority: h.metadata.priority,
    patterns: (h.metadata.patterns ?? []).map((p) => ({
      ...p,
      pattern: p.pattern instanceof RegExp ? p.pattern.source : p.pattern,
    })),
    enabled: h.metadata.enabled ? "conditional" : "always",
  }));

  return jsonResponse({ handlers, count: handlers.length, stats: registry.getStats() });
}

function handleGetMetrics(): Response {
  try {
    return jsonResponse({ counters: metrics.snapshot(), timestamp: new Date().toISOString() });
  } catch (error) {
    logDashboardFailure("Dashboard metrics snapshot failed", error);
    return errorResponse("Metrics could not be read", 500);
  }
}

async function handleListFiles(req: Request, ctx: HandlerContext): Promise<Response> {
  const { adapter, projectDir } = ctx;
  if (!adapter?.fs) return errorResponse("No file adapter available", 500);
  if (!projectDir) return errorResponse("No project directory configured", 500);

  const relativePath = new URL(req.url).searchParams.get("path") ?? "";

  let fullPath: string;
  if (relativePath === "") {
    fullPath = projectDir;
  } else {
    const canonical = await validateRelativePath(relativePath, projectDir, adapter);
    if (canonical === null) return errorResponse("Invalid path", 400);
    fullPath = canonical;
  }

  try {
    const files: Array<{ name: string; type: "file" | "directory"; path: string }> = [];
    let totalNameBytes = 0;
    for await (const entry of adapter.fs.readDir(fullPath)) {
      const nameBytes = dashboardTextEncoder.encode(entry.name).byteLength;
      totalNameBytes += nameBytes;
      if (
        files.length >= MAX_DASHBOARD_DIRECTORY_ENTRIES ||
        nameBytes > MAX_DASHBOARD_DIRECTORY_NAME_BYTES ||
        totalNameBytes > MAX_DASHBOARD_DIRECTORY_TOTAL_NAME_BYTES
      ) {
        return errorResponse("Directory listing exceeds the dashboard display limit", 413);
      }
      files.push({
        name: entry.name,
        type: entry.isDirectory ? "directory" : "file",
        path: relativePath ? `${relativePath}/${entry.name}` : entry.name,
      });
    }

    files.sort((a, b) =>
      a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)
    );

    return jsonResponse({ files, path: relativePath, projectDir, count: files.length });
  } catch (error) {
    dashboardApiLogger.error("Failed to read dashboard directory", {
      errorType: getDashboardErrorType(error),
    });
    return errorResponse("Directory could not be read", 500);
  }
}

async function handleReadFileContent(req: Request, ctx: HandlerContext): Promise<Response> {
  const { adapter, projectDir } = ctx;
  if (!adapter?.fs) return errorResponse("No file adapter available", 500);
  if (!projectDir) return errorResponse("No project directory configured", 500);

  const relativePath = new URL(req.url).searchParams.get("path") ?? "";
  if (!relativePath) return errorResponse("path parameter is required", 400);

  const canonical = await validateRelativePath(relativePath, projectDir, adapter);
  if (canonical === null) return errorResponse("Invalid path", 400);

  const extension = relativePath.split(".").pop() ?? "";
  if (!TEXT_EXTENSIONS.has(extension.toLowerCase())) {
    return jsonResponse({
      path: relativePath,
      extension,
      isBinary: true,
      message: "Binary file - cannot display contents",
    });
  }

  const readFileBytesBounded = adapter.fs.readFileBytesBounded;
  if (typeof readFileBytesBounded !== "function") {
    return errorResponse("Bounded file reads are not supported by this adapter", 501);
  }

  try {
    const bytes = await readFileBytesBounded.call(
      adapter.fs,
      canonical,
      MAX_DASHBOARD_FILE_CONTENT_BYTES + 1,
    );
    if (bytes.byteLength > MAX_DASHBOARD_FILE_CONTENT_BYTES) {
      return errorResponse("File exceeds the dashboard display limit", 413);
    }

    let content: string;
    try {
      content = dashboardTextDecoder.decode(bytes);
    } catch {
      return errorResponse("File is not valid UTF-8 text", 422);
    }

    return jsonResponse({
      path: relativePath,
      extension,
      content,
      lines: content.split("\n").length,
      size: bytes.byteLength,
    });
  } catch (error) {
    dashboardApiLogger.error("Failed to read dashboard file", {
      errorType: getDashboardErrorType(error),
    });
    return errorResponse("File could not be read", 500);
  }
}

function handleGetInfrastructure(): Response {
  const providers = getRegisteredModelProviders().map((name) => ({
    name,
    configured: hasModelProvider(name),
  }));

  const allProviders = ["openai", "anthropic", "google"].map((name) => ({
    name,
    configured: providers.some((p) => p.name === name),
  }));

  return jsonResponse({
    providers: allProviders,
    workflowNodeTypes: ["step", "parallel", "branch", "wait"],
    timestamp: new Date().toISOString(),
  });
}

function handleGetMemory(): Response {
  return jsonResponse({
    heap: getHeapStats(),
    caches: getCacheStats(),
    pressure: checkMemoryPressure(),
    timestamp: new Date().toISOString(),
  });
}

function handleGetBuild(): Response {
  const transformStages = Object.entries(TransformStage)
    .filter(([key]) => isNaN(Number(key)))
    .map(([name, value]) => ({
      stage: value as number,
      name,
      description: getStageDescription(name),
    }))
    .sort((a, b) => a.stage - b.stage);

  const remarkPlugins = [
    { name: "remarkGfm", description: "GitHub Flavored Markdown support" },
    { name: "remarkFrontmatter", description: "YAML frontmatter parsing" },
    { name: "remarkMdxFrontmatter", description: "Expose frontmatter as export" },
    { name: "remarkMdxHeadings", description: "Extract heading metadata" },
    { name: "remarkCodeBlocks", description: "Code block processing" },
    { name: "remarkDirective", description: "Custom directive support" },
  ];

  const rehypePlugins = [
    { name: "rehypeMermaid", description: "Mermaid diagram rendering" },
    { name: "rehypeShiki", description: "Syntax highlighting with Shiki" },
    { name: "rehypeSlug", description: "Add IDs to headings" },
    { name: "rehypeAutolinkHeadings", description: "Add links to headings" },
    { name: "rehypeExternalLinks", description: "Process external links" },
  ];

  return jsonResponse({
    transformStages,
    remarkPlugins,
    rehypePlugins,
    timestamp: new Date().toISOString(),
  });
}

function getStageDescription(name: string): string {
  const descriptions: Record<string, string> = {
    PARSE: "MDX → JSX compilation",
    COMPILE: "esbuild JSX → JS",
    RESOLVE_ALIASES: "@/ alias resolution",
    RESOLVE_REACT: "react → esm.sh URLs",
    RESOLVE_CONTEXT: "Context packages",
    RESOLVE_RELATIVE: "./imports → full paths",
    RESOLVE_BARE: "npm → esm.sh URLs",
    FINALIZE: "Final cleanup",
  };
  return descriptions[name] ?? name;
}

const DASHBOARD_ERROR_CATEGORIES = {
  CONFIG: "config",
  BUILD: "build",
  RUNTIME: "runtime",
  ROUTE: "route",
  MODULE: "module",
  SERVER: "server",
  BOUNDARY: "rsc",
  DEV: "dev",
  DEPLOY: "deployment",
  AGENT: "agent",
  GENERAL: "general",
} as const satisfies Record<ErrorCategory, string>;

function getCategoryFromSlug(slug: ErrorSlug): string {
  return DASHBOARD_ERROR_CATEGORIES[ERROR_REGISTRY[slug].category];
}

function handleGetErrors(): Response {
  const errors = Object.entries(ERROR_CATALOG).map(([code, solution]) => ({
    code,
    title: solution.title,
    category: getCategoryFromSlug(solution.slug),
    message: solution.message,
    steps: solution.steps,
    docsUrl: solution.docs,
  }));

  const categories = errors.reduce<Record<string, number>>((acc, err) => {
    acc[err.category] = (acc[err.category] ?? 0) + 1;
    return acc;
  }, {});

  return jsonResponse({
    errors,
    categories,
    count: errors.length,
    timestamp: new Date().toISOString(),
  });
}

function handleLiveErrors(req: Request): Response {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const collector = getErrorCollector();

  const filter = type ? { type: type as import("#veryfront/observability").ErrorType } : undefined;

  const errors = collector.getAll(filter);
  return jsonResponse({
    errors,
    count: errors.length,
    countByType: collector.countByType(),
    timestamp: new Date().toISOString(),
  });
}

function handleLiveLogs(req: Request): Response {
  const url = new URL(req.url);
  const level = url.searchParams.get("level") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const pattern = url.searchParams.get("pattern") ?? undefined;
  const limit = url.searchParams.get("limit");
  const since = url.searchParams.get("since");

  const buffer = getLogBuffer();
  const entries = buffer.query({
    level: level as import("#veryfront/observability").LogLevel | undefined,
    source,
    pattern,
    limit: limit ? parseInt(limit, 10) : undefined,
    since: since ? parseInt(since, 10) : undefined,
  });

  return jsonResponse({
    logs: entries,
    count: entries.length,
    countByLevel: buffer.countByLevel(),
    timestamp: new Date().toISOString(),
  });
}

async function handleHmrTrigger(
  body: DashboardJsonObject,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    const path = body.path;
    if (path !== undefined && (typeof path !== "string" || path.length === 0)) {
      return errorResponse("path must be a non-empty string", 400);
    }
    const changedPaths = typeof path === "string" ? [path] : undefined;

    const listenerCount = ReloadNotifier.getListenerCount();
    if (listenerCount === 0) {
      return jsonResponse({
        success: false,
        error: "No HMR listeners connected. Is a browser open?",
      });
    }

    const projectId = ctx.projectId?.trim() || undefined;
    const projectSlug = ctx.projectSlug?.trim() || undefined;
    if (!projectId && !projectSlug) {
      return errorResponse("Local HMR requires a resolved project ID or slug", 409);
    }

    const branch = ctx.requestContext?.branch?.trim() || "main";
    ReloadNotifier.triggerReload(changedPaths, {
      projectId,
      projectSlug,
      projectDir: ctx.projectDir,
      environment: "preview",
      branch,
      releaseId: ctx.releaseId,
      contentSourceId: ctx.enriched?.contentSourceId ?? `local-${branch}`,
    });
    return jsonResponse({
      success: true,
      listeners: listenerCount,
      metrics: ReloadNotifier.getMetrics(),
    });
  } catch (error) {
    logDashboardFailure("Dashboard HMR trigger failed", error);
    return errorResponse("HMR reload could not be triggered", 500);
  }
}

function handleGetConfig(ctx: HandlerContext): Response {
  const featureFlags = [
    {
      name: "RSC_ENABLED",
      value: isRSCEnabled(),
      source: "VERYFRONT_EXPERIMENTAL_RSC",
    },
  ];

  const env = getEnvironmentConfig();
  const safeEnvVars: Record<string, string | boolean> = {
    NODE_ENV: env.nodeEnv,
    VERYFRONT_MODE: env.veryfrontMode,
    OPENAI_API_KEY: env.openaiApiKey ? "(set)" : "(not set)",
    ANTHROPIC_API_KEY: env.anthropicApiKey ? "(set)" : "(not set)",
    GOOGLE_AI_API_KEY: env.googleApiKey ? "(set)" : "(not set)",
  };

  return jsonResponse({
    featureFlags,
    environment: safeEnvVars,
    projectDir: ctx.projectDir ?? "(unknown)",
    isLocalProject: !!ctx.isLocalProject,
    timestamp: new Date().toISOString(),
  });
}
