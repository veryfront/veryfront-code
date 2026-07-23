import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("stops waiting for remote listings after caller cancellation", async () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return await new Promise(() => {});
      },
      async executeTool() {
        return null;
      },
    };
    const controller = new AbortController();
    const abortTimer = setTimeout(
      () => controller.abort(new Error("listing canceled")),
      20,
    );
    const startedAt = Date.now();

    try {
      await assertRejects(
        () => loadRemoteToolsFromSource(source, { context: { abortSignal: controller.signal } }),
        Error,
        "listing canceled",
      );
    } finally {
      clearTimeout(abortTimer);
    }
    assertEquals(Date.now() - startedAt < 150, true);
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

  it("snapshots the remote executor during materialization", async () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        return "original";
      },
    };
    const tools = createToolsFromRemoteDefinitions(source, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object", properties: {} },
    }]);

    source.executeTool = async () => "mutated";

    assertEquals(await tools.search_docs?.execute({}), "original");
  });

  it("rejects accessor-backed remote arguments without invoking getters", async () => {
    let getterCalled = false;
    let executeCalls = 0;
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        executeCalls += 1;
        return null;
      },
    };
    const tools = createToolsFromRemoteDefinitions(source, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object", properties: {} },
    }]);
    const args = Object.defineProperty({}, "query", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "secret";
      },
    });

    await assertRejects(
      () => tools.search_docs!.execute(args),
      Error,
      "data properties",
    );
    assertEquals(getterCalled, false);
    assertEquals(executeCalls, 0);
  });

  it("rejects array arguments instead of executing with an empty object", async () => {
    let executeCalls = 0;
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        executeCalls += 1;
        return null;
      },
    };
    const tools = createToolsFromRemoteDefinitions(source, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object", properties: {} },
    }]);

    await assertRejects(
      () => tools.search_docs!.execute([]),
      Error,
      "Remote tool arguments must be an object",
    );
    assertEquals(executeCalls, 0);
  });

  it("ignores inherited aliases", () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        return null;
      },
    };
    const aliases = Object.create({ search_docs: "inherited_alias" }) as Record<string, string>;

    const tools = createToolsFromRemoteDefinitions(source, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object", properties: {} },
    }], { toolNameAliases: aliases });

    assertEquals(Object.keys(tools), ["search_docs"]);
  });

  it("rejects aliases that collapse multiple remote tools onto one name", () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        return null;
      },
    };

    assertThrows(
      () =>
        createToolsFromRemoteDefinitions(source, [
          {
            name: "search_docs",
            description: "Search docs",
            parameters: { type: "object", properties: {} },
          },
          {
            name: "query_docs",
            description: "Query docs",
            parameters: { type: "object", properties: {} },
          },
        ], {
          toolNameAliases: {
            search_docs: "docs",
            query_docs: "docs",
          },
        }),
      Error,
      'Remote tools "search_docs" and "query_docs" both map to "docs"',
    );
  });

  it("rejects remote definitions without an input schema", () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        return null;
      },
    };

    assertThrows(
      () =>
        createToolsFromRemoteDefinitions(source, [{
          name: "search_docs",
          description: "Search docs",
        } as never]),
      Error,
      'Remote tool "search_docs" has an invalid input schema',
    );
  });

  it("rejects unbounded remote definition collections before materialization", () => {
    const source: RemoteToolSource = {
      id: "docs-source",
      async listTools() {
        return [];
      },
      async executeTool() {
        return null;
      },
    };
    const definitions = [] as never[];
    definitions.length = 10_001;

    assertThrows(
      () => createToolsFromRemoteDefinitions(source, definitions),
      Error,
      "cannot exceed 10000 entries",
    );
  });
});
