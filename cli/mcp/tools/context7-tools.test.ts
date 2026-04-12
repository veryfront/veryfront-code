import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
        message: "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
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
        message: "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
      }
    }
  });

  it("c7_resolve_library forwards call to Context7 and returns result", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.set("CONTEXT7_API_KEY", "test-key");
      let capturedBody: Record<string, unknown> | undefined;

      const resolveTool = context7Tools.find(
        (t) => t.name === "c7_resolve_library",
      )!;

      const result = await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          capturedBody = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id: "context7:tools:call:resolve-library-id",
            result: {
              content: [
                {
                  text: JSON.stringify({
                    libraryId: "/vercel/next.js",
                    name: "Next.js",
                  }),
                },
              ],
            },
          });
        },
        async () =>
          await resolveTool.execute({
            libraryName: "Next.js",
            query: "app router",
          }),
      );

      assertEquals(capturedBody?.method, "tools/call");
      assertEquals(
        (capturedBody?.params as Record<string, unknown>)?.name,
        "resolve-library-id",
      );
      assertEquals(result, { libraryId: "/vercel/next.js", name: "Next.js" });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
      }
    }
  });

  it("c7_query_docs forwards call to Context7 and returns result", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.set("CONTEXT7_API_KEY", "test-key");
      let capturedBody: Record<string, unknown> | undefined;

      const queryTool = context7Tools.find(
        (t) => t.name === "c7_query_docs",
      )!;

      const result = await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          capturedBody = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id: "context7:tools:call:query-docs",
            result: {
              content: [
                {
                  text: JSON.stringify({
                    docs: "## App Router\nNext.js uses file-based routing...",
                  }),
                },
              ],
            },
          });
        },
        async () =>
          await queryTool.execute({
            libraryId: "/vercel/next.js",
            query: "app router setup",
          }),
      );

      assertEquals(capturedBody?.method, "tools/call");
      assertEquals(
        (capturedBody?.params as Record<string, unknown>)?.name,
        "query-docs",
      );
      assertEquals(result, {
        docs: "## App Router\nNext.js uses file-based routing...",
      });
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
      }
    }
  });

  it("c7_resolve_library returns structured error on network failure", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.set("CONTEXT7_API_KEY", "test-key");

      const resolveTool = context7Tools.find(
        (t) => t.name === "c7_resolve_library",
      )!;

      const result = await withMockFetch(
        async () => new Response("Service Unavailable", { status: 503 }),
        async () =>
          await resolveTool.execute({
            libraryName: "React",
            query: "hooks",
          }),
      );

      assertEquals(
        (result as Record<string, unknown>).error,
        "context7_request_failed",
      );
      assertEquals(
        typeof (result as Record<string, unknown>).message,
        "string",
      );
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
      }
    }
  });

  it("c7_query_docs returns structured error on network failure", async () => {
    const originalKey = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.set("CONTEXT7_API_KEY", "test-key");

      const queryTool = context7Tools.find(
        (t) => t.name === "c7_query_docs",
      )!;

      const result = await withMockFetch(
        async () => new Response("Service Unavailable", { status: 503 }),
        async () =>
          await queryTool.execute({
            libraryId: "/vercel/next.js",
            query: "routing",
          }),
      );

      assertEquals(
        (result as Record<string, unknown>).error,
        "context7_request_failed",
      );
      assertEquals(
        typeof (result as Record<string, unknown>).message,
        "string",
      );
    } finally {
      if (originalKey !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalKey);
      } else {
        Deno.env.delete("CONTEXT7_API_KEY");
      }
    }
  });
});
