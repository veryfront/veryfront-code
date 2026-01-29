import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MCPDevServer } from "./server.ts";
import type { MCPServerConfig } from "./server.ts";

describe("cli/mcp/server", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: MCPDevServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  describe("MCPDevServer constructor", () => {
    it("should create server with default config", () => {
      server = new MCPDevServer();
      assertExists(server);
    });

    it("should accept custom config", () => {
      const config: MCPServerConfig = {
        serverName: "test-server",
        serverVersion: "2.0.0",
      };
      server = new MCPDevServer(config);
      assertExists(server);
    });

    it("should accept stdio config", () => {
      const config: MCPServerConfig = {
        stdio: true,
      };
      server = new MCPDevServer(config);
      assertExists(server);
    });

    it("should accept httpPort config", () => {
      const config: MCPServerConfig = {
        httpPort: 9999,
      };
      server = new MCPDevServer(config);
      assertExists(server);
    });
  });

  describe("MCPDevServer stop", () => {
    it("should stop without starting", async () => {
      server = new MCPDevServer();
      await server.stop();
      server = null;
    });

    it("should be idempotent", async () => {
      server = new MCPDevServer();
      await server.stop();
      await server.stop();
      server = null;
    });
  });

  describe("MCPDevServer start", () => {
    it("should not throw when started without transports", () => {
      server = new MCPDevServer({});
      server.start();
    });

    it("should be idempotent", () => {
      server = new MCPDevServer({});
      server.start();
      server.start(); // second call should be no-op
    });
  });

  describe("MCPServerConfig type", () => {
    it("should accept empty config", () => {
      const config: MCPServerConfig = {};
      assertEquals(config.stdio, undefined);
      assertEquals(config.httpPort, undefined);
    });

    it("should accept all fields", () => {
      const config: MCPServerConfig = {
        stdio: true,
        httpPort: 3001,
        serverName: "my-mcp",
        serverVersion: "1.2.3",
      };
      assertEquals(config.stdio, true);
      assertEquals(config.httpPort, 3001);
      assertEquals(config.serverName, "my-mcp");
      assertEquals(config.serverVersion, "1.2.3");
    });
  });

  describe("handleInitialize via HTTP", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should return protocol version and capabilities via HTTP request handling", async () => {
      const portNum = 19876;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      // Give the server a moment to bind
      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        }),
      });

      assertEquals(response.status, 200);
      const data = await response.json();
      assertEquals(data.jsonrpc, "2.0");
      assertEquals(data.id, 1);
      assertExists(data.result);
      assertEquals(data.result.protocolVersion, "2024-11-05");
      assertExists(data.result.capabilities);
      assertExists(data.result.capabilities.tools);
      assertExists(data.result.capabilities.resources);
      assertExists(data.result.capabilities.prompts);
      assertExists(data.result.serverInfo);
      assertEquals(data.result.serverInfo.name, "veryfront-dev");
      assertEquals(data.result.serverInfo.version, "1.0.0");
    });

    it("should return custom server info", async () => {
      const portNum = 19877;
      server = new MCPDevServer({
        httpPort: portNum,
        serverName: "custom-name",
        serverVersion: "3.0.0",
      });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: {},
        }),
      });

      const data = await response.json();
      assertEquals(data.result.serverInfo.name, "custom-name");
      assertEquals(data.result.serverInfo.version, "3.0.0");
    });

    it("should return tools list", async () => {
      const portNum = 19878;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
        }),
      });

      const data = await response.json();
      assertEquals(data.jsonrpc, "2.0");
      assertEquals(data.id, 3);
      assertExists(data.result);
      assertExists(data.result.tools);
      assertEquals(Array.isArray(data.result.tools), true);
      // Each tool should have name, description, inputSchema
      for (const tool of data.result.tools) {
        assertExists(tool.name);
        assertExists(tool.description);
        assertExists(tool.inputSchema);
      }
    });

    it("should return resources list", async () => {
      const portNum = 19879;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "resources/list",
        }),
      });

      const data = await response.json();
      assertExists(data.result);
      assertExists(data.result.resources);
      assertEquals(Array.isArray(data.result.resources), true);

      const resourceUris = data.result.resources.map((r: { uri: string }) => r.uri);
      assertEquals(resourceUris.includes("veryfront://skill"), true);
      assertEquals(resourceUris.includes("veryfront://errors"), true);
      assertEquals(resourceUris.includes("veryfront://logs"), true);
      assertEquals(resourceUris.includes("issues://"), true);
    });

    it("should return prompts list", async () => {
      const portNum = 19880;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "prompts/list",
        }),
      });

      const data = await response.json();
      assertExists(data.result);
      assertExists(data.result.prompts);

      const promptNames = data.result.prompts.map((p: { name: string }) => p.name);
      assertEquals(promptNames.includes("veryfront"), true);
      assertEquals(promptNames.includes("flywheel"), true);
      assertEquals(promptNames.includes("veryfront-routing"), true);
      assertEquals(promptNames.includes("veryfront-ai-tools"), true);
      assertEquals(promptNames.includes("veryfront-components"), true);
    });

    it("should return error for unknown method", async () => {
      const portNum = 19881;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "nonexistent/method",
        }),
      });

      const data = await response.json();
      assertExists(data.error);
      assertEquals(data.error.code, -32603);
      assertEquals(data.error.message.includes("Unknown method"), true);
    });

    it("should return 404 for non-mcp path", async () => {
      const portNum = 19882;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/other`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      assertEquals(response.status, 404);
    });

    it("should return 405 for non-POST request", async () => {
      const portNum = 19883;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "GET",
      });

      assertEquals(response.status, 405);
    });

    it("should handle CORS preflight", async () => {
      const portNum = 19884;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" },
      });

      assertEquals(response.status, 204);
      const allowMethods = response.headers.get("Access-Control-Allow-Methods");
      assertExists(allowMethods);
      assertEquals(allowMethods.includes("POST"), true);
      await response.body?.cancel();
    });

    it("should set CORS origin for localhost", async () => {
      const portNum = 19885;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      });

      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        "http://localhost:3000",
      );
    });

    it("should handle malformed JSON", async () => {
      const portNum = 19886;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.error);
      assertEquals(data.error.code, -32700);
    });

    it("should return error for unknown tool call", async () => {
      const portNum = 19887;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await new Promise((r) => setTimeout(r, 200));

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "nonexistent_tool", arguments: {} },
        }),
      });

      const data = await response.json();
      assertExists(data.error);
      assertEquals(data.error.message.includes("Unknown tool"), true);
    });
  });
});
