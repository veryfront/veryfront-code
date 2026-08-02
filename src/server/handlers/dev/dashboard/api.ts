import { getMCPRegistry, getMCPStats } from "#veryfront/mcp";
import {
  ERROR_CATALOG,
  ERROR_REGISTRY,
  type ErrorCategory,
  type ErrorSlug,
  getErrorMessage,
  REQUEST_ERROR,
} from "#veryfront/errors";
import { executeTool, isToolVisibleTo, toolRegistry } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import {
  getRegisteredModelProviders,
  hasModelProvider,
} from "#veryfront/provider/model-registry.ts";
import { WorkflowClient } from "#veryfront/workflow";
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
import { validatePathSync } from "#veryfront/security";
import { ReloadNotifier } from "../../../reload-notifier.ts";
import type { HandlerContext } from "../../types.ts";
import { errorResponse, jsonResponse } from "../http-helpers.ts";

const WORKFLOW_EXECUTION_TIMEOUT_MS = 30_000;

/**
 * Validate a relative path against the project directory.
 *
 * Uses `validatePathSync` in strict mode (rejects absolute paths, null bytes,
 * `..` traversal, and any resolved path that escapes `baseDir`).
 *
 * Note: `searchParams.get()` already percent-decodes; no extra decoding needed
 * (double-decoding would itself be a vulnerability).
 *
 * Returns the canonicalized absolute path on success, or `null` when invalid.
 */
