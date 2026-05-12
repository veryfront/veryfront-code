import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createToolsFromHostDefinitions, type HostToolSet } from "./host-tools.ts";
import type { ToolExecutionContext, ToolSet } from "./types.ts";

const emptyJsonSchema = { type: "object" as const, properties: {} };

describe("tool/host-tools", () => {
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
      },
    }, {
      generateToolCallId: (toolName) => `${toolName}-generated`,
    });

    assertEquals(Object.keys(tools), ["search"]);
    assertEquals(tools.search?.id, "search");
    assertEquals(tools.search?.type, "function");
    assertEquals(await tools.search?.execute({ query: "Veryfront" }), { query: "Veryfront" });
    assertEquals(receivedContextToolCallId, "search-generated");
  });

  it("preserves caller-provided execution context", async () => {
    let receivedProjectId = "";
    let receivedToolCallId = "";
    let receivedAbortSignal: AbortSignal | undefined;
    const abortController = new AbortController();

    const tools = createToolsFromHostDefinitions({
      read_file: {
        description: "Read a file",
        inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
        execute: (_input: unknown, context?: ToolExecutionContext) => {
          receivedProjectId = String(context?.projectId);
          receivedToolCallId = String(context?.toolCallId);
          receivedAbortSignal = context?.abortSignal;
          return { ok: true };
        },
      },
    });

    const result = await tools.read_file?.execute(
      { path: "README.md" },
      { projectId: "proj_123", toolCallId: "call_123", abortSignal: abortController.signal },
    );

    assertEquals(result, { ok: true });
    assertEquals(receivedProjectId, "proj_123");
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
