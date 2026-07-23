import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { getRuntimeRemoteToolSources } from "./mcp-server-tool-sources.ts";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function createMcpFetch(calls: FetchCall[]): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: unknown; method?: string };
    const result = body.method === "tools/list"
      ? {
        tools: [
          {
            name: "search_docs",
            description: "Search docs",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "delete_docs",
            description: "Delete docs",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }
      : {
        content: [{ text: JSON.stringify({ ok: true }) }],
      };

    return Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

Deno.test("getRuntimeRemoteToolSources builds MCP sources with bearer auth and allow policy", async () => {
  const calls: FetchCall[] = [];
  const sources = getRuntimeRemoteToolSources({
    system: "Use docs.",
    tools: { search_docs: true },
    mcpServers: [{
      id: "docs",
      transport: { type: "http", url: "https://docs.example.com/mcp" },
      auth: { type: "bearer", token: () => "docs-token" },
      toolPolicy: { allow: ["search_docs"] },
      fetch: createMcpFetch(calls),
    }],
  });

  assertEquals(sources?.length, 1);
  assertEquals(await sources?.[0]?.listTools(), [{
    name: "search_docs",
    description: "Search docs",
    parameters: { type: "object", properties: {} },
  }]);
  assertEquals(new Headers(calls[0]?.init.headers).get("Authorization"), "Bearer docs-token");
});

Deno.test("getRuntimeRemoteToolSources blocks denied MCP tool execution", async () => {
  const calls: FetchCall[] = [];
  const sources = getRuntimeRemoteToolSources({
    system: "Use docs.",
    tools: { delete_docs: true },
    mcpServers: [{
      id: "docs",
      transport: { type: "http", url: "https://docs.example.com/mcp" },
      toolPolicy: { deny: ["delete_docs"] },
      fetch: createMcpFetch(calls),
    }],
  });

  assertThrows(
    () => sources![0]!.executeTool("delete_docs", {}),
    Error,
    'Tool "delete_docs" is not allowed for MCP server "docs"',
  );
  assertEquals(calls.length, 0);
});
