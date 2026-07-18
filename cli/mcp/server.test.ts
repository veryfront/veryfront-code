import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "../../src/config/environment-config.ts";
import { MCPDevServer } from "./server.ts";
import type { MCPServerConfig } from "./server.ts";

const SERVER_BIND_DELAY_MS = 200;

function waitForServerBind(): Promise<void> {
  return new Promise((r) => setTimeout(r, SERVER_BIND_DELAY_MS));
}

async function postMcp(
  port: number,
  body: unknown,
  headers: HeadersInit = { "Content-Type": "application/json" },
): Promise<Response> {
  return await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("cli/mcp/server", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: MCPDevServer | null = null;

  afterEach(async () => {
    if (!server) return;
    await server.stop();
    server = null;
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
      const config: MCPServerConfig = { stdio: true };
      server = new MCPDevServer(config);
      assertExists(server);
    });

    it("should accept httpPort config", () => {
      const config: MCPServerConfig = { httpPort: 9999 };
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
      server.start();
    });

    it("contains HTTP bind failures and remains stoppable", async () => {
      const portNum = 19902;
      const primary = new MCPDevServer({ httpPort: portNum });
      const conflicting = new MCPDevServer({ httpPort: portNum });

      try {
        primary.start();
        await waitForServerBind();
        conflicting.start();
        await waitForServerBind();
        await conflicting.stop();
      } finally {
        await conflicting.stop();
        await primary.stop();
      }
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

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      assertEquals(response.status, 200);
      const data = await response.json();
      assertEquals(data.jsonrpc, "2.0");
      assertEquals(data.id, 1);
      assertExists(data.result);
      assertEquals(data.result.protocolVersion, "2025-11-25");
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

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {},
      });

      const data = await response.json();
      assertEquals(data.result.serverInfo.name, "custom-name");
      assertEquals(data.result.serverInfo.version, "3.0.0");
    });

    it("should return tools list", async () => {
      const portNum = 19878;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      });

      const data = await response.json();
      assertEquals(data.jsonrpc, "2.0");
      assertEquals(data.id, 3);
      assertExists(data.result);
      assertExists(data.result.tools);
      assertEquals(Array.isArray(data.result.tools), true);

      for (const tool of data.result.tools) {
        assertExists(tool.name);
        assertExists(tool.description);
        assertExists(tool.inputSchema);
      }

      const getErrorsTool = data.result.tools.find((tool: { name: string }) =>
        tool.name === "vf_get_errors"
      );
      assertExists(getErrorsTool);
      assertEquals(getErrorsTool.inputSchema.properties.type.enum, [
        "compile",
        "runtime",
        "bundle",
        "hmr",
        "module",
      ]);
      assertEquals(getErrorsTool.inputSchema.properties.limit.default, 50);
    });

    it("should return resources list", async () => {
      const portNum = 19879;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
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

    it("should omit secrets and local paths from the config resource", async () => {
      const portNum = 19901;
      _setEnvironmentConfigForTesting({
        nodeEnv: "test",
        veryfrontEnv: "development",
        veryfrontMode: "local",
        port: 4321,
        apiToken: "<TOKEN>",
        openaiApiKey: "<API_KEY>",
        anthropicApiKey: "<API_KEY>",
        googleApiKey: "<API_KEY>",
        githubToken: "<TOKEN>",
        redisUrl: "redis://<REDACTED>",
        otelHeaders: "authorization=<REDACTED>",
        homeDir: "/private/home",
        xdgConfigHome: "/private/config",
      });

      try {
        server = new MCPDevServer({ httpPort: portNum });
        server.start();
        await waitForServerBind();

        const response = await postMcp(portNum, {
          jsonrpc: "2.0",
          id: 41,
          method: "resources/read",
          params: { uri: "veryfront://config" },
        });
        const data = await response.json();
        const config = JSON.parse(data.result.contents[0].text);

        assertEquals(config.nodeEnv, "test");
        assertEquals(config.veryfrontEnv, "development");
        assertEquals(config.veryfrontMode, "local");
        assertEquals(config.port, 4321);
        for (
          const key of [
            "apiToken",
            "openaiApiKey",
            "anthropicApiKey",
            "googleApiKey",
            "githubToken",
            "redisUrl",
            "otelHeaders",
            "homeDir",
            "xdgConfigHome",
          ]
        ) {
          assertEquals(config[key], undefined, `Config resource exposed ${key}`);
        }
      } finally {
        _resetEnvironmentConfig();
      }
    });

    it("should return prompts list", async () => {
      const portNum = 19880;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 5,
        method: "prompts/list",
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

    it("should include title and annotations in tools/list response", async () => {
      const portNum = 19888;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
      });

      const data = await response.json();
      assertExists(data.result);
      assertExists(data.result.tools);

      for (const tool of data.result.tools) {
        assertExists(tool.title, `Tool ${tool.name} missing title in tools/list`);
        assertExists(tool.annotations, `Tool ${tool.name} missing annotations in tools/list`);
        assertEquals(
          typeof tool.annotations.readOnlyHint,
          "boolean",
          `Tool ${tool.name} must explicitly set readOnlyHint in tools/list`,
        );
        if (tool.annotations.readOnlyHint) {
          assertEquals(
            tool.annotations.destructiveHint ?? false,
            false,
            `Read-only tool ${tool.name} must not be destructive`,
          );
        }
      }
    });

    it("tools/list accepts cursor param without erroring", async () => {
      const portNum = 19889;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();
      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
        params: { cursor: "abc123" },
      });

      const data = await response.json();
      assertExists(data.result);
      assertEquals(data.error, undefined);
    });

    it("resources/list accepts cursor param without erroring", async () => {
      const portNum = 19890;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();
      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 12,
        method: "resources/list",
        params: { cursor: "abc123" },
      });

      const data = await response.json();
      assertExists(data.result);
      assertEquals(data.error, undefined);
    });

    it("prompts/list accepts cursor param without erroring", async () => {
      const portNum = 19891;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();
      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 13,
        method: "prompts/list",
        params: { cursor: "abc123" },
      });

      const data = await response.json();
      assertExists(data.result);
      assertEquals(data.error, undefined);
    });

    it("should return error for unknown method", async () => {
      const portNum = 19881;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 6,
        method: "nonexistent/method",
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

      await waitForServerBind();

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

      await waitForServerBind();

      const response = await fetch(`http://localhost:${portNum}/mcp`, {
        method: "GET",
      });

      assertEquals(response.status, 405);
    });

    it("should handle CORS preflight", async () => {
      const portNum = 19884;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

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

      await waitForServerBind();

      const response = await postMcp(
        portNum,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        },
        {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
      );

      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        "http://localhost:3000",
      );
    });

    it("should handle malformed JSON", async () => {
      const portNum = 19886;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, "not-json");

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.error);
      assertEquals(data.error.code, -32700);
    });

    it("should negotiate protocol version 2025-11-25", async () => {
      const portNum = 19890;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });

      const data = await response.json();
      assertEquals(data.result.protocolVersion, "2025-11-25");
    });

    it("should negotiate protocol version 2024-11-05", async () => {
      const portNum = 19891;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      });

      const data = await response.json();
      assertEquals(data.result.protocolVersion, "2024-11-05");
    });

    it("should fall back to newest version for unknown protocol version", async () => {
      const portNum = 19892;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      });

      const data = await response.json();
      assertEquals(data.result.protocolVersion, "2025-11-25");
    });

    it("should include serverInfo title and description", async () => {
      const portNum = 19893;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });

      const data = await response.json();
      assertExists(data.result.serverInfo.title);
      assertExists(data.result.serverInfo.description);
    });

    it("should include instructions field", async () => {
      const portNum = 19894;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });

      const data = await response.json();
      assertExists(data.result.instructions);
    });

    it("should include listChanged in capabilities", async () => {
      const portNum = 19895;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });

      const data = await response.json();
      assertEquals(data.result.capabilities.tools.listChanged, true);
      assertEquals(data.result.capabilities.resources.listChanged, true);
      assertEquals(data.result.capabilities.prompts.listChanged, true);
    });

    it("should handle notifications/initialized", async () => {
      const portNum = 19896;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "notifications/initialized",
      });

      assertEquals(response.status, 200);
      const data = await response.json();
      assertEquals(data.error, undefined);
    });

    it("should reject disallowed Origin with 403", async () => {
      const portNum = 19897;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(
        portNum,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
        },
      );

      assertEquals(response.status, 403);
      const data = await response.json();
      assertEquals(data.error.message, "Forbidden: Origin not allowed");
    });

    it("should reject origins whose hostname only starts with localhost", async () => {
      const portNum = 19900;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(
        portNum,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Origin: "http://localhost.evil.example:3000",
        },
      );

      assertEquals(response.status, 403);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("should allow request with no Origin header", async () => {
      const portNum = 19898;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      assertEquals(response.status, 200);
    });

    it("should allow localhost Origin", async () => {
      const portNum = 19899;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(
        portNum,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
      );

      assertEquals(response.status, 200);
    });

    it("should return error for unknown tool call", async () => {
      const portNum = 19887;
      server = new MCPDevServer({ httpPort: portNum });
      server.start();

      await waitForServerBind();

      const response = await postMcp(portNum, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      });

      const data = await response.json();
      assertExists(data.error);
      assertEquals(data.error.message.includes("Unknown tool"), true);
    });
  });
});
