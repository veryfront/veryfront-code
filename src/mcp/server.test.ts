import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicTool } from "#veryfront/tool";
import { z } from "zod";
import { clearConnectorCache } from "../integrations/connector-fetcher.ts";
import type { IntegrationConnector } from "../integrations/types.ts";
import { clearMCPRegistry, registerTool } from "./registry.ts";
import { createMCPServer } from "./server.ts";

const originalFetch = globalThis.fetch;

const mockConnector: IntegrationConnector = {
  name: "github",
  display_name: "GitHub",
  description: "GitHub integration",
  auth: { type: "oauth2", provider: "github" },
  tools: [
    {
      id: "list-repos",
      name: "List Repositories",
      description: "List repos",
      requires_write: false,
      endpoint: {
        method: "GET",
        url: "https://api.github.com/user/repos",
      },
    },
  ],
};

describe("mcp/server", () => {
  beforeEach(() => {
    clearMCPRegistry();
    clearConnectorCache();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    clearMCPRegistry();
    clearConnectorCache();
    globalThis.fetch = originalFetch;
  });

  it("extracts end-user and project IDs from HTTP headers into tool context", async () => {
    const server = createMCPServer({ enabled: true });
    let capturedContext: { endUserId?: string; projectId?: string } | undefined;

    registerTool(
      "test:context",
      dynamicTool({
        id: "test:context",
        description: "Echo tool context",
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context as typeof capturedContext;
          return { ok: true };
        },
      }),
    );

    const handler = server.createHTTPHandler();
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-end-user-id": "user_123",
        "x-project-id": "proj-abc_123",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:context", arguments: {} },
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertExists(capturedContext);
    assertEquals(capturedContext?.endUserId, "user_123");
    assertEquals(capturedContext?.projectId, "proj-abc_123");
  });

  it("includes integration context headers in CORS preflight response", async () => {
    const server = createMCPServer({
      enabled: true,
      cors: { enabled: true, origins: ["https://example.com"] },
    });

    const handler = server.createHTTPHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "OPTIONS",
        headers: { "Origin": "https://example.com" },
      }),
    );

    assertEquals(response.status, 204);
    const allowHeaders = response.headers.get("Access-Control-Allow-Headers");
    assertExists(allowHeaders);
    assertStringIncludes(allowHeaders, "X-End-User-Id");
    assertStringIncludes(allowHeaders, "X-Project-Id");
  });

  it("retries loading integrations on subsequent tools/list after a failed fetch", async () => {
    const server = createMCPServer({ enabled: true });
    server.setIntegrationLoader({
      integrations: { github: {} },
      apiBaseUrl: "https://api.example.com",
    });

    let connectorFetchCount = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://api.example.com/integrations/github") {
        throw new Error(`Unexpected URL: ${url}`);
      }

      connectorFetchCount++;
      if (connectorFetchCount === 1) {
        return new Response("Internal Server Error", { status: 500 });
      }

      return new Response(JSON.stringify(mockConnector), {
        headers: { "content-type": "application/json" },
      });
    };

    const first = await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const firstTools = (first.result as { tools: Array<{ name: string }> }).tools;
    assertEquals(firstTools.some((tool) => tool.name === "github:list-repos"), false);

    const second = await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const secondTools = (second.result as { tools: Array<{ name: string }> }).tools;
    assertEquals(secondTools.some((tool) => tool.name === "github:list-repos"), true);
    assertEquals(connectorFetchCount, 2);
  });
});
