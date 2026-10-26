import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { createNodeServer } from "#veryfront/platform/adapters/runtime/node/http-server.ts";
import { NodeServerAdapter } from "#veryfront/platform/adapters/runtime/node/websocket-adapter.ts";
import { WsNodeWebSocketServerProvider } from "../../../extensions/ext-node-websocket-ws/src/index.ts";

// Exercise node:http under Deno as well: the Node-only lifecycle suite deliberately
// skips these real socket cases outside Node.
describe("Deno Node HTTP upgrade transport", () => {
  it("preserves a rejected handshake status, repeated cookies and body", async () => {
    let calls = 0;
    const events: string[] = [];
    let requestSignal: AbortSignal | undefined;
    const adapter = new NodeServerAdapter(true);
    const server = await createNodeServer((request) => {
      calls++;
      requestSignal = request.signal;
      const upgrade = adapter.upgradeWebSocket(request, { idleTimeout: 0 });
      upgrade.socket.addEventListener("error", () => events.push("error"));
      upgrade.socket.addEventListener("close", () => events.push("close"));
      const headers = new Headers();
      headers.append("set-cookie", "first=1");
      headers.append("set-cookie", "second=2");
      return new Response("forbidden", { status: 403, statusText: "Denied", headers });
    }, { hostname: "127.0.0.1", port: 0 });
    const connection = await Deno.connect({ hostname: "127.0.0.1", port: server.addr.port });
    try {
      const request = new TextEncoder().encode(
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      let offset = 0;
      while (offset < request.length) offset += await connection.write(request.subarray(offset));
      const chunks: Uint8Array[] = [];
      while (true) {
        const buffer = new Uint8Array(4096);
        const count = await connection.read(buffer);
        if (count === null) break;
        chunks.push(buffer.subarray(0, count));
      }
      const result = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
      assertStringIncludes(result, "HTTP/1.1 403 Denied");
      assertStringIncludes(result.toLowerCase(), "set-cookie: first=1");
      assertStringIncludes(result.toLowerCase(), "set-cookie: second=2");
      assertStringIncludes(result, "forbidden");
      assertEquals(calls, 1);
      assertEquals(events, ["error", "close"]);
      assertEquals(requestSignal?.aborted, true);
    } finally {
      connection.close();
      await server.stop();
    }
  });

  it("rejects a cloned or header-spoofed request while the exact request upgrades", async () => {
    const adapter = new NodeServerAdapter(true);
    const server = await createNodeServer((request) => {
      assertThrows(() => adapter.upgradeWebSocket(request.clone()), Error, "original request");
      assertThrows(
        () =>
          adapter.upgradeWebSocket(
            new Request(request.url, {
              headers: request.headers,
            }),
          ),
        Error,
        "original request",
      );
      const upgrade = adapter.upgradeWebSocket(request, { idleTimeout: 0, protocol: "echo" });
      upgrade.socket.addEventListener(
        "message",
        (event) => upgrade.socket.send((event as MessageEvent).data),
      );
      return upgrade.response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: WsNodeWebSocketServerProvider,
    });
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/`, "echo");
    try {
      await new Promise<void>((resolve, reject) => {
        client.onopen = () => resolve();
        client.onerror = () => reject(new Error("Handshake failed"));
      });
      assertEquals(client.protocol, "echo");
      const reply = new Promise<unknown>((resolve) =>
        client.onmessage = (event) => resolve(event.data)
      );
      client.send("hello");
      assertEquals(await reply, "hello");
    } finally {
      const closed = new Promise<void>((resolve) => client.onclose = () => resolve());
      client.close();
      await closed;
      await server.stop();
    }
  });
});
