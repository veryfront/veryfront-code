import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  RuntimeToolCatalogEntry,
  RuntimeToolDiscoveryContext,
} from "./tool-discovery-context.ts";
import { createSearchToolsTool, type SearchToolsToolOptions } from "./search-tools-tool.ts";

const CATALOG: RuntimeToolCatalogEntry[] = [
  { name: "read_file", description: "Read a file from the project", source: "veryfront-api" },
  { name: "write_file", description: "Write content to a file", source: "veryfront-api" },
  {
    name: "search_code",
    description: "Search for patterns in source code",
    source: "veryfront-api",
  },
  { name: "update_agent", description: "Update agent configuration", source: "veryfront-api" },
  {
    name: "premium_tool",
    description: "A grant-required premium capability",
    source: "premium-integration",
    requiresGrant: true,
  },
];

function makeContext(activated: string[] = []): RuntimeToolDiscoveryContext {
  return {
    activatedRemoteToolNames: new Set(activated),
  };
}

function makeOptions(
  context: RuntimeToolDiscoveryContext,
  overrides: Partial<Omit<SearchToolsToolOptions, "context">> = {},
): SearchToolsToolOptions {
  return {
    context,
    getAuthorizedCatalog: () => [...CATALOG],
    ...overrides,
  };
}

describe("search_tools tool", () => {
  describe("state mapping", () => {
    it("returns available for tools not yet activated", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file"] });

      assertEquals(result.results.length, 1);
      assertEquals(result.results[0].name, "read_file");
      assertEquals(result.results[0].state, "available");
    });

    it("returns active for tools that are in the activated set", async () => {
      const context = makeContext(["read_file"]);
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file"] });

      assertEquals(result.results[0].state, "active");
    });

    it("returns requires_grant for tools marked requiresGrant", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["premium_tool"] });

      assertEquals(result.results[0].state, "requires_grant");
    });

    it("does not return input schemas in results", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file"] });

      assertEquals("inputSchema" in result.results[0], false);
      assertEquals("parameters" in result.results[0], false);
    });
  });

  describe("lookup by names", () => {
    it("returns only the named tools when names is provided", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file", "write_file"] });

      assertEquals(result.results.length, 2);
      assertEquals(
        result.results.map((r) => r.name).sort(),
        ["read_file", "write_file"],
      );
    });

    it("omits names that are not in the authorized catalog (invisible)", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      // "mystery_tool" is not in catalog and not unauthorized-but-visible
      const result = await tool.execute({ names: ["read_file", "mystery_tool"] });

      assertEquals(result.results.length, 1);
      assertEquals(result.results[0].name, "read_file");
    });
  });

  describe("keyword query", () => {
    it("matches query against tool name", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ query: "file" });

      const names = result.results.map((r) => r.name);
      assertEquals(names.includes("read_file"), true);
      assertEquals(names.includes("write_file"), true);
      assertEquals(names.includes("search_code"), false);
    });

    it("matches query against tool description", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ query: "source code" });

      const names = result.results.map((r) => r.name);
      assertEquals(names.includes("search_code"), true);
    });

    it("is case-insensitive", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ query: "FILE" });

      const names = result.results.map((r) => r.name);
      assertEquals(names.includes("read_file"), true);
    });

    it("returns all catalog tools when no query or names provided", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({});

      assertEquals(result.results.length, CATALOG.length);
    });
  });

  describe("limit", () => {
    it("respects the limit parameter", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ limit: 2 });

      assertEquals(result.results.length, 2);
    });

    it("does not exceed limit even if more results match", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ query: "file", limit: 1 });

      assertEquals(result.results.length, 1);
    });
  });

  describe("result shape", () => {
    it("includes name, description, source, and state in each result", async () => {
      const context = makeContext();
      const tool = createSearchToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file"] });

      const r = result.results[0];
      assertEquals(typeof r.name, "string");
      assertEquals(typeof r.description, "string");
      assertEquals(typeof r.source, "string");
      assertEquals(typeof r.state, "string");
    });
  });

  describe("tool metadata", () => {
    it("has the correct tool id", () => {
      const tool = createSearchToolsTool(makeOptions(makeContext()));
      assertEquals(tool.id, "search_tools");
    });
  });

  describe("no cross-run leakage", () => {
    it("shows activated state only from the current context", async () => {
      const contextA = makeContext(["read_file"]);
      const contextB = makeContext();

      const toolA = createSearchToolsTool(makeOptions(contextA));
      const toolB = createSearchToolsTool(makeOptions(contextB));

      const resultA = await toolA.execute({ names: ["read_file"] });
      const resultB = await toolB.execute({ names: ["read_file"] });

      assertEquals(resultA.results[0].state, "active");
      assertEquals(resultB.results[0].state, "available");
    });
  });
});
