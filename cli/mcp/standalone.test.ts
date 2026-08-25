import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for standalone MCP server
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
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

    it("tools/list includes context7 tools", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/list");
      const result = resp.result as {
        tools: { name: string }[];
      };
      const names = result.tools.map((t) => t.name);
      assertEquals(names.includes("c7_resolve_library"), true);
      assertEquals(names.includes("c7_query_docs"), true);
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

    it("tools/list includes vf_scaffold with auth enum parity", async () => {
      const server = new StandaloneMCPServer();
      const resp = await dispatch(server, "tools/list");
      const result = resp.result as {
        tools: {
          name: string;
          inputSchema: unknown;
        }[];
      };
      const scaffold = result.tools.find((tool) => tool.name === "vf_scaffold");

      assertExists(scaffold);
      assertEquals(getAuthPresetEnum(scaffold.inputSchema), [
        "authelia",
        "oidc",
        "microsoft-entra",
      ]);
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
      const content = result.contents[0];
      assertExists(content);
      assertEquals(content.uri, "veryfront://schema");
      const schema = JSON.parse(content.text);
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
      const content = result.contents[0];
      assertExists(content);
      const skills = JSON.parse(content.text);
      assertEquals(Array.isArray(skills), true);
      assertEquals(skills.length > 0, true);
      const names = skills.map((s: { name: string }) => s.name);
      assertEquals(names.includes("scaffold-app"), true);
      assertEquals(names.includes("deploy-safely"), true);
      for (const skill of skills) {
        assertEquals(Object.hasOwn(skill, "directory"), false);
      }
    });

    it("uses ASCII punctuation in public MCP and CLI schema copy", async () => {
      const server = new StandaloneMCPServer();
      const [tools, resources, schema] = await Promise.all([
        dispatch(server, "tools/list"),
        dispatch(server, "resources/list"),
        dispatch(server, "resources/read", { uri: "veryfront://schema" }),
      ]);
      const publicCopy = JSON.stringify([tools.result, resources.result, schema.result]);

      assertEquals(/[\u2013\u2014]/.test(publicCopy), false);
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
      const content = result.content[0];
      assertExists(content);
      const schema = JSON.parse(content.text);
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
      const content = result.content[0];
      assertExists(content);
      const schema = JSON.parse(content.text);
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
      const content = result.content[0];
      assertExists(content);
      const schema = JSON.parse(content.text);
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
      const content = result.content[0];
      assertExists(content);
      const info = JSON.parse(content.text);
      assertEquals(typeof info.version, "string");
    });

    it("tools/call vf_scaffold creates auth files and reports conflicts like dev MCP", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-auth-" });
      try {
        const server = new StandaloneMCPServer();
        const first = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "auth", name: "microsoft-entra", projectPath: projectDir },
        });
        const second = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "auth", name: "microsoft-entra", projectPath: projectDir },
        });
        const firstPayload = JSON.parse(
          (first.result as { content: { text: string }[] }).content[0]!
            .text,
        );
        const secondPayload = JSON.parse(
          (second.result as { content: { text: string }[] }).content[0]!
            .text,
        );

        assertEquals(firstPayload.success, true);
        assertEquals(firstPayload.files.map((file: { path: string }) => file.path), [
          ".env.auth.example",
          "AUTH_PROVIDER_SETUP.md",
          "AUTH_SETUP.md",
          "veryfront.auth.config.example.ts",
        ]);
        assertEquals(await fileExists(join(projectDir, "veryfront.auth.config.example.ts")), true);
        assertEquals(secondPayload.success, false);
        assertEquals(secondPayload.files.map((file: { path: string }) => file.path), [
          ".env.auth.example",
          "AUTH_PROVIDER_SETUP.md",
          "AUTH_SETUP.md",
          "veryfront.auth.config.example.ts",
        ]);
        assertEquals(secondPayload.message.includes(projectDir), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("tools/call vf_scaffold accepts a relative auth projectPath", async () => {
      const originalCwd = Deno.cwd();
      const parentDir = await Deno.makeTempDir({ prefix: "vf-standalone-relative-" });
      try {
        await Deno.mkdir(join(parentDir, "project"));
        Deno.chdir(parentDir);
        const server = new StandaloneMCPServer();
        const response = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "auth", name: "oidc", projectPath: "./project" },
        });
        const payload = parseToolPayload(response);

        assertEquals(payload.success, true);
        assertEquals(payload.files.map((file: { path: string }) => file.path), [
          ".env.auth.example",
          "AUTH_PROVIDER_SETUP.md",
          "AUTH_SETUP.md",
          "veryfront.auth.config.example.ts",
        ]);
        assertEquals(await fileExists(join(parentDir, "project", "AUTH_SETUP.md")), true);
      } finally {
        Deno.chdir(originalCwd);
        await Deno.remove(parentDir, { recursive: true });
      }
    });

    it("tools/call vf_scaffold rejects arguments that do not match the advertised schema", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-schema-" });
      try {
        const server = new StandaloneMCPServer();
        for (
          const argumentsValue of [
            { type: "auth", name: "oidc", projectPath: null },
            { type: "auth", name: "oidc", projectPath: 123 },
            { type: "auth", name: "secret-provider-token", projectPath: projectDir },
            { type: "api", name: "users", methods: ["GET", "TRACE"], projectPath: projectDir },
          ]
        ) {
          const response = await dispatch(server, "tools/call", {
            name: "vf_scaffold",
            arguments: argumentsValue,
          });

          const error = response.error as { code: number; message: string };
          assertEquals(error.code, -32602);
          assertStringIncludes(error.message, "Invalid vf_scaffold arguments");
          assertEquals(error.message.includes("secret-provider-token"), false);
        }
        assertEquals(await fileExists(join(projectDir, "AUTH_SETUP.md")), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("tools/call vf_scaffold reports non-auth scaffold paths without absolute paths", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-component-" });
      try {
        const server = new StandaloneMCPServer();
        const response = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "component", name: "user-card", projectPath: projectDir },
        });
        const payload = parseToolPayload(response);

        assertEquals(payload.success, true);
        assertEquals(payload.files, [{ path: "components/UserCard.tsx", created: true }]);
        assertEquals(payload.message.includes(projectDir), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("tools/call vf_scaffold accepts a relative non-auth projectPath", async () => {
      const originalCwd = Deno.cwd();
      const parentDir = await Deno.makeTempDir({ prefix: "vf-standalone-relative-component-" });
      try {
        await Deno.mkdir(join(parentDir, "project"));
        Deno.chdir(parentDir);
        const server = new StandaloneMCPServer();
        const response = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "component", name: "user-card", projectPath: "./project" },
        });
        const payload = parseToolPayload(response);

        assertEquals(payload.success, true);
        assertEquals(payload.files, [{ path: "components/UserCard.tsx", created: true }]);
        assertEquals(
          await fileExists(join(parentDir, "project", "components", "UserCard.tsx")),
          true,
        );
      } finally {
        Deno.chdir(originalCwd);
        await Deno.remove(parentDir, { recursive: true });
      }
    });

    it("tools/call vf_scaffold accepts an empty methods array and uses the default API method", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-empty-methods-" });
      try {
        const server = new StandaloneMCPServer();
        const response = await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "api", name: "status", methods: [], projectPath: projectDir },
        });
        const payload = parseToolPayload(response);

        assertEquals(payload.success, true);
        const content = await Deno.readTextFile(
          join(projectDir, "app", "api", "status", "route.ts"),
        );
        assertStringIncludes(content, "export const GET");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function parseToolPayload(response: { result?: unknown }): {
  success: boolean;
  files: Array<{ path: string; created: boolean }>;
  message: string;
} {
  const result = response.result as { content: { text: string }[] };
  return JSON.parse(result.content[0]!.text);
}

function getAuthPresetEnum(schema: unknown): unknown {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) return undefined;

  for (const variant of schema.anyOf) {
    if (!isRecord(variant) || !isRecord(variant.properties)) continue;
    const type = variant.properties.type;
    const name = variant.properties.name;
    if (!isRecord(type) || !isRecord(name)) continue;
    if (type.const === "auth") return name.enum;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
