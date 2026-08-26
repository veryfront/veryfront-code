import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createToolsFromHostDefinitions, type HostToolSet } from "./host-tools.ts";
import { createToolsFromRemoteDefinitions } from "./remote-source-tools.ts";
import { getRemoteToolProvenance } from "./remote-tool-provenance.ts";
import {
  hasTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
} from "./host-tool-provenance.ts";
import type { RemoteToolSource, ToolExecutionContext, ToolSet } from "./types.ts";

const emptyJsonSchema = { type: "object" as const, properties: {} };

describe("tool/host-tools", () => {
  it("preserves trusted host provenance through materialization", () => {
    const trustedDefinition = markTrustedHostToolProvenance({
      description: "Trusted framework tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    });
    const tools = createToolsFromHostDefinitions({
      trusted: trustedDefinition,
      project: {
        description: "Project tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(hasTrustedHostToolProvenance(tools.trusted), true);
    assertEquals(hasTrustedHostToolProvenance(tools.project), false);
  });

  it("materializes host tool definitions into framework tools", async () => {
    let receivedContextToolCallId = "";

    const tools = createToolsFromHostDefinitions({
      search: {
        description: "Search docs",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: (input: unknown, context?: ToolExecutionContext) => {
          receivedContextToolCallId = String(context?.toolCallId);
          return input;
        },
        mcp: { title: "Search documentation", annotations: { readOnlyHint: true } },
      },
    }, {
      generateToolCallId: (toolName) => `${toolName}-generated`,
    });

    assertEquals(Object.keys(tools), ["search"]);
    assertEquals(tools.search?.id, "search");
    assertEquals(tools.search?.type, "function");
    assertEquals(
      tools.search?.mcp,
      { title: "Search documentation", annotations: { readOnlyHint: true } },
      "contract-schema host tools must forward MCP metadata",
    );
    assertEquals(await tools.search?.execute({ query: "Veryfront" }), { query: "Veryfront" });
    assertEquals(receivedContextToolCallId, "search-generated");
  });

  it("preserves caller-provided execution context", async () => {
    let receivedProjectId = "";
    let receivedUserId = "";
    let receivedToolCallId = "";
    let receivedAbortSignal: AbortSignal | undefined;
    const abortController = new AbortController();

    const tools = createToolsFromHostDefinitions({
      read_file: {
        description: "Read a file",
        inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
        execute: (_input: unknown, context?: ToolExecutionContext) => {
          receivedProjectId = String(context?.projectId);
          receivedUserId = String(context?.userId);
          receivedToolCallId = String(context?.toolCallId);
          receivedAbortSignal = context?.abortSignal;
          return { ok: true };
        },
      },
    });

    const result = await tools.read_file?.execute(
      { path: "README.md" },
      {
        projectId: "proj_123",
        userId: "user_123",
        toolCallId: "call_123",
        abortSignal: abortController.signal,
      },
    );

    assertEquals(result, { ok: true });
    assertEquals(receivedProjectId, "proj_123");
    assertEquals(receivedUserId, "user_123");
    assertEquals(receivedToolCallId, "call_123");
    assertEquals(receivedAbortSignal, abortController.signal);
  });

  it("uses dynamic tools when host definitions include precomputed JSON schema", () => {
    const tools = createToolsFromHostDefinitions({
      dynamic_search: {
        description: "Search docs",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        inputSchemaJson: emptyJsonSchema,
        execute: () => ({ ok: true }),
        mcp: { title: "Search documentation", annotations: { readOnlyHint: true } },
      },
    });

    assertEquals(tools.dynamic_search?.type, "dynamic");
    assertEquals(tools.dynamic_search?.inputSchemaJson, emptyJsonSchema);
    assertEquals(tools.dynamic_search?.mcp, {
      title: "Search documentation",
      annotations: { readOnlyHint: true },
    });
  });

  it("preserves canonical remote provenance through host materialization", async () => {
    let executedToolName = "";
    const source: RemoteToolSource = {
      id: "veryfront-api",
      listTools: async () => [],
      executeTool: async (toolName) => {
        executedToolName = toolName;
        return { ok: true };
      },
    };
    const remoteTools = createToolsFromRemoteDefinitions(
      source,
      [{
        name: "gmail__delete_email",
        description: "Delete an email",
        parameters: emptyJsonSchema,
      }],
      {
        toolNameAliases: {
          gmail__delete_email: "delete_email",
        },
      },
    );

    const tools = createToolsFromHostDefinitions(remoteTools);

    assertEquals(getRemoteToolProvenance(tools.delete_email), "gmail__delete_email");
    assertEquals(await tools.delete_email?.execute({}), { ok: true });
    assertEquals(executedToolName, "gmail__delete_email");
  });

  it("materializes precomputed schemas from external host tool providers", async () => {
    let executeCalls = 0;
    const externalSchema = {
      parse: (input: unknown) => {
        if (
          typeof input !== "object" || input === null ||
          typeof (input as Record<string, unknown>).command !== "string"
        ) {
          throw new Error("command is required");
        }
        return input;
      },
      safeParse: (input: unknown) => ({ success: true, data: input }),
    };
    const inputSchemaJson: JsonSchema = {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    };

    const tools = createToolsFromHostDefinitions({
      bash: {
        id: "provider-generated-id",
        description: "Run a sandbox command",
        inputSchema: externalSchema,
        inputSchemaJson,
        execute: (input: unknown) => {
          executeCalls += 1;
          return input;
        },
      },
    });

    const bash = tools.bash;
    if (!bash) throw new Error("bash tool was not materialized");
    assertEquals(Object.keys(tools), ["bash"]);
    assertEquals(bash.id, "bash");
    assertEquals(bash.inputSchemaJson, inputSchemaJson);
    assertEquals(await bash.execute({ command: "true" }), { command: "true" });
    await assertRejects(() => bash.execute({}), Error, "command is required");
    assertEquals(executeCalls, 1);
  });

  it("materializes JSON-schema-only host tool definitions", async () => {
    const inputSchemaJson: JsonSchema = {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    };

    const tools = createToolsFromHostDefinitions({
      bash: {
        description: "Run a sandbox command",
        inputSchemaJson,
        execute: (input: unknown) => input,
      },
    });

    const bash = tools.bash;
    if (!bash) throw new Error("bash tool was not materialized");
    assertEquals(bash.type, "dynamic");
    assertEquals(bash.inputSchemaJson, inputSchemaJson);
    assertEquals(await bash.execute({ command: "true" }), { command: "true" });
    await assertRejects(() => bash.execute("true"), Error, "input must be a non-null object");
  });

  it("skips non-runnable host definitions", () => {
    const tools = createToolsFromHostDefinitions({
      missingExecute: {
        description: "No execute",
        inputSchema: defineSchema((v) => v.object({}))(),
      },
      missingSchema: {
        description: "No schema",
        execute: () => null,
      },
    });

    assertEquals(tools, {});
  });

  it("skips parser-like schemas without dropping valid host tools", () => {
    const parserLikeSchema = {
      parse: (input: unknown) => input,
    };

    const tools = createToolsFromHostDefinitions({
      parserLike: {
        description: "Not Zod",
        inputSchema: parserLikeSchema,
        execute: () => ({ ok: false }),
      },
      valid: {
        description: "Valid tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(Object.keys(tools), ["valid"]);
  });

  it("exposes host tool set and materialized tool set types for runtime hosts", () => {
    const hostTools: HostToolSet = {
      search: {
        description: "Search docs",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: (input: unknown) => input,
      },
    };

    const tools: ToolSet = createToolsFromHostDefinitions(hostTools);

    assertEquals(Object.keys(tools), ["search"]);
  });
});
