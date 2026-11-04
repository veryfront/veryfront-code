import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { Agent } from "#veryfront/agent";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";

describe("runtime allowlist discovery MCP session cleanup", () => {
  for (const discoveryFails of [false, true]) {
    it(`releases temporary MCP sessions after restrictive discovery (failure: ${discoveryFails})`, async () => {
      let deleted = 0;
      let allowed: string[] | undefined;
      const agent = {
        id: "remote-agent",
        config: {
          model: "anthropic/claude-opus-4-6",
          system: "test",
          mcpServers: [{
            id: "remote",
            transport: { type: "http", url: "https://93.184.216.34/mcp" },
          }],
        },
      } as unknown as Agent;
      await withMockFetch(async (_input, init) => {
        const request = observeFetchRequestInit(init);
        if (request.method === "DELETE") {
          assertEquals(new Headers(request.headers).get("Mcp-Session-Id"), "discovery-session");
          deleted++;
          return new Response(null, { status: 204 });
        }
        const body = JSON.parse(String(request.body));
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-11-25" },
          }, { headers: { "Mcp-Session-Id": "discovery-session" } });
        }
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (!new Headers(request.headers).has("Mcp-Session-Id")) {
          return new Response("initialize first", { status: 400 });
        }
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: discoveryFails
              ? "invalid catalog"
              : [{ name: "ping", description: "Synthetic remote tool", inputSchema: {} }],
          },
        });
      }, async () => {
        const response = await createRuntimeAgentStreamResponse(
          {
            threadId: crypto.randomUUID(),
            runId: "discovery-run",
            messages: [],
            tools: [],
            context: [],
            forwardedProps: { runtimeOverrides: { toolAllowlist: ["ping"] } },
          },
          agent,
          {
            sessionManager: new AgentRunSessionManager(),
            createRuntime: (runtimeAgent) => {
              assertEquals(deleted, 1, "temporary session must close before the runtime starts");
              allowed = (runtimeAgent.config as { __vfAllowedRemoteTools?: string[] })
                .__vfAllowedRemoteTools;
              return {
                stream: async () =>
                  new ReadableStream({ start: (controller) => controller.close() }),
              };
            },
          },
        );
        await response.text();
      });
      assertEquals(allowed, discoveryFails ? [] : ["ping"]);
      assertEquals(deleted, 1);
    });
  }
});
