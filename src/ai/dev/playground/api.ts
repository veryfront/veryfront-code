/**
 * AI Playground API Handler
 */

import { PLAYGROUND_HTML } from "./client.ts";
import { toolRegistry } from "../../utils/tool.ts";
import { agentRegistry } from "../../agent/registry.ts";

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

    // Map registered agents to simple objects
    const agents = Array.from(agentRegistry.getAll().values()).map((agent) => ({
      id: agent.id,
      description: (agent.config as any).description || `Model: ${agent.config.model}`,
      model: agent.config.model,
    }));

    return new Response(
      JSON.stringify({
        agents,
        tools,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (url.pathname === "/_vf/playground/api/tool" && req.method === "POST") {
    try {
      const body = await req.json();
      const { toolName, args } = body;

      const tool = toolRegistry.get(toolName);
      if (!tool) {
        return new Response(JSON.stringify({ error: "Tool not found" }), { status: 404 });
      }

      const result = await tool.execute(args);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        { status: 500 },
      );
    }
  }

  // Chat endpoint
  if (url.pathname === "/_vf/playground/api/chat" && req.method === "POST") {
    try {
      const body = await req.json();
      const { agentId, message } = body;

      const agent = agentRegistry.get(agentId);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), { status: 404 });
      }

      // Execute agent
      const result = await agent.generate({ input: message });

      return new Response(
        JSON.stringify({
          response: result.text,
          toolCalls: result.toolCalls,
          usage: result.usage,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
}
