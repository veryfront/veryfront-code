import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { context7Tools } from "./context7-tools.ts";

describe("cli/mcp/tools/context7-tools", () => {
  it("exports two tools with correct names", () => {
    const names = context7Tools.map((t) => t.name);
    assertEquals(names, ["c7_resolve_library", "c7_query_docs"]);
  });

  it("all tools have required fields", () => {
    for (const tool of context7Tools) {
      assertExists(tool.name);
      assertExists(tool.description);
      assertExists(tool.inputSchema);
      assertExists(tool.execute);
      assertExists(tool.title);
      assertExists(tool.annotations);
    }
  });

  it("all tools are marked as read-only and open-world", () => {
    for (const tool of context7Tools) {
      assertEquals(tool.annotations?.readOnlyHint, true);
      assertEquals(tool.annotations?.destructiveHint, false);
      assertEquals(tool.annotations?.openWorldHint, true);
    }
  });

  it("c7_resolve_library returns graceful error when CONTEXT7_API_KEY is unset", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.delete("CONTEXT7_API_KEY");

      const resolveTool = context7Tools.find(
        (t) => t.name === "c7_resolve_library",
      )!;

      const result = await resolveTool.execute({
        libraryName: "React",
        query: "hooks",
      });

      assertEquals(result, {
        error: "context7_not_configured",
        message:
          "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      }
    }
  });

  it("c7_query_docs returns graceful error when CONTEXT7_API_KEY is unset", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.delete("CONTEXT7_API_KEY");

      const queryTool = context7Tools.find(
        (t) => t.name === "c7_query_docs",
      )!;

      const result = await queryTool.execute({
        libraryId: "/vercel/next.js",
        query: "routing",
      });

      assertEquals(result, {
        error: "context7_not_configured",
        message:
          "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      }
    }
  });
});
