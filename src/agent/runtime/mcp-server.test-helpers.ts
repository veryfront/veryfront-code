/**
 * A local MCP server over HTTP for agent tool-exposure tests.
 *
 * Listens on 127.0.0.1 with an OS-assigned port, answers JSON-RPC `initialize`,
 * `tools/list` and `tools/call`, and records every method it receives.
 *
 * Agents address it by a public host name. `withMockFetch` moves the guarded
 * outbound transport and its host resolver for the duration of the callback, so
 * the egress guard runs without DNS, and the stub forwards each request to the
 * local server. The server is shut down afterwards and every global is restored.
 */
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";

/** The public URL agents use for the mock server; requests never leave the machine. */
export const MOCK_MCP_URL = "https://mcp.example.com/mcp";

export interface MockMcpTool {
  name: string;
  description: string;
}

export interface MockMcpServer {
  /** The server's MCP endpoint. */
  url: string;
  /** Every JSON-RPC method received, with the tool name for `tools/call`. */
  requests: string[];
}

export async function withMockMcpServer<T>(
  tools: readonly MockMcpTool[],
  fn: (server: MockMcpServer) => Promise<T>,
): Promise<T> {
  const requests: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const body = await request.json() as {
        id?: string | number;
        method?: string;
        params?: { name?: string };
      };
      const method = body.method ?? "";
      requests.push(method === "tools/call" ? `${method} ${body.params?.name ?? ""}` : method);
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result = method === "initialize"
        ? {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp", version: "1.0.0" },
        }
        : method === "tools/list"
        ? {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: { type: "object", properties: {} },
          })),
        }
        : method === "tools/call"
        ? { content: [{ type: "text", text: `called ${body.params?.name ?? ""}` }] }
        : {};
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  );
  const localUrl = `http://127.0.0.1:${server.addr.port}/mcp`;
  const realFetch = globalThis.fetch;
  const forwardToLocalServer = ((input: string | URL | Request, init?: RequestInit) => {
    const requested = new URL(input instanceof Request ? input.url : String(input));
    if (requested.href !== MOCK_MCP_URL) {
      return Promise.reject(new Error(`Unexpected outbound request to ${requested.origin}`));
    }
    return realFetch(localUrl, {
      method: init?.method ?? "POST",
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
  }) as typeof fetch;
  try {
    return await withMockFetch(forwardToLocalServer, () => fn({ url: MOCK_MCP_URL, requests }));
  } finally {
    await server.shutdown();
  }
}

/** The tools the mock MCP server publishes in these tests. */
export const WIKI_MCP_TOOLS: readonly MockMcpTool[] = [
  { name: "read_wiki_structure", description: "List the wiki sections of a repository" },
  { name: "read_wiki_contents", description: "Read the wiki of a repository" },
  { name: "ask_wiki_question", description: "Ask a question about a repository" },
];