function validateRelativePath(path: string, projectDir: string): string | null {
  const result = validatePathSync(path, {
    baseDir: projectDir,
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

const POST_DASHBOARD_API_ROUTES: Record<string, DashboardApiRouteHandler> = {
  "/_dev/api/hmr-trigger": (req) => handleHmrTrigger(req),
  "/_dev/api/execute-tool": (req) => handleExecuteTool(req),
  "/_dev/api/read-resource": (req) => handleReadResource(req),
  "/_dev/api/render-prompt": (req) => handleRenderPrompt(req),
  "/_dev/api/start-workflow": (req) => handleStartWorkflow(req),
};

function getDashboardRouteHandler(
  method: string,
  pathname: string,
): DashboardApiRouteHandler | undefined {
  if (method === "GET") return GET_DASHBOARD_API_ROUTES[pathname];
  if (method === "POST") return POST_DASHBOARD_API_ROUTES[pathname];
  return undefined;
}

export function getDashboardApiRoutePaths(method: DashboardApiMethod): string[] {
  const routes = method === "GET" ? GET_DASHBOARD_API_ROUTES : POST_DASHBOARD_API_ROUTES;
  return Object.keys(routes).sort();
}

export function handleDashboardAPI(
  req: Request,
  ctx: HandlerContext,
): Promise<Response | null> | Response | null {
  if (!ctx.isLocalProject) return errorResponse("Unauthorized", 401);

  const { pathname } = new URL(req.url);
  const handler = getDashboardRouteHandler(req.method, pathname);
  if (!handler) return null;

  return handler(req, ctx);
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
  const list = Array.from(tools.entries()).map(([id, t]) => ({
    id,
    type: t.type,
    description: t.description,
    schema: t.inputSchemaJson ?? null,
    mcp: t.mcp ?? { enabled: true },
  }));
  return jsonResponse({ tools: list, count: list.length });
}

function handleListResources(): Response {
  const { resources } = getMCPRegistry();
  const list = Array.from(resources.entries()).map(([id, r]) => ({
    id,
    pattern: r.pattern,
    description: r.description,
    mcp: r.mcp ?? { enabled: true },
  }));
  return jsonResponse({ resources: list, count: list.length });
}

function handleListPrompts(): Response {
  const { prompts } = getMCPRegistry();
  const list = Array.from(prompts.entries()).map(([id, p]) => ({
    id,
    description: p.description,
    suggestion: p.suggestion,
  }));
  return jsonResponse({ prompts: list, count: list.length });
}

function handleListAgents(): Response {
  const allTools = Array.from(toolRegistry.getAll().entries());

  const list = Array.from(agentRegistry.getAll().entries()).map(([id, agent]) => {
    const cfg = agent.config as unknown as Record<string, unknown>;

    let system: string | null = null;
    if (typeof cfg.system === "string") system = cfg.system;
    else if (typeof cfg.system === "function") system = "(dynamic)";

    let tools: Record<string, boolean> = {};
    if (cfg.tools === true) {
      // Owner-aware: list only tools this agent can actually resolve.
      tools = Object.fromEntries(
        allTools
          .filter(([, registryTool]) => isToolVisibleTo(registryTool, { agentId: id }))
          .map(([tid]) => [tid, true]),
      );
    } else if (typeof cfg.tools === "object" && cfg.tools !== null) {
      tools = cfg.tools as Record<string, boolean>;
    }

    return {
      id,
      description: (cfg.description as string) || `Model: ${agent.config.model}`,
      model: agent.config.model,
      system,
      tools,
      memory: cfg.memory ?? null,
      streaming: cfg.streaming ?? false,
      maxSteps: cfg.maxSteps ?? null,
    };
  });

  return jsonResponse({ agents: list, count: list.length });
}

function handleListWorkflows(): Response {
  const workflows = workflowRegistry.getAllAsArray();
  const stats = workflowRegistry.getStats();
  return jsonResponse({
    workflows,
    count: workflows.length,
    stats,
    timestamp: new Date().toISOString(),
  });
}

async function handleExecuteTool(req: Request): Promise<Response> {
  try {
    const { toolId, args } = (await req.json()) as { toolId?: string; args?: unknown };
    if (!toolId) return errorResponse("toolId is required", 400);
    if (!toolRegistry.get(toolId)) return errorResponse(`Tool not found: ${toolId}`, 404);

    const startTime = Date.now();
    const result = await executeTool(toolId, (args as Record<string, unknown>) ?? {});
    return jsonResponse({ success: true, toolId, result, duration: Date.now() - startTime });
  } catch (error) {
    return errorResponse(getErrorMessage(error));
  }
}

async function handleReadResource(req: Request): Promise<Response> {
  try {
    const { uri } = (await req.json()) as { uri?: string };
    if (!uri) return errorResponse("uri is required", 400);

    const resource = resourceRegistry.findByPattern(uri);
    if (!resource) return errorResponse(`Resource not found for URI: ${uri}`, 404);

    const params = resourceRegistry.extractParams(uri, resource.pattern);
    const startTime = Date.now();
    const data = await resource.load(params);

    return jsonResponse({
      success: true,
      uri,
      resourceId: resource.id,
      data,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    return errorResponse(getErrorMessage(error));
  }
}

async function handleRenderPrompt(req: Request): Promise<Response> {
  try {
    const { promptId, variables } = (await req.json()) as {
      promptId?: string;
      variables?: Record<string, unknown>;
    };
    if (!promptId) return errorResponse("promptId is required", 400);

    const vars = variables ?? {};
    const content = await promptRegistry.getContent(promptId, vars);
    if (content === undefined) return errorResponse(`Prompt not found: ${promptId}`, 404);

    return jsonResponse({ success: true, promptId, content, variablesUsed: vars });
  } catch (error) {
    return errorResponse(getErrorMessage(error));
  }
}

// Singleton workflow client for dev tools
let devWorkflowClient: WorkflowClient | null = null;

function getDevWorkflowClient(): WorkflowClient {
  if (devWorkflowClient) return devWorkflowClient;

  devWorkflowClient = new WorkflowClient({
    debug: true,
    executor: {
      stepExecutor: {
        // Provide registries so workflows can resolve agents and tools
        toolRegistry,
        agentRegistry,
      },
    },
  });

  for (const id of workflowRegistry.getAllIds()) {
    const definition = workflowRegistry.getDefinition(id);
    if (definition) devWorkflowClient.register(definition);
  }

  return devWorkflowClient;
}

async function handleStartWorkflow(req: Request): Promise<Response> {
  try {
    const { workflowId, input } = (await req.json()) as { workflowId?: string; input?: unknown };
    if (!workflowId) return errorResponse("workflowId is required", 400);
    if (!workflowRegistry.has(workflowId)) {
      return errorResponse(`Workflow not found: ${workflowId}`, 404);
    }

    const client = getDevWorkflowClient();
    const startTime = Date.now();
    const handle = await client.start(workflowId, (input as Record<string, unknown>) ?? {});

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let result: unknown;
    try {
      result = await Promise.race([
        handle.result(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(REQUEST_ERROR.create({ detail: "Workflow execution timed out (30s)" })),
            WORKFLOW_EXECUTION_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const run = await client.getRun(handle.runId);

    return jsonResponse({
      success: true,
      workflowId,
      runId: handle.runId,
      status: run?.status ?? "completed",
      result,
      duration: Date.now() - startTime,
      nodeStates: run?.nodeStates ?? {},
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("timed out")) {
      return jsonResponse(
        {
          success: false,
          error: message,
          hint: "Workflow is still running. Check logs or use a shorter workflow for testing.",
        },
        408,
      );
    }
    return errorResponse(message);
  }
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
    return errorResponse(getErrorMessage(error));
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
    const canonical = validateRelativePath(relativePath, projectDir);
    if (canonical === null) return errorResponse("Invalid path", 400);
    fullPath = canonical;
  }

  try {
    const files: Array<{ name: string; type: "file" | "directory"; path: string }> = [];
    for await (const entry of adapter.fs.readDir(fullPath)) {
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
    return jsonResponse({
      files: [],
      path: relativePath,
      projectDir,
      error: getErrorMessage(error),
    });
  }
}

async function handleReadFileContent(req: Request, ctx: HandlerContext): Promise<Response> {
  const { adapter, projectDir } = ctx;
  if (!adapter?.fs) return errorResponse("No file adapter available", 500);
  if (!projectDir) return errorResponse("No project directory configured", 500);

  const relativePath = new URL(req.url).searchParams.get("path") ?? "";
  if (!relativePath) return errorResponse("path parameter is required", 400);

  const canonical = validateRelativePath(relativePath, projectDir);
  if (canonical === null) return errorResponse("Invalid path", 400);

  try {
    const content = await adapter.fs.readFile(canonical);
    const extension = relativePath.split(".").pop() ?? "";

    if (!TEXT_EXTENSIONS.has(extension.toLowerCase())) {
      return jsonResponse({
        path: relativePath,
        extension,
        isBinary: true,
        message: "Binary file - cannot display contents",
      });
    }

    return jsonResponse({
      path: relativePath,
      extension,
      content,
      lines: content.split("\n").length,
      size: content.length,
    });
  } catch (error) {
    return jsonResponse({ path: relativePath, error: getErrorMessage(error) });
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

async function handleHmrTrigger(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { path?: string };
    const changedPaths = body.path ? [body.path] : undefined;

    const listenerCount = ReloadNotifier.getListenerCount();
    if (listenerCount === 0) {
      return jsonResponse({
        success: false,
        error: "No HMR listeners connected. Is a browser open?",
      });
    }

    ReloadNotifier.triggerReload(changedPaths);
    return jsonResponse({
      success: true,
      listeners: listenerCount,
      metrics: ReloadNotifier.getMetrics(),
    });
  } catch (error) {
    return errorResponse(getErrorMessage(error));
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
