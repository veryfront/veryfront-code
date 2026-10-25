import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";

const ENDPOINT = "https://93.184.216.34/mcp";
function fixture(failNotification = false) {
  const live = new Map<string, string>();
  const deleted: string[] = [];
  let next = 0;
  const requestFetch: typeof fetch = (async (_input, init) => {
    const request = observeFetchRequestInit(init);
    const headers = new Headers(request.headers);
    const identity = headers.get("authorization") ?? "anonymous";
    const sessionId = headers.get("Mcp-Session-Id");
    if (request.method === "DELETE") {
      assertEquals(live.get(sessionId!), identity);
      deleted.push(sessionId!);
      live.delete(sessionId!);
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(request.body));
    if (body.method === "initialize") {
      const session = `test-session-${++next}`;
      live.set(session, identity);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          serverInfo: { name: "fixture", version: "1" },
        },
      }, { headers: { "Mcp-Session-Id": session } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: failNotification ? 503 : 202 });
    }
    if (!sessionId) return new Response("initialize first", { status: 400 });
    assertEquals(live.get(sessionId), identity);
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  }) as typeof fetch;
  return { requestFetch, live, deleted };
}

describe("remote MCP session security", () => {
  it("keeps credential keys distinct when project code patches Array.from", async () => {
    const server = fixture();
    await withMockFetch(server.requestFetch, async () => {
      let credential = "Bearer fixture-one";
      const source = createRemoteMCPToolSource({
        endpoint: ENDPOINT,
        headers: () => ({ Authorization: credential }),
      });
      const original = Array.from;
      Array.from = ((...args: unknown[]) => {
        if (args[0] instanceof Uint8Array && args[0].length === 32) return ["constant-key"];
        return Reflect.apply(original, Array, args);
      }) as typeof Array.from;
      try {
        await source.listTools();
        credential = "Bearer fixture-two";
        await source.listTools();
      } finally {
        Array.from = original;
      }
      assertEquals(server.live.size, 2);
      await source.dispose?.();
    });
  });

  it("keeps cleanup credentials away from a patched Array iterator", async () => {
    const server = fixture();
    await withMockFetch(server.requestFetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      const original = Array.prototype[Symbol.iterator];
      let leaked = false;
      Array.prototype[Symbol.iterator] = function () {
        if (this.length === 2 && typeof this[1] === "object" && this[1]?.sessionId) leaked = true;
        return Reflect.apply(original, this, []);
      };
      try {
        await source.dispose?.();
      } finally {
        Array.prototype[Symbol.iterator] = original;
      }
      assertEquals(leaked, false);
      assertEquals(server.live.size, 0);
    });
  });

  it("deletes a minted session when the initialized notification fails", async () => {
    const server = fixture(true);
    await withMockFetch(server.requestFetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await assertRejects(() => source.listTools());
      assertEquals(server.live.size, 1);
      await source.dispose?.();
      assertEquals(server.live.size, 0);
    });
  });

  it("retains every minted session across repeated failed initialization", async () => {
    const server = fixture(true);
    await withMockFetch(server.requestFetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await assertRejects(() => source.listTools());
      await assertRejects(() => source.listTools());
      assertEquals(server.live.size, 2);
      await source.dispose?.();
      assertEquals(server.live.size, 0);
      assertEquals(server.deleted.length, 2);
    });
  });

  it("cleans every retained credential for a run without resolving rotated credentials", async () => {
    const server = fixture();
    await withMockFetch(server.requestFetch, async () => {
      let credential = "Bearer fixture-one";
      let stopped = false;
      const source = createRemoteMCPToolSource({
        endpoint: ENDPOINT,
        headers: () => {
          if (stopped) throw new Error("resolver unavailable after abort");
          return { Authorization: credential };
        },
      });
      await source.listTools({ runId: "run-one" });
      credential = "Bearer fixture-two";
      await source.listTools({ runId: "run-one" });
      await source.listTools({ runId: "run-two" });
      stopped = true;
      await source.dispose?.({ runId: "run-one" });
      assertEquals(server.live.size, 1);
      assertEquals(server.deleted.length, 2);
      await source.dispose?.();
      assertEquals(server.live.size, 0);
    });
  });
});
