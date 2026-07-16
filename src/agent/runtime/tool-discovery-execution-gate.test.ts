import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createProjectScopedRemoteToolCatalog } from "../../tool/project-scoped-remote-tools.ts";
import type { RemoteToolSource, ToolDefinition } from "../../tool/types.ts";
import type { RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";

function makeSource(tools: ToolDefinition[]): RemoteToolSource {
  return {
    id: "test-source",
    listTools: () => Promise.resolve(tools),
    executeTool: () => Promise.resolve({ ok: true }),
  };
}

function makeToolDef(name: string): ToolDefinition {
  return {
    name,
    description: `The ${name} tool`,
    parameters: { type: "object", properties: {} },
  };
}

describe("execution gate: activated set feeds isRemoteToolNameAllowed", () => {
  it("allows execution of an activated tool", async () => {
    const context: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set(["read_file"]),
    };

    const catalog = createProjectScopedRemoteToolCatalog({
      source: makeSource([makeToolDef("read_file"), makeToolDef("write_file")]),
      // Pass the activated set as the allowedToolNames reference.
      // The same Set object is mutated by load_tools, so the gate stays live.
      allowedToolNames: context.activatedRemoteToolNames,
    });

    // Should succeed: read_file is in the activated set
    const result = await catalog.prepareExecution({
      toolName: "read_file",
      toolInput: {},
    });
    assertEquals(result.toolDefinition?.name, "read_file");
  });

  it("blocks execution of a non-activated tool", async () => {
    const context: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set(["read_file"]),
    };

    const catalog = createProjectScopedRemoteToolCatalog({
      source: makeSource([makeToolDef("read_file"), makeToolDef("write_file")]),
      allowedToolNames: context.activatedRemoteToolNames,
    });

    let threw = false;
    try {
      await catalog.prepareExecution({ toolName: "write_file", toolInput: {} });
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });

  it("allows execution after load_tools adds a tool to the activated set", async () => {
    const context: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set<string>(),
    };

    const catalog = createProjectScopedRemoteToolCatalog({
      source: makeSource([makeToolDef("write_file")]),
      // Same Set reference — mutations are visible to the catalog.
      allowedToolNames: context.activatedRemoteToolNames,
    });

    // Before activation: blocked
    let threw = false;
    try {
      await catalog.prepareExecution({ toolName: "write_file", toolInput: {} });
    } catch {
      threw = true;
    }
    assertEquals(threw, true);

    // Simulate load_tools activation (mutates the same Set)
    context.activatedRemoteToolNames!.add("write_file");

    // After activation: allowed
    const result = await catalog.prepareExecution({
      toolName: "write_file",
      toolInput: {},
    });
    assertEquals(result.toolDefinition?.name, "write_file");
  });

  it("listTools returns only activated tools when allowedToolNames is the activated set", async () => {
    const context: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set(["read_file"]),
    };

    const catalog = createProjectScopedRemoteToolCatalog({
      source: makeSource([
        makeToolDef("read_file"),
        makeToolDef("write_file"),
        makeToolDef("search_code"),
      ]),
      allowedToolNames: context.activatedRemoteToolNames,
    });

    const tools = await catalog.listTools();
    const names = tools.map((t) => t.name);
    assertEquals(names, ["read_file"]);
  });

  it("no cross-run leakage: separate contexts have independent activated sets", async () => {
    const contextA: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set(["read_file"]),
    };
    const contextB: RuntimeToolDiscoveryContext = {
      activatedRemoteToolNames: new Set(),
    };

    const catalogA = createProjectScopedRemoteToolCatalog({
      source: makeSource([makeToolDef("read_file")]),
      allowedToolNames: contextA.activatedRemoteToolNames,
    });
    const catalogB = createProjectScopedRemoteToolCatalog({
      source: makeSource([makeToolDef("read_file")]),
      allowedToolNames: contextB.activatedRemoteToolNames,
    });

    // A can execute, B cannot
    const resultA = await catalogA.prepareExecution({ toolName: "read_file", toolInput: {} });
    assertEquals(resultA.toolDefinition?.name, "read_file");

    let threw = false;
    try {
      await catalogB.prepareExecution({ toolName: "read_file", toolInput: {} });
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
