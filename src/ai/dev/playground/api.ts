/**
 * AI Playground API Handler
 */

import { PLAYGROUND_HTML } from "./client.ts";
import { toolRegistry } from "../../utils/tool.ts";
import { agentRegistry } from "../../agent/composition.ts";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error: unknown, status = 500): Response {
  return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, status);
}

export async function handlePlaygroundRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Serve the HTML UI
  if (url.pathname === "/_vf/playground" || url.pathname === "/_vf/playground/") {
    return new Response(PLAYGROUND_HTML, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // API Endpoints
  if (url.pathname === "/_vf/playground/api/registry") {
    const tools = toolRegistry.getToolsForProvider();
    const agents = Array.from(agentRegistry.getAll().values()).map((agent) => ({
      id: agent.id,
      description: (agent.config as Record<string, unknown>).description ??
        `Model: ${agent.config.model}`,
      model: agent.config.model,
    }));

    return jsonResponse({ agents, tools });
  }

  if (url.pathname === "/_vf/playground/api/tool" && req.method === "POST") {
    try {
      const { toolName, args } = await req.json();
      const tool = toolRegistry.get(toolName);
      if (!tool) return jsonResponse({ error: "Tool not found" }, 404);

      const result = await tool.execute(args);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(error);
    }
  }

  // Chat endpoint
  if (url.pathname === "/_vf/playground/api/chat" && req.method === "POST") {
    try {
      const { agentId, message } = await req.json();
      const agent = agentRegistry.get(agentId);
      if (!agent) return jsonResponse({ error: "Agent not found" }, 404);

      const result = await agent.generate({ input: message });
      return jsonResponse({
        response: result.text,
        toolCalls: result.toolCalls,
        usage: result.usage,
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return new Response("Not Found", { status: 404 });
}
