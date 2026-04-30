import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { createToolsFromHostDefinitions } from "./host-tools.ts";

const emptyJsonSchema = { type: "object" as const, properties: {} };

describe("tool/host-tools", () => {
  it("materializes host tool definitions into framework tools", async () => {
    let receivedContextToolCallId = "";

    const tools = createToolsFromHostDefinitions({
      search: {
        description: "Search docs",
        inputSchema: z.object({ query: z.string() }),
        execute: (input, context) => {
          receivedContextToolCallId = String(context.toolCallId);
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
        inputSchema: z.object({ path: z.string() }),
        execute: (_input, context) => {
          receivedProjectId = String(context.projectId);
          receivedToolCallId = String(context.toolCallId);
          receivedAbortSignal = context.abortSignal;
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
        inputSchema: z.object({}).passthrough(),
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
        inputSchema: z.object({}),
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
        inputSchema: z.object({}),
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(Object.keys(tools), ["valid"]);
  });
});
