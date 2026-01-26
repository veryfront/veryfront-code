import { getMCPRegistry, getMCPStats } from "#veryfront/mcp";
import { executeTool, toolRegistry } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import { agentRegistry } from "#veryfront/agent";
import { providerRegistry } from "#veryfront/provider";
import { WorkflowClient, workflowRegistry } from "#veryfront/workflow";
import { metrics } from "#veryfront/observability/simple-metrics/index.ts";
import {
  checkMemoryPressure,
  getCacheStats,
  getHeapStats,
} from "#veryfront/utils/memory/profiler.ts";
import { ERROR_CATALOG } from "#veryfront/errors/catalog/index.ts";
import { TransformStage } from "#veryfront/transforms/pipeline/types.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import type { HandlerContext } from "../../types.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache",
};

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function handleDashboardAPI(
  req: Request,
  ctx: HandlerContext,
): Promise<Response | null> | Response | null {
  const { pathname } = new URL(req.url);

  if (req.method === "GET") {
    switch (pathname) {
      case "/_dev/api/stats":
        return handleStats();
      case "/_dev/api/tools":
        return handleListTools();
      case "/_dev/api/resources":
        return handleListResources();
      case "/_dev/api/prompts":
        return handleListPrompts();
      case "/_dev/api/agents":
        return handleListAgents();
      case "/_dev/api/workflows":
        return handleListWorkflows();
      case "/_dev/api/handlers":
        return handleListHandlers(ctx);
      case "/_dev/api/metrics":
        return handleGetMetrics();
      case "/_dev/api/files":
        return handleListFiles(req, ctx);
      case "/_dev/api/file-content":
        return handleReadFileContent(req, ctx);
      case "/_dev/api/infrastructure":
        return handleGetInfrastructure();
      case "/_dev/api/memory":
        return handleGetMemory();
      case "/_dev/api/build":
        return handleGetBuild();
      case "/_dev/api/errors":
        return handleGetErrors();
      case "/_dev/api/config":
        return handleGetConfig(ctx);
      default:
        return null;
    }
  }

  if (req.method === "POST") {
    switch (pathname) {
      case "/_dev/api/execute-tool":
        return handleExecuteTool(req);
      case "/_dev/api/read-resource":
        return handleReadResource(req);
      case "/_dev/api/render-prompt":
        return handleRenderPrompt(req);
      case "/_dev/api/start-workflow":
        return handleStartWorkflow(req);
      default:
        return null;
    }
  }

  return null;
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
    schema: t.inputSchemaJson || null,
    mcp: t.mcp || { enabled: true },
  }));
  return jsonResponse({ tools: list, count: list.length });
}

function handleListResources(): Response {
  const { resources } = getMCPRegistry();
  const list = Array.from(resources.entries()).map(([id, r]) => ({
    id,
    pattern: r.pattern,
    description: r.description,
    mcp: r.mcp || { enabled: true },
  }));
  return jsonResponse({ resources: list, count: list.length });
}

function handleListPrompts(): Response {
  const { prompts } = getMCPRegistry();
  const list = Array.from(prompts.entries()).map(([id, p]) => ({ id, description: p.description }));
  return jsonResponse({ prompts: list, count: list.length });
}

