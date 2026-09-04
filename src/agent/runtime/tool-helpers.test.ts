import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type RemoteToolSource,
  tool,
  toolRegistry,
} from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  executeConfiguredTool,
  getAvailableTools,
  parseToolArgs,
  resolveConfiguredTool,
} from "./tool-helpers.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";

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

async function withContextOnlyRemoteIntegrationTools<T>(
  callback: () => Promise<T>,
): Promise<{ result: T; authorization: string | null }> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_URL");
  const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
  let authorization: string | null = null;
  globalThis.fetch = async (input, init) => {
    authorization = new Request(input, init).headers.get("authorization");
    return Response.json({
      tools: [{
        name: "gmail__list_emails",
        description: "List emails",
        inputSchema: { type: "object", properties: {} },
      }],
    });
  };

  try {
    Deno.env.set("VERYFRONT_API_URL", "https://api.test");
    Deno.env.delete("VERYFRONT_API_TOKEN");
    return { result: await callback(), authorization };
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
        inputSchema: defineSchema((v) => v.object({ prompt: v.string() }))(),
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
      toolRegistryInternal.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
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
      toolRegistryInternal.clearAll();
    });
  });

  describe("executeConfiguredTool", () => {
    it("executes an inline configured tool before consulting the registry", async () => {
      toolRegistryInternal.clearAll();

      const injectedTool = tool({
        id: "studio_invoke_agent",
        description: "Invoke another project agent",
        inputSchema: defineSchema((v) => v.object({ prompt: v.string() }))(),
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
      toolRegistryInternal.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
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
      toolRegistryInternal.clearAll();
    });

    it("preserves the missing-tool error when nothing is configured", async () => {
      toolRegistryInternal.clearAll();

      await assertRejects(
        () => executeConfiguredTool("studio_invoke_agent", { prompt: "test" }, undefined),
        Error,
        'Tool "studio_invoke_agent" not found',
      );
    });

    it("strict configured-tool execution does not fall through to the registry", async () => {
      toolRegistryInternal.clearAll();

      toolRegistry.register(
        "shared-search",
        tool({
          id: "shared-search",
          description: "Shared search",
          inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
          execute: async ({ query }) => ({ source: "registry", query }),
        }),
      );

      await assertRejects(
        () =>
          executeConfiguredTool(
            "shared-search",
            { query: "docs" },
            {},
            { toolCallId: "tool-strict" },
            undefined,
            undefined,
            undefined,
            { strictConfiguredToolsOnly: true },
          ),
        Error,
        'Tool "shared-search" is not available in request-scoped replacement tools',
      );
      toolRegistryInternal.clearAll();
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

    it("does not execute a materialized remote tool excluded by the runtime allowlist", async () => {
      const executedToolNames: string[] = [];
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async (toolName) => {
          executedToolNames.push(toolName);
          return { ok: true };
        },
      };
      const configuredTools = createToolsFromRemoteDefinitions(source, [
        {
          name: "gmail__list_emails",
          description: "List emails",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "gmail__delete_email",
          description: "Delete an email",
          parameters: { type: "object", properties: {} },
        },
      ]);

      await assertRejects(
        () =>
          executeConfiguredTool(
            "gmail__delete_email",
            {},
            configuredTools,
            { toolCallId: "tool-remote-denied" },
            ["gmail__list_emails"],
          ),
        Error,
        'Tool "gmail__delete_email" is not allowed for this run',
      );
      assertEquals(executedToolNames, []);
    });

    it("does not let an allowed alias execute a denied canonical remote tool", async () => {
      const executedToolNames: string[] = [];
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async (toolName) => {
          executedToolNames.push(toolName);
          return { ok: true };
        },
      };
      const configuredTools = createToolsFromRemoteDefinitions(
        source,
        [{
          name: "gmail__delete_email",
          description: "Delete an email",
          parameters: { type: "object", properties: {} },
        }],
        {
          toolNameAliases: {
            gmail__delete_email: "delete_email",
          },
        },
      );

      await assertRejects(
        () =>
          executeConfiguredTool(
            "delete_email",
            {},
            configuredTools,
            { toolCallId: "tool-remote-alias-denied" },
            ["delete_email"],
          ),
        Error,
        'Tool "gmail__delete_email" is not allowed for this run',
      );
      assertEquals(executedToolNames, []);
    });

    it("applies source integration policy to an aliased remote tool's canonical name", async () => {
      const executedToolNames: string[] = [];
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async (toolName) => {
          executedToolNames.push(toolName);
          return { ok: true };
        },
      };
      const configuredTools = createToolsFromRemoteDefinitions(
        source,
        [{
          name: "gmail__delete_email",
          description: "Delete an email",
          parameters: { type: "object", properties: {} },
        }],
        {
          toolNameAliases: {
            gmail__delete_email: "delete_email",
          },
        },
      );

      await assertRejects(
        () =>
          executeConfiguredTool(
            "delete_email",
            {},
            configuredTools,
            { toolCallId: "tool-remote-alias-policy-denied" },
            ["gmail__delete_email"],
            undefined,
            {
              schemaVersion: 1,
              mode: "allowlist",
              integrations: { gmail: { allowedToolIds: ["list_emails"] } },
            },
          ),
        Error,
        'Tool "gmail__delete_email" is not allowed by the source integration policy',
      );
      assertEquals(executedToolNames, []);
    });

    it("enforces source integration policy before inline or fallback execution", async () => {
      let executed = false;
      const deniedTool = tool({
        id: "gmail__delete_email",
        description: "Delete an email",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          executed = true;
          return { deleted: true };
        },
      });

      await assertRejects(
        () =>
          executeConfiguredTool(
            "gmail__delete_email",
            {},
            { gmail__delete_email: deniedTool },
            undefined,
            undefined,
            undefined,
            {
              schemaVersion: 1,
              mode: "allowlist",
              integrations: { gmail: { allowedToolIds: ["list_emails"] } },
            },
          ),
        Error,
        'Tool "gmail__delete_email" is not allowed by the source integration policy',
      );
      assertEquals(executed, false);
    });

    it("passes runtime run and agent context to remote integration tool execution", async () => {
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      let requestUrl: string | undefined;
      let requestBody: Record<string, unknown> | undefined;

      try {
        Deno.env.set("VERYFRONT_API_URL", "https://api.test");
        Deno.env.set("VERYFRONT_API_TOKEN", "token");

        const result = await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            requestUrl = request.url;
            requestBody = await request.json();
            return Response.json({ structuredContent: { ok: true } });
          },
          async () =>
            await executeConfiguredTool(
              "gmail__list_emails",
              { maxResults: 10 },
              undefined,
              {
                toolCallId: "tool-4",
                runId: "run-123",
                agentId: "agent-123",
              },
              ["gmail__list_emails"],
            ),
        );

        assertEquals(result, { structuredContent: { ok: true } });
        assertEquals(
          requestUrl,
          "https://api.test/integrations/gmail/tools/list_emails/call",
        );
        assertEquals(requestBody, {
          arguments: { maxResults: 10 },
          run_id: "run-123",
          agent_id: "agent-123",
        });
      } finally {
        if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
        else Deno.env.set("VERYFRONT_API_URL", originalApiBaseUrl);
        if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
        else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    });

    it("executes remote MCP tools from configured remote tool sources", async () => {
      const remoteSource = createRemoteMCPToolSource({
        id: "docs",
        endpoint: "https://93.184.216.34",
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
    it("does not insert tool definitions through a patched array push", async () => {
      toolRegistryInternal.clearAll();
      const originalPush = Array.prototype.push;
      toolRegistry.register(
        "allowed_lookup",
        tool({
          id: "allowed_lookup",
          description: "Allowed lookup",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => "ok",
        }),
      );
      Array.prototype.push = function (...items: unknown[]): number {
        const length = Reflect.apply(originalPush, this, items) as number;
        const first = items[0] as { name?: unknown } | undefined;
        if (first?.name === "allowed_lookup") {
          Reflect.apply(originalPush, this, [{
            name: "denied_delete",
            description: "Injected denied tool",
            parameters: { type: "object", properties: {} },
          }]);
        }
        return length;
      };

      let definitions;
      try {
        definitions = await getAvailableTools(
          { allowed_lookup: true },
          { includeIntegrationTools: false },
        );
      } finally {
        Array.prototype.push = originalPush;
        toolRegistryInternal.clearAll();
      }

      assertEquals(definitions.map((definition) => definition.name), ["allowed_lookup"]);
    });

    it("fails loudly when an explicit configured tool name does not match a discovered tool id", async () => {
      toolRegistryInternal.clearAll();

      toolRegistry.register(
        "roll-dice",
        tool({
          id: "roll-dice",
          description: "Roll a die",
          inputSchema: defineSchema((v) => v.object({}))(),
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
      toolRegistryInternal.clearAll();
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
        toolRegistryInternal.clearAll();
      }
    });

    it("uses request-scoped auth when listing integration tools", async () => {
      const { result, authorization } = await withContextOnlyRemoteIntegrationTools(() =>
        getAvailableTools(true, {
          remoteToolContext: {
            authToken: "context-token",
            projectId: "project-id",
          },
        })
      );

      assertEquals(result.map((definition) => definition.name), ["gmail__list_emails"]);
      assertEquals(authorization, "Bearer context-token");
    });

    it("does not use the mutable public skill-tool set for filtering", async () => {
      const originalSkillToolIds = [...SKILL_TOOL_IDS];
      toolRegistryInternal.clearAll();
      try {
        toolRegistry.register(
          "execute_skill_script",
          tool({
            id: "execute_skill_script",
            description: "Execute a skill script",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => null,
          }),
        );
        toolRegistry.register(
          "ordinary_tool",
          tool({
            id: "ordinary_tool",
            description: "Ordinary tool",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => null,
          }),
        );
        SKILL_TOOL_IDS.delete("execute_skill_script");
        SKILL_TOOL_IDS.add("ordinary_tool");

        const definitions = await getAvailableTools(true, {
          includeIntegrationTools: false,
        });

        assertEquals(definitions.map((definition) => definition.name), ["ordinary_tool"]);
      } finally {
        SKILL_TOOL_IDS.clear();
        for (const toolId of originalSkillToolIds) SKILL_TOOL_IDS.add(toolId);
        toolRegistryInternal.clearAll();
      }
    });

    it("does not advertise materialized remote tools excluded by the runtime allowlist", async () => {
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async () => ({ ok: true }),
      };
      const configuredTools = createToolsFromRemoteDefinitions(source, [
        {
          name: "gmail__list_emails",
          description: "List emails",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "gmail__delete_email",
          description: "Delete an email",
          parameters: { type: "object", properties: {} },
        },
      ]);

      const defs = await getAvailableTools(configuredTools, {
        includeIntegrationTools: false,
        allowedRemoteToolNames: ["gmail__list_emails"],
      });

      assertEquals(defs.map((def) => def.name), ["gmail__list_emails"]);
    });

    it("does not advertise an alias for a denied canonical remote tool", async () => {
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async () => ({ ok: true }),
      };
      const configuredTools = createToolsFromRemoteDefinitions(
        source,
        [{
          name: "gmail__delete_email",
          description: "Delete an email",
          parameters: { type: "object", properties: {} },
        }],
        {
          toolNameAliases: {
            gmail__delete_email: "delete_email",
          },
        },
      );

      const allowlistFiltered = await getAvailableTools(configuredTools, {
        includeIntegrationTools: false,
        allowedRemoteToolNames: ["delete_email"],
      });
      const policyFiltered = await getAvailableTools(configuredTools, {
        includeIntegrationTools: false,
        allowedRemoteToolNames: ["gmail__delete_email"],
        sourceIntegrationPolicy: {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { gmail: { allowedToolIds: ["list_emails"] } },
        },
      });

      assertEquals(allowlistFiltered, []);
      assertEquals(policyFiltered, []);
    });

    it("advertises and executes an allowed canonical remote tool through an integration-style alias", async () => {
      const executedToolNames: string[] = [];
      const source: RemoteToolSource = {
        id: "veryfront-api",
        listTools: async () => [],
        executeTool: async (toolName) => {
          executedToolNames.push(toolName);
          return { ok: true };
        },
      };
      const configuredTools = createToolsFromRemoteDefinitions(
        source,
        [{
          name: "gmail__list_emails",
          description: "List emails",
          parameters: { type: "object", properties: {} },
        }],
        {
          toolNameAliases: {
            gmail__list_emails: "mail__list",
          },
        },
      );
      const sourceIntegrationPolicy = {
        schemaVersion: 1 as const,
        mode: "allowlist" as const,
        integrations: { gmail: { allowedToolIds: ["list_emails"] } },
      };

      const definitions = await getAvailableTools(configuredTools, {
        includeIntegrationTools: false,
        allowedRemoteToolNames: ["gmail__list_emails"],
        sourceIntegrationPolicy,
      });
      const result = await executeConfiguredTool(
        "mail__list",
        {},
        configuredTools,
        { toolCallId: "tool-remote-integration-alias-allowed" },
        ["gmail__list_emails"],
        undefined,
        sourceIntegrationPolicy,
      );

      assertEquals(definitions.map((definition) => definition.name), ["mail__list"]);
      assertEquals(result, { ok: true });
      assertEquals(executedToolNames, ["gmail__list_emails"]);
    });

    it("enforces source integration policy for tools true and unknown connector versions", async () => {
      toolRegistryInternal.clearAll();
      try {
        toolRegistry.register(
          "local_search",
          tool({
            id: "local_search",
            description: "Local search",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => ({ ok: true }),
          }),
        );

        const defs = await getAvailableTools(true, {
          includeIntegrationTools: false,
          forwardedRemoteToolDefinitions: [
            {
              name: "gmail__list_emails",
              description: "List emails",
              parameters: { type: "object", properties: {} },
            },
            {
              name: "gmail__delete_email",
              description: "Delete an email",
              parameters: { type: "object", properties: {} },
            },
            {
              name: "futureconnector__read",
              description: "Read from a future connector",
              parameters: { type: "object", properties: {} },
            },
          ],
          sourceIntegrationPolicy: {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: { gmail: { allowedToolIds: ["list_emails"] } },
          },
        });

        assertEquals(defs.map((definition) => definition.name).sort(), [
          "gmail__list_emails",
          "local_search",
        ]);
      } finally {
        toolRegistryInternal.clearAll();
      }
    });

    it("removes denied explicit integration selectors before resolution diagnostics", async () => {
      toolRegistryInternal.clearAll();
      try {
        const defs = await withMockRemoteIntegrationTools([], () =>
          getAvailableTools(
            { gmail__delete_email: true },
            {
              sourceIntegrationPolicy: {
                schemaVersion: 1,
                mode: "allowlist",
                integrations: { gmail: { allowedToolIds: ["list_emails"] } },
              },
            },
          ));

        assertEquals(defs, []);
      } finally {
        toolRegistryInternal.clearAll();
      }
    });

    it("fails loudly when an explicit remote tool is missing from the discovered allowlist", async () => {
      toolRegistryInternal.clearAll();

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
        toolRegistryInternal.clearAll();
      }
    });

    it("fails loudly when an explicit integration tool has no discovered tools", async () => {
      toolRegistryInternal.clearAll();

      try {
        await assertRejects(
          () =>
            withMockRemoteIntegrationTools([], () =>
              getAvailableTools({
                "github__get_pr_diff": true,
              })),
          Error,
          'Unknown tool reference: github__get_pr_diff. Tool names must exactly match tool({ id: "..." }). Available tools: (none)',
        );
      } finally {
        toolRegistryInternal.clearAll();
      }
    });

    it("strict replacement mode fails closed for integration-style registry references", async () => {
      await assertRejects(
        () =>
          getAvailableTools(
            { github__list_issues: true },
            {
              includeIntegrationTools: false,
              strictConfiguredToolsOnly: true,
            },
          ),
        Error,
        'Unknown tool reference: github__list_issues. Tool names must exactly match tool({ id: "..." }). Available tools: (none)',
      );
    });

    it("only appends explicitly requested remote definitions for explicit tool maps", async () => {
      toolRegistryInternal.clearAll();

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
        toolRegistryInternal.clearAll();
      }
    });

    it("resolves explicit integration tools from forwarded definitions when remote fetch is unavailable", async () => {
      toolRegistryInternal.clearAll();

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
        toolRegistryInternal.clearAll();
      }
    });

    it("exposes inline configured tools under the configured map key", async () => {
      const upstreamTool = tool({
        id: "upstream-bash",
        description: "Run bash",
        inputSchema: defineSchema((v) => v.object({ command: v.string() }))(),
        execute: async () => ({ ok: true }),
      });

      const defs = await getAvailableTools(
        {
          bash: upstreamTool,
        },
        { includeIntegrationTools: false },
      );

      assertEquals(defs.map((def) => def.name), ["bash"]);
    });

    it("never advertises an inline local tool through the reserved integration namespace", async () => {
      const localIntegrationShadow = tool({
        id: "gmail__list_emails",
        description: "Local integration shadow",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => [],
      });

      await assertRejects(
        () =>
          getAvailableTools(
            { gmail__list_emails: localIntegrationShadow },
            { includeIntegrationTools: false },
          ),
        Error,
        "reserved integration tool namespace",
      );
    });

    it("forwarded definitions are filtered by allowedRemoteToolNames", async () => {
      toolRegistryInternal.clearAll();

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
        toolRegistryInternal.clearAll();
      }
    });

    it("enforces remote tool allowlists through captured membership", async () => {
      toolRegistryInternal.clearAll();
      const calls: string[] = [];
      const remoteSource: RemoteToolSource = {
        id: "docs",
        listTools: () =>
          Promise.resolve([
            { name: "search_docs", description: "Search", parameters: {} },
            { name: "delete_docs", description: "Delete", parameters: {} },
          ]),
        executeTool: (name) => {
          calls.push(name);
          return Promise.resolve(name);
        },
      };
      const originalIncludes = Array.prototype.includes;
      let definitions: Awaited<ReturnType<typeof getAvailableTools>> = [];
      let executionError: unknown;
      try {
        Array.prototype.includes = () => true;
        definitions = await getAvailableTools(true, {
          includeIntegrationTools: false,
          allowedRemoteToolNames: ["search_docs"],
          remoteToolSources: [remoteSource],
        });
        try {
          await executeConfiguredTool(
            "delete_docs",
            {},
            undefined,
            undefined,
            ["search_docs"],
            [remoteSource],
          );
        } catch (error) {
          executionError = error;
        }
      } finally {
        Array.prototype.includes = originalIncludes;
        toolRegistryInternal.clearAll();
      }

      assertEquals(definitions.map((definition) => definition.name), ["search_docs"]);
      assertEquals((executionError as { slug?: string })?.slug, "permission-denied");
      assertEquals(calls, []);
    });

    it("merges generic remote MCP tool sources into available tools", async () => {
      toolRegistryInternal.clearAll();

      const remoteSource = createRemoteMCPToolSource({
        id: "docs",
        endpoint: (context) => `https://93.184.216.34/${context?.projectId ?? "default"}`,
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
        toolRegistryInternal.clearAll();
      }
    });

    it("drops a remote tool source whose listTools rejects instead of failing the load", async () => {
      toolRegistryInternal.clearAll();
      const warnings: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (
          entry.component === "agent" && entry.level === "warn" &&
          entry.message === "Failed to fetch remote tool definitions from source"
        ) {
          warnings.push(entry);
        }
      });

      const failing: RemoteToolSource = {
        id: "down",
        listTools: () => Promise.reject(new Error("remote MCP unreachable")),
        executeTool: () => Promise.resolve({}),
      };
      const healthy: RemoteToolSource = {
        id: "docs",
        listTools: () =>
          Promise.resolve([{
            name: "search_docs",
            description: "Search documentation",
            parameters: { type: "object", properties: {} },
          }]),
        executeTool: () => Promise.resolve({}),
      };

      try {
        const defs = await getAvailableTools(true, {
          includeIntegrationTools: false,
          remoteToolSources: [failing, healthy],
        });

        assertEquals(
          defs.map((def) => def.name),
          ["search_docs"],
          "a remote source whose listTools rejects must be dropped, not fail the whole tool load",
        );
        assertEquals(
          warnings.map((entry) => entry.context),
          [{ sourceId: "down", error: "remote MCP unreachable" }],
          "the fallback warning must identify the failed source and preserve its error",
        );
      } finally {
        unsubscribe();
        toolRegistryInternal.clearAll();
      }
    });
  });
});
