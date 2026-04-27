import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { createRemoteMCPToolSource, tool, toolRegistry } from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  executeConfiguredTool,
  getAvailableTools,
  parseToolArgs,
  resolveConfiguredTool,
} from "./tool-helpers.ts";

async function withMockRemoteIntegrationTools<T>(
  remoteToolNames: string[],
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_URL");
  const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
  globalThis.fetch = async () =>
    Response.json({
      tools: remoteToolNames.map((name) => ({
        name,
        description: `${name} description`,
        inputSchema: { type: "object", properties: {} },
      })),
    });

  try {
    Deno.env.set("VERYFRONT_API_URL", "https://api.test");
    Deno.env.set("VERYFRONT_API_TOKEN", "token");
    return await callback();
  } finally {
    if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
    else Deno.env.set("VERYFRONT_API_URL", originalApiBaseUrl);
    if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
    else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
    globalThis.fetch = originalFetch;
  }
}

describe("tool-helpers", () => {
  describe("parseToolArgs", () => {
    it("parses a valid JSON string into args", () => {
      const result = parseToolArgs('{"key": "value", "num": 42}');
      assertEquals(result.args, { key: "value", num: 42 });
      assertEquals(result.error, undefined);
    });

    it("passes through an object directly", () => {
      const input = { foo: "bar", nested: { a: 1 } };
      const result = parseToolArgs(input);
      assertEquals(result.args, input);
      assertEquals(result.error, undefined);
    });

    it("returns error for invalid JSON string", () => {
      const result = parseToolArgs("not-valid-json");
      assertEquals(result.args, {});
      assertEquals(typeof result.error, "string");
    });

    it("returns error for JSON array", () => {
      const result = parseToolArgs("[1, 2, 3]");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON primitive string", () => {
      const result = parseToolArgs('"hello"');
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON null", () => {
      const result = parseToolArgs("null");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("handles empty object", () => {
      const result = parseToolArgs("{}");
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });

    it("strips a transient leading empty-object placeholder before parsing real JSON", () => {
      const result = parseToolArgs('{}{"skillId":"plan"}');
      assertEquals(result.args, { skillId: "plan" });
      assertEquals(result.error, undefined);
    });

    it("strips repeated empty-object placeholders before parsing real JSON", () => {
      const result = parseToolArgs('{}  {}{"skillId":"plan"}');
      assertEquals(result.args, { skillId: "plan" });
      assertEquals(result.error, undefined);
    });

    it("repairs placeholder-prefixed streamed object bodies that omit the opening brace", () => {
      const result = parseToolArgs('{}"path":"/plans/report.md","content":"# Report"}');
      assertEquals(result.args, { path: "/plans/report.md", content: "# Report" });
      assertEquals(result.error, undefined);
    });

    it("handles empty object passed directly", () => {
      const result = parseToolArgs({});
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });
  });

  describe("resolveConfiguredTool", () => {
    it("returns an inline configured tool without requiring registry registration", () => {
      const injectedTool = tool({
        id: "studio_invoke_agent",
        description: "Invoke another project agent",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async ({ prompt }) => ({ echoed: prompt }),
      });

      const resolvedTool = resolveConfiguredTool(
        {
          studio_invoke_agent: injectedTool,
        },
        "studio_invoke_agent",
      );

      assertEquals(resolvedTool, injectedTool);
    });

    it("falls back to the shared registry when the config entry is true", () => {
      toolRegistry.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => ({ query }),
      });
      toolRegistry.register("shared-search", sharedTool);

      const resolvedTool = resolveConfiguredTool(
        {
          "shared-search": true,
        },
        "shared-search",
      );

      assertEquals(resolvedTool, sharedTool);
      toolRegistry.clearAll();
    });
  });

  describe("executeConfiguredTool", () => {
    it("executes an inline configured tool before consulting the registry", async () => {
      toolRegistry.clearAll();

      const injectedTool = tool({
        id: "studio_invoke_agent",
        description: "Invoke another project agent",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async ({ prompt }) => ({ text: prompt.toUpperCase() }),
      });

      const result = await executeConfiguredTool(
        "studio_invoke_agent",
        { prompt: "childself" },
        {
          studio_invoke_agent: injectedTool,
        },
        { toolCallId: "tool-1" },
      );

      assertEquals(result, { text: "CHILDSELF" });
    });

    it("falls back to the registry when no inline tool is configured", async () => {
      toolRegistry.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => ({ source: "registry", query }),
      });
      toolRegistry.register("shared-search", sharedTool);

      const result = await executeConfiguredTool(
        "shared-search",
        { query: "docs" },
        undefined,
        { toolCallId: "tool-2" },
      );

      assertEquals(result, { source: "registry", query: "docs" });
      toolRegistry.clearAll();
    });

    it("preserves the missing-tool error when nothing is configured", async () => {
      toolRegistry.clearAll();

      await assertRejects(
        () => executeConfiguredTool("studio_invoke_agent", { prompt: "test" }, undefined),
        Error,
        'Tool "studio_invoke_agent" not found',
      );
    });

    it("rejects remote integration tools excluded by the runtime allowlist", async () => {
      await assertRejects(
        () =>
          executeConfiguredTool(
            "gmail__list_emails",
            {},
            undefined,
            { toolCallId: "tool-3" },
            ["gmail__get_email"],
          ),
        Error,
        'Tool "gmail__list_emails" is not allowed for this run',
      );
    });

    it("executes remote MCP tools from configured remote tool sources", async () => {
      const remoteSource = createRemoteMCPToolSource({
        id: "docs",
        endpoint: "https://mcp.test",
      });

      const requestMethods: string[] = [];

      const result = await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const body = await request.json();
          const method = typeof body.method === "string" ? body.method : "";
          requestMethods.push(method);

          if (method === "tools/list") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [{
                  name: "search_docs",
                  description: "Search documentation",
                  inputSchema: { type: "object", properties: {} },
                }],
              },
            });
          }

          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              structuredContent: { matches: ["architecture.md"] },
            },
          });
        },
        async () =>
          await executeConfiguredTool(
            "search_docs",
            { query: "architecture" },
            undefined,
            { projectId: "proj_123" },
            undefined,
            [remoteSource],
          ),
      );

      assertEquals(requestMethods, ["tools/list", "tools/call"]);
      assertEquals(result, { matches: ["architecture.md"] });
    });
  });

  describe("getAvailableTools", () => {
    it("fails loudly when an explicit configured tool name does not match a discovered tool id", async () => {
      toolRegistry.clearAll();

      toolRegistry.register(
        "roll-dice",
        tool({
          id: "roll-dice",
          description: "Roll a die",
          inputSchema: z.object({}),
          execute: async () => ({ total: 4 }),
        }),
      );

      await assertRejects(
        () =>
          getAvailableTools(
            {
              rollDice: true,
            },
            { includeIntegrationTools: false },
          ),
        Error,
        'Unknown tool reference: rollDice. Tool names must exactly match tool({ id: "..." }). Available tools: roll-dice',
      );
    });

    it("filters remote integration tool definitions by the runtime allowlist", async () => {
      toolRegistry.clearAll();
      try {
        const defs = await withMockRemoteIntegrationTools([
          "gmail__list_emails",
          "gmail__get_email",
        ], () =>
          getAvailableTools(true, {
            allowedRemoteToolNames: ["gmail__get_email"],
          }));

        assertEquals(defs.map((def) => def.name), ["gmail__get_email"]);
      } finally {
        toolRegistry.clearAll();
      }
    });

    it("fails loudly when an explicit remote tool is missing from the discovered allowlist", async () => {
      toolRegistry.clearAll();

      try {
        await assertRejects(
          () =>
            withMockRemoteIntegrationTools(["gmail__list_emails"], () =>
              getAvailableTools(
                {
                  "gmail__get_email": true,
                },
                { allowedRemoteToolNames: ["gmail__list_emails"] },
              )),
          Error,
          'Unknown tool reference: gmail__get_email. Tool names must exactly match tool({ id: "..." }). Available tools: gmail__list_emails',
        );
      } finally {
        toolRegistry.clearAll();
      }
    });

    it("only appends explicitly requested remote definitions for explicit tool maps", async () => {
      toolRegistry.clearAll();

      try {
        const defs = await withMockRemoteIntegrationTools([
          "gmail__list_emails",
          "gmail__get_email",
        ], () =>
          getAvailableTools(
            {
              "gmail__get_email": true,
            },
            { allowedRemoteToolNames: ["gmail__list_emails", "gmail__get_email"] },
          ));

        assertEquals(defs.map((def) => def.name), ["gmail__get_email"]);
      } finally {
        toolRegistry.clearAll();
      }
    });

    it("resolves explicit integration tools from forwarded definitions when remote fetch is unavailable", async () => {
      toolRegistry.clearAll();

      try {
        // Simulates production: remote integration tool fetch fails (no API token),
        // but the API forwarded definitions via forwardedProps.
        const defs = await getAvailableTools(
          {
            "gmail__list_emails": true,
            "gmail__get_email": true,
          },
          {
            includeIntegrationTools: false,
            allowedRemoteToolNames: ["gmail__list_emails", "gmail__get_email"],
            forwardedRemoteToolDefinitions: [
              {
                name: "gmail__list_emails",
                description: "List emails from Gmail inbox",
                parameters: { type: "object", properties: {} },
              },
              {
                name: "gmail__get_email",
                description: "Get a specific email by ID",
                parameters: {
                  type: "object",
                  properties: { id: { type: "string" } },
                },
              },
            ],
          },
        );

        assertEquals(defs.map((def) => def.name).sort(), [
          "gmail__get_email",
          "gmail__list_emails",
        ]);
        assertEquals(
          defs.find((d) => d.name === "gmail__get_email")?.description,
          "Get a specific email by ID",
        );
      } finally {
        toolRegistry.clearAll();
      }
    });

    it("forwarded definitions are filtered by allowedRemoteToolNames", async () => {
      toolRegistry.clearAll();

      try {
        const defs = await getAvailableTools(true, {
          includeIntegrationTools: false,
          allowedRemoteToolNames: ["gmail__list_emails"],
          forwardedRemoteToolDefinitions: [
            {
              name: "gmail__list_emails",
              description: "List emails",
              parameters: { type: "object", properties: {} },
            },
            {
              name: "gmail__send_email",
              description: "Send an email",
              parameters: { type: "object", properties: {} },
            },
          ],
        });

        assertEquals(defs.map((def) => def.name), ["gmail__list_emails"]);
      } finally {
        toolRegistry.clearAll();
      }
    });

    it("merges generic remote MCP tool sources into available tools", async () => {
      toolRegistry.clearAll();

      const remoteSource = createRemoteMCPToolSource({
        id: "docs",
        endpoint: (context) => `https://mcp.test/${context?.projectId ?? "default"}`,
      });

      try {
        const defs = await withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: {
                tools: [{
                  name: "search_docs",
                  description: "Search documentation",
                  inputSchema: {},
                }],
              },
            }),
          async () =>
            await getAvailableTools(true, {
              includeIntegrationTools: false,
              remoteToolSources: [remoteSource],
              remoteToolContext: { projectId: "proj_123" },
            }),
        );

        assertEquals(defs.map((def) => def.name), ["search_docs"]);
      } finally {
        toolRegistry.clearAll();
      }
    });
  });
});
