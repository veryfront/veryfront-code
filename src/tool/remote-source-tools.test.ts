import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource } from "./types.ts";
import {
  createToolsFromRemoteDefinitions,
  loadRemoteToolsFromSource,
} from "./remote-source-tools.ts";

describe("tool/remote-source-tools", () => {
  it("materializes runtime tools from remote definitions while preserving remote schemas", async () => {
    let executedToolName = "";
    let executedArgs: Record<string, unknown> | undefined;
    let executedContextProjectId = "";
    let executedContextToolCallId = "";

    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool(toolName, args, context) {
        executedToolName = toolName;
        executedArgs = args;
        executedContextProjectId = String(context?.projectId ?? "");
        executedContextToolCallId = String(context?.toolCallId ?? "");
        return { ok: true };
      },
    };

    const tools = createToolsFromRemoteDefinitions(
      source,
      [{
        name: "search_docs",
        description: "Search docs",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        title: "Search documentation",
        annotations: { readOnlyHint: true },
      }],
      {
        toolNameAliases: {
          search_docs: "docs_search",
        },
      },
    );

    assertEquals(Object.keys(tools), ["docs_search"]);
    assertEquals(tools.docs_search?.id, "docs_search");
    assertEquals(tools.docs_search?.inputSchemaJson, {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    });
    assertEquals(tools.docs_search?.mcp, {
      title: "Search documentation",
      annotations: { readOnlyHint: true },
    });

    const result = await tools.docs_search?.execute(
      { query: "Veryfront" },
      { projectId: "proj_123", toolCallId: "tool-call-1" },
    );

    assertEquals(result, { ok: true });
    assertEquals(executedToolName, "search_docs");
    assertEquals(executedArgs, { query: "Veryfront" });
    assertEquals(executedContextProjectId, "proj_123");
    assertEquals(executedContextToolCallId, "tool-call-1");
  });

  it("loads remote tools from a source with request context", async () => {
    let listedProjectId = "";

    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools(context) {
        listedProjectId = String(context?.projectId ?? "");
        return [{
          name: "search_docs",
          description: "Search docs",
          parameters: { type: "object", properties: {} },
        }];
      },
      async executeTool() {
        return null;
      },
    };

    const tools = await loadRemoteToolsFromSource(source, {
      context: { projectId: "proj_456" },
    });

    assertEquals(listedProjectId, "proj_456");
    assertEquals(Object.keys(tools), ["search_docs"]);
  });

  it("preserves generic runtime execution context fields for remote tools", async () => {
    let executedAbortSignal: AbortSignal | undefined;
    let executedEvents: unknown[] = [];

    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool(_toolName, _args, context) {
        executedAbortSignal = context?.abortSignal;
        await context?.publishDataEvent?.({
          type: "tool-lifecycle",
          data: { phase: "started" },
        });
        return { ok: true };
      },
    };

    const tools = createToolsFromRemoteDefinitions(source, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object", properties: {} },
    }]);

    const abortController = new AbortController();
    const publishDataEvent = (event: unknown) => {
      executedEvents = [...executedEvents, event];
    };

    const result = await tools.search_docs?.execute(
      {},
      {
        abortSignal: abortController.signal,
        publishDataEvent,
      },
    );

    assertEquals(result, { ok: true });
    assertEquals(executedAbortSignal, abortController.signal);
    assertEquals(executedEvents, [{
      type: "tool-lifecycle",
      data: { phase: "started" },
    }]);
  });
});
