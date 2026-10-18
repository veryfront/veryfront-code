import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import { createRunPlatformToolSource } from "#veryfront/server/handlers/request/run-terminal-tool-source.ts";

function recorder() {
  const calls: Array<{ headers: Headers; name: string }> = [];
  const create = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "platform",
    listTools: async () => [],
    executeTool: async (name, _args, context) => {
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      calls.push({ headers: new Headers(headers), name });
      return { accepted: true };
    },
  });
  return { calls, create };
}

describe("host-configured platform MCP transport", () => {
  it("accepts only the host-configured HTTP API for mutation authority", async () => {
    const key = "VERYFRONT_API_URL";
    const previous = getEnv(key);
    setEnv(key, "http://localhost:4000");
    try {
      const { calls, create } = recorder();
      const source = createRunPlatformToolSource(
        { endpoint: "http://localhost:4000/mcp", headers: {} },
        null,
        create,
        { apiBaseUrl: "http://localhost:4000", token: "local-writer" },
      );
      await source.executeTool("veryfront__update_file", {}, {});
      assertEquals(calls.at(-1)!.headers.get("X-Veryfront-Run-Event-Token"), "local-writer");
      for (const apiBaseUrl of ["http://foreign.example", "http://localhost:4001"]) {
        assertThrows(() =>
          createRunPlatformToolSource(
            { endpoint: `${apiBaseUrl}/mcp`, headers: {} },
            null,
            create,
            { apiBaseUrl, token: "local-writer" },
          )
        );
      }
      assertEquals(calls.length, 1);
      await withMockFetch(async (_url, init) => {
        const body = JSON.parse(String(observeFetchRequestInit(init).body));
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      }, async () => {
        const remote = createRunPlatformToolSource(
          { endpoint: "http://localhost:4000/mcp", headers: {} },
          null,
          undefined,
          { apiBaseUrl: "http://localhost:4000", token: "local-writer" },
        );
        assertEquals(await remote.listTools({}), []);
      });
    } finally {
      if (previous === undefined) deleteEnv(key);
      else setEnv(key, previous);
    }
  });
});
