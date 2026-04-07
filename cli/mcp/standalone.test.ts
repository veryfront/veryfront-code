/**
 * Tests for standalone MCP server
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStandaloneMCPServer,
  type StandaloneMCPConfig,
  StandaloneMCPServer,
} from "./standalone.ts";

describe("mcp/standalone", () => {
  describe("StandaloneMCPServer class", () => {
    it("is a class", () => {
      assertEquals(typeof StandaloneMCPServer, "function");
    });

    it("can be instantiated with default config", () => {
      const server = new StandaloneMCPServer();
      assertExists(server);
    });

    it("can be instantiated with custom port", () => {
      const config: StandaloneMCPConfig = { port: 9999 };
      const server = new StandaloneMCPServer(config);
      assertExists(server);
    });

    it("has start method", () => {
      const server = new StandaloneMCPServer();
      assertEquals(typeof server.start, "function");
    });

    it("has stop method", () => {
      const server = new StandaloneMCPServer();
      assertEquals(typeof server.stop, "function");
    });
  });

  describe("createStandaloneMCPServer factory", () => {
    it("is a function", () => {
      assertEquals(typeof createStandaloneMCPServer, "function");
    });
  });

  describe("StandaloneMCPConfig interface", () => {
    it("supports optional port", () => {
      const config1: StandaloneMCPConfig = {};
      const config2: StandaloneMCPConfig = { port: 8080 };

      assertEquals(config1.port, undefined);
      assertEquals(config2.port, 8080);
    });
  });

  describe("JSON-RPC dispatch", () => {
    // Access private handleRequest via type assertion for testing
    function dispatch(
      server: StandaloneMCPServer,
      method: string,
      params: unknown = {},
    ): Promise<{ id: number; result?: unknown; error?: unknown }> {
      // deno-lint-ignore no-explicit-any
      return (server as any).handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      });
    }

    it("initialize returns capabilities with resources", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "initialize");
      const result = resp.result as {
        capabilities: Record<string, unknown>;
      };
      assertExists(result.capabilities.tools);
      assertExists(result.capabilities.resources);
      assertExists(result.capabilities.prompts);
    });

    it("tools/list includes introspection tools", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/list");
      const result = resp.result as {
        tools: { name: string; description: string }[];
      };
      const names = result.tools.map((t) => t.name);
      assertEquals(names.includes("vf_get_schema"), true);
      assertEquals(names.includes("vf_get_project_info"), true);
    });

    it("tools/list includes dev server tools", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/list");
      const result = resp.result as {
        tools: { name: string }[];
      };
      const names = result.tools.map((t) => t.name);
      assertEquals(names.includes("vf_get_errors"), true);
      assertEquals(names.includes("vf_get_logs"), true);
      assertEquals(names.includes("vf_get_status"), true);
      assertEquals(names.includes("vf_trigger_hmr"), true);
    });

    it("resources/list returns schema, agents-md, and skills", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "resources/list");
      const result = resp.result as {
        resources: { uri: string; name: string }[];
      };
      const uris = result.resources.map((r) => r.uri);
      assertEquals(uris.includes("veryfront://schema"), true);
      assertEquals(uris.includes("veryfront://agents-md"), true);
      assertEquals(uris.includes("veryfront://skills"), true);
    });

    it("resources/read veryfront://schema returns command schema", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "resources/read", {
        uri: "veryfront://schema",
      });
      const result = resp.result as {
        contents: { uri: string; text: string }[];
      };
      assertEquals(result.contents.length, 1);
      assertEquals(result.contents[0].uri, "veryfront://schema");
      const schema = JSON.parse(result.contents[0].text);
      assertEquals(typeof schema.version, "string");
      assertEquals(Array.isArray(schema.commands), true);
      assertEquals(schema.commands.length > 0, true);
    });

    it("resources/read veryfront://skills returns core skills", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "resources/read", {
        uri: "veryfront://skills",
      });
      const result = resp.result as {
        contents: { uri: string; text: string }[];
      };
      const skills = JSON.parse(result.contents[0].text);
      assertEquals(Array.isArray(skills), true);
      assertEquals(skills.length > 0, true);
      const names = skills.map((s: { name: string }) => s.name);
      assertEquals(names.includes("scaffold-app"), true);
      assertEquals(names.includes("deploy-safely"), true);
    });

    it("resources/read unknown URI returns error", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "resources/read", {
        uri: "veryfront://nonexistent",
      });
      assertExists(resp.error);
    });

    it("tools/call vf_get_schema returns full schema", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/call", {
        name: "vf_get_schema",
        arguments: {},
      });
      const result = resp.result as {
        content: { text: string }[];
      };
      const schema = JSON.parse(result.content[0].text);
      assertEquals(typeof schema.version, "string");
      assertEquals(Array.isArray(schema.commands), true);
    });

    it("tools/call vf_get_schema filters by command", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/call", {
        name: "vf_get_schema",
        arguments: { command: "deploy" },
      });
      const result = resp.result as {
        content: { text: string }[];
      };
      const schema = JSON.parse(result.content[0].text);
      assertEquals(schema.name, "deploy");
      assertEquals(schema.category, "deploy");
    });

    it("tools/call vf_get_schema filters by category", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/call", {
        name: "vf_get_schema",
        arguments: { category: "auth" },
      });
      const result = resp.result as {
        content: { text: string }[];
      };
      const schema = JSON.parse(result.content[0].text);
      assertEquals(Array.isArray(schema.commands), true);
      for (const cmd of schema.commands) {
        assertEquals(cmd.category, "auth");
      }
    });

    it("tools/call vf_get_project_info returns version", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/call", {
        name: "vf_get_project_info",
        arguments: {},
      });
      const result = resp.result as {
        content: { text: string }[];
      };
      const info = JSON.parse(result.content[0].text);
      assertEquals(typeof info.version, "string");
    });

    it("tools/list accepts cursor param without erroring", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/list", { cursor: "abc123" });
      assertExists(resp.result);
      assertEquals(resp.error, undefined);
    });

    it("resources/list accepts cursor param without erroring", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "resources/list", { cursor: "abc123" });
      assertExists(resp.result);
      assertEquals(resp.error, undefined);
    });

    it("prompts/list accepts cursor param without erroring", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "prompts/list", { cursor: "abc123" });
      assertExists(resp.result);
      assertEquals(resp.error, undefined);
    });

    it("unknown method returns error", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "nonexistent/method");
      assertExists(resp.error);
    });

    it("tools/call unknown tool returns error", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/call", {
        name: "nonexistent_tool",
        arguments: {},
      });
      assertExists(resp.error);
    });
  });
});
