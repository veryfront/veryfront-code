import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createContext7ToolSource } from "./context7.ts";

describe("tool/context7", () => {
  it("creates a remote tool source with the correct id", () => {
    const source = createContext7ToolSource({ apiKey: "test-key" });
    assertEquals(source.id, "context7");
  });

  it("sends the API key header and lists tools via JSON-RPC", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    const source = createContext7ToolSource({
      apiKey: "c7-test-key",
      endpoint: "https://mcp.test/mcp",
    });

    const tools = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        capturedHeaders = request.headers;
        capturedBody = await request.json();
        return Response.json({
          jsonrpc: "2.0",
          id: "context7:tools:list",
          result: {
            tools: [
              {
                name: "resolve-library-id",
                description: "Resolve a library name to a Context7 library ID",
                inputSchema: {
                  type: "object",
                  properties: {
                    libraryName: { type: "string" },
                    query: { type: "string" },
                  },
                  required: ["query", "libraryName"],
                },
              },
              {
                name: "query-docs",
                description: "Query documentation for a library",
                inputSchema: {
                  type: "object",
                  properties: {
                    libraryId: { type: "string" },
                    query: { type: "string" },
                  },
                  required: ["libraryId", "query"],
                },
              },
            ],
          },
        });
      },
      async () => await source.listTools(),
    );

    assertEquals(capturedHeaders?.get("CONTEXT7_API_KEY"), "c7-test-key");
    assertEquals(capturedBody, {
      jsonrpc: "2.0",
      id: "context7:tools:list",
      method: "tools/list",
    });
    assertEquals(tools.length, 2);
    assertEquals(tools[0]?.name, "resolve-library-id");
    assertEquals(tools[1]?.name, "query-docs");
  });

  it("executes a tool call and returns the normalized result", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const source = createContext7ToolSource({
      apiKey: "c7-test-key",
      endpoint: "https://mcp.test/mcp",
    });

    const result = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        capturedBody = await request.json();
        return Response.json({
          jsonrpc: "2.0",
          id: "context7:tools:call:resolve-library-id",
          result: {
            content: [{ text: JSON.stringify({ libraryId: "/vercel/next.js" }) }],
          },
        });
      },
      async () =>
        await source.executeTool("resolve-library-id", {
          libraryName: "Next.js",
          query: "How to set up routing",
        }),
    );

    assertEquals(capturedBody, {
      jsonrpc: "2.0",
      id: "context7:tools:call:resolve-library-id",
      method: "tools/call",
      params: {
        name: "resolve-library-id",
        arguments: {
          libraryName: "Next.js",
          query: "How to set up routing",
        },
      },
    });
    assertEquals(result, { libraryId: "/vercel/next.js" });
  });

  it("throws when no API key is provided and CONTEXT7_API_KEY env is unset", async () => {
    const originalEnv = Deno.env.get("CONTEXT7_API_KEY");
    try {
      Deno.env.delete("CONTEXT7_API_KEY");
      const source = createContext7ToolSource();
      await assertRejects(
        () =>
          withMockFetch(
            async () => Response.json({}),
            async () => await source.listTools(),
          ),
        Error,
        "Context7 API key is required",
      );
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("CONTEXT7_API_KEY", originalEnv);
      }
    }
  });
});