function handleListAgents(): Response {
  const allToolIds = Array.from(toolRegistry.getAll().keys());

  const list = Array.from(agentRegistry.getAll().entries()).map(([id, agent]) => {
    const cfg = agent.config as unknown as Record<string, unknown>;

    let system: string | null = null;
    if (typeof cfg.system === "string") system = cfg.system;
    else if (typeof cfg.system === "function") system = "(dynamic)";

    let tools: Record<string, boolean> = {};
    if (cfg.tools === true) {
      tools = Object.fromEntries(allToolIds.map((tid) => [tid, true]));
    } else if (typeof cfg.tools === "object" && cfg.tools !== null) {
      tools = cfg.tools as Record<string, boolean>;
    }

    return {
      id,
      description: (cfg.description as string) || `Model: ${agent.config.model}`,
      model: agent.config.model,
      system,
      tools,
      memory: cfg.memory || null,
      streaming: cfg.streaming || false,
      maxSteps: cfg.maxSteps || null,
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
    const { toolId, args } = await req.json();
    if (!toolId) return errorResponse("toolId is required", 400);
    if (!toolRegistry.get(toolId)) return errorResponse(`Tool not found: ${toolId}`, 404);

    const startTime = Date.now();
    const result = await executeTool(toolId, args || {});
    return jsonResponse({ success: true, toolId, result, duration: Date.now() - startTime });
  } catch (error) {
    return errorResponse(getErrorMessage(error));
  }
}

async function handleReadResource(req: Request): Promise<Response> {
  try {
    const { uri } = await req.json();
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
    const { promptId, variables } = await req.json();
    if (!promptId) return errorResponse("promptId is required", 400);

    const vars = variables || {};
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

  // Register all workflows from the global registry
  for (const id of workflowRegistry.getAllIds()) {
    const definition = workflowRegistry.getDefinition(id);
    if (definition) devWorkflowClient.register(definition);
  }

  return devWorkflowClient;
}

async function handleStartWorkflow(req: Request): Promise<Response> {
  try {
    const { workflowId, input } = await req.json();
    if (!workflowId) return errorResponse("workflowId is required", 400);
    if (!workflowRegistry.has(workflowId)) {
      return errorResponse(`Workflow not found: ${workflowId}`, 404);
    }

    const client = getDevWorkflowClient();
    const startTime = Date.now();
    const handle = await client.start(workflowId, input || {});

    const timeoutMs = 30000; // 30 seconds timeout for dev testing
    const result = await Promise.race([
      handle.result(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Workflow execution timed out (30s)")), timeoutMs)
      ),
    ]);

    const run = await client.getRun(handle.runId);

    return jsonResponse({
      success: true,
      workflowId,
      runId: handle.runId,
      status: run?.status || "completed",
      result,
      duration: Date.now() - startTime,
      nodeStates: run?.nodeStates || {},
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
    patterns: (h.metadata.patterns || []).map((p) => ({
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

  const relativePath = new URL(req.url).searchParams.get("path") || "";
  if (relativePath.includes("..")) return errorResponse("Invalid path", 400);
  const fullPath = relativePath ? `${projectDir}/${relativePath}` : projectDir;

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

  const relativePath = new URL(req.url).searchParams.get("path") || "";
  if (!relativePath) return errorResponse("path parameter is required", 400);
  if (relativePath.includes("..")) return errorResponse("Invalid path", 400);

  try {
    const content = await adapter.fs.readFile(`${projectDir}/${relativePath}`);
    const extension = relativePath.split(".").pop() || "";

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
  const providers = providerRegistry.getAvailableProviders().map((name) => ({
    name,
    configured: providerRegistry.hasProvider(name),
  }));

  const allProviders = ["openai", "anthropic", "google"].map((name) => ({
    name,
    configured: providers.some((p) => p.name === name),
  }));

  const workflowNodeTypes = ["step", "parallel", "branch", "wait"];

  return jsonResponse({
    providers: allProviders,
    workflowNodeTypes,
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
  return descriptions[name] || name;
}

function getCategoryFromCode(code: string): string {
  const num = parseInt(code.replace("VF", ""), 10);
  if (num < 100) return "config";
  if (num < 200) return "build";
  if (num < 300) return "runtime";
  if (num < 400) return "route";
  if (num < 500) return "module";
  if (num < 600) return "server";
  if (num < 700) return "rsc";
  if (num < 800) return "dev";
  if (num < 900) return "deployment";
  return "general";
}

function handleGetErrors(): Response {
  const errors = Object.entries(ERROR_CATALOG).map(([code, solution]) => ({
    code,
    title: solution.title,
    category: getCategoryFromCode(code),
    message: solution.message,
    steps: solution.steps,
    docsUrl: solution.docs,
  }));

  const categories = errors.reduce<Record<string, number>>((acc, err) => {
    acc[err.category] = (acc[err.category] || 0) + 1;
    return acc;
  }, {});

  return jsonResponse({
    errors,
    categories,
    count: errors.length,
    timestamp: new Date().toISOString(),
  });
}

function handleGetConfig(ctx: HandlerContext): Response {
  const featureFlags = [
    {
      name: "RSC_ENABLED",
      value: isRSCEnabled(),
      source: "VERYFRONT_EXPERIMENTAL_RSC",
    },
  ];

  const env = getRuntimeEnv();
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
    projectDir: ctx.projectDir || "(unknown)",
    isLocalDev: ctx.requestContext?.isLocalDev ?? false,
    timestamp: new Date().toISOString(),
  });
}
