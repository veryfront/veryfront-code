import { getMCPRegistry, getMCPStats } from "@veryfront/ai/mcp/registry.ts";
import { executeTool, toolRegistry } from "@veryfront/ai/utils/tool.ts";
import { resourceRegistry } from "@veryfront/ai/mcp/resource.ts";
import { promptRegistry } from "@veryfront/ai/mcp/prompt.ts";
import { agentRegistry } from "@veryfront/ai/agent/composition.ts";
import { metrics } from "@veryfront/observability/simple-metrics/index.ts";
import type { HandlerContext } from "../../types.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-cache" };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export function handleDashboardAPI(
  req: Request,
  ctx: HandlerContext,
): Promise<Response | null> | Response | null {
  const { pathname } = new URL(req.url);
  const { method } = req;

  if (method === "GET") {
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
      case "/_dev/api/handlers":
        return handleListHandlers(ctx);
      case "/_dev/api/metrics":
        return handleGetMetrics();
      case "/_dev/api/files":
        return handleListFiles(req, ctx);
      case "/_dev/api/file-content":
        return handleReadFileContent(req, ctx);
    }
  }

  if (method === "POST") {
    switch (pathname) {
      case "/_dev/api/execute-tool":
        return handleExecuteTool(req);
      case "/_dev/api/read-resource":
        return handleReadResource(req);
      case "/_dev/api/render-prompt":
        return handleRenderPrompt(req);
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
  const list = Array.from(agentRegistry.getAll().entries()).map(([id, agent]) => {
    const cfg = agent.config as unknown as Record<string, unknown>;
    return {
      id,
      description: (cfg.description as string) || `Model: ${agent.config.model}`,
      model: agent.config.model,
      tools: cfg.tools || {},
      prompts: cfg.prompts || {},
      resources: cfg.resources || {},
      memory: cfg.memory || null,
      streaming: cfg.streaming || false,
      maxSteps: cfg.maxSteps || null,
    };
  });
  return jsonResponse({ agents: list, count: list.length });
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
    return errorResponse(error instanceof Error ? error.message : String(error));
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
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

async function handleRenderPrompt(req: Request): Promise<Response> {
  try {
    const { promptId, variables } = await req.json();
    if (!promptId) return errorResponse("promptId is required", 400);

    const content = await promptRegistry.getContent(promptId, variables || {});
    if (content === undefined) return errorResponse(`Prompt not found: ${promptId}`, 404);

    return jsonResponse({ success: true, promptId, content, variablesUsed: variables || {} });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
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
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

async function handleListFiles(req: Request, ctx: HandlerContext): Promise<Response> {
  const { adapter, projectDir } = ctx;
  if (!adapter?.fs) return errorResponse("No file adapter available", 500);
  if (!projectDir) return errorResponse("No project directory configured", 500);

  const relativePath = new URL(req.url).searchParams.get("path") || "";
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
    files.sort((
      a,
      b,
    ) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
    return jsonResponse({ files, path: relativePath, projectDir, count: files.length });
  } catch (e) {
    return jsonResponse({
      files: [],
      path: relativePath,
      projectDir,
      error: e instanceof Error ? e.message : String(e),
    });
  }
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

async function handleReadFileContent(req: Request, ctx: HandlerContext): Promise<Response> {
  const { adapter, projectDir } = ctx;
  if (!adapter?.fs) return errorResponse("No file adapter available", 500);
  if (!projectDir) return errorResponse("No project directory configured", 500);

  const relativePath = new URL(req.url).searchParams.get("path") || "";
  if (!relativePath) return errorResponse("path parameter is required", 400);

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
  } catch (e) {
    return jsonResponse({ path: relativePath, error: e instanceof Error ? e.message : String(e) });
  }
}
