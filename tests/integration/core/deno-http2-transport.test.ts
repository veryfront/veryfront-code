import { it } from "#veryfront/testing/bdd.ts";
import { connect, constants } from "node:http2";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { DualProtocolServer } from "#veryfront/platform/adapters/runtime/node/dual-protocol-server.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";

async function bounded<T>(promise: Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(2000);
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout.addEventListener("abort", () => reject(new Error("HTTP2 transport did not settle")), {
        once: true,
      });
    }),
  ]);
}

it("Deno listener serves HTTP1, WebSocket and normalized streaming h2c together", async () => {
  const runtime = new DenoAdapter();
  const server = await runtime.serve((request) => {
    if (request.headers.get("upgrade") === "websocket") {
      const upgrade = runtime.server.upgradeWebSocket(request, { idleTimeout: 0 });
      upgrade.socket.onmessage = (event) => upgrade.socket.send(event.data);
      return upgrade.response;
    }
    if (new URL(request.url).pathname === "/h2") {
      assertEquals(request.url, "http://synthetic.example/h2");
      assertEquals(request.headers.get("host"), "synthetic.example");
      assertEquals([...request.headers.keys()].some((key) => key.startsWith(":")), false);
      const headers = new Headers({
        connection: "keep-alive, x-private-hop",
        "x-private-hop": "remove",
        "keep-alive": "timeout=1",
        "x-end-to-end": "preserve",
      });
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      let count = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (count++ < 32) controller.enqueue(new Uint8Array(65536).fill(7));
            else controller.close();
          },
        }),
        { status: 207, statusText: "Synthetic", headers },
      );
    }
    return new Response("http1");
  }, { hostname: "127.0.0.1", port: 0 });
  const origin = `http://127.0.0.1:${server.addr.port}`;
  const client = connect(origin);
  const ws = new WebSocket(origin.replace("http:", "ws:"));
  try {
    const one = fetch(origin).then((response) => response.text());
    const wsOpen = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket failed"));
    });
    const request = client.request({ ":path": "/h2", ":authority": "synthetic.example" });
    let bytes = 0;
    request.on("response", (headers) => {
      assertEquals(headers[":status"], 207);
      assertEquals(headers["set-cookie"], ["a=1", "b=2"]);
      assertEquals(headers["x-end-to-end"], "preserve");
      for (const name of ["connection", "keep-alive", "x-private-hop"]) {
        assertEquals(headers[name], undefined);
      }
    });
    request.pause();
    const finished = new Promise<void>((resolve, reject) => {
      request.on("data", (chunk) => {
        assert(typeof chunk !== "string");
        assert(chunk.every((byte: number) => byte === 7));
        bytes += chunk.length;
      });
      request.on("end", resolve);
      request.on("error", reject);
      request.end();
    });
    assertEquals(await one, "http1");
    await wsOpen;
    const reply = new Promise<unknown>((resolve) => ws.onmessage = (event) => resolve(event.data));
    ws.send("echo");
    assertEquals(await reply, "echo");
    request.resume();
    await bounded(finished);
    assertEquals(bytes, 32 * 65536);
  } finally {
    const closed = new Promise<void>((resolve) => ws.onclose = () => resolve());
    ws.close();
    await bounded(closed);
    client.destroy();
    await bounded(runtime.shutdown());
  }
});

it("h2c reset after streamed body EOF aborts only its stream and shutdown owns sessions", async () => {
  const runtime = new DenoAdapter();
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const shutdownStarted = Promise.withResolvers<void>();
  const shutdownAborted = Promise.withResolvers<void>();
  const server = await runtime.serve(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/sibling") return new Response("sibling");
    if (path === "/shutdown") {
      request.signal.addEventListener("abort", () => shutdownAborted.resolve(), { once: true });
      shutdownStarted.resolve();
      await shutdownAborted.promise;
      return new Response("stopped");
    }
    assertEquals((await request.text()).length, 65536);
    request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    started.resolve();
    await aborted.promise;
    return new Response("cancelled");
  }, { hostname: "127.0.0.1", port: 0, nodeWebSocketServerProvider: null });
  const client = connect(`http://127.0.0.1:${server.addr.port}`);
  try {
    const cancel = client.request({ ":method": "POST", ":path": "/cancel" });
    cancel.on("error", () => {});
    cancel.write("x".repeat(1024));
    await new Promise((resolve) => setTimeout(resolve, 10));
    cancel.end("x".repeat(64512));
    await bounded(started.promise);
    const sibling = client.request({ ":path": "/sibling" });
    let body = "";
    sibling.on("data", (chunk) => body += chunk.toString());
    const siblingDone = new Promise<void>((resolve, reject) => {
      sibling.on("end", resolve);
      sibling.on("error", reject);
    });
    sibling.end();
    cancel.close(constants.NGHTTP2_CANCEL);
    await bounded(aborted.promise);
    await bounded(siblingDone);
    assertEquals(body, "sibling");
    const pending = client.request({ ":path": "/shutdown" });
    pending.on("error", () => {});
    pending.end();
    await bounded(shutdownStarted.promise);
    await bounded(runtime.shutdown());
    await bounded(shutdownAborted.promise);
  } finally {
    client.destroy();
    await runtime.shutdown();
  }
});

it("dual protocol preface handles fragmentation, EOF, malformed input and timeout", async () => {
  const server = new DualProtocolServer((_request, response) => response.end("ok"), 500);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const sockets: Deno.Conn[] = [];
  const open = async () => {
    const socket = await Deno.connect({ hostname: "127.0.0.1", port: address.port });
    sockets.push(socket);
    return socket;
  };
  try {
    const fragmented = await open();
    const preface = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    for (const byte of preface) {
      await fragmented.write(new Uint8Array([byte]));
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const frame = new Uint8Array(9);
    let offset = 0;
    while (offset < 9) {
      const count = await bounded(fragmented.read(frame.subarray(offset)));
      assert(count !== null);
      offset += count;
    }
    assertEquals(frame[3], 4, "server SETTINGS proves fragmented h2 preface routed intact");
    const eof = await open();
    await eof.write(preface.subarray(0, 3));
    eof.close();
    sockets.splice(sockets.indexOf(eof), 1);
    const stalled = await open();
    await stalled.write(preface.subarray(0, 3));
    assertEquals(await bounded(stalled.read(new Uint8Array(1))), null);
    const malformed = await open();
    await malformed.write(new TextEncoder().encode("PRI * HTTP/2.0x\r\n\r\n"));
    const bytes = new Uint8Array(256);
    const count = await bounded(malformed.read(bytes));
    assert(count !== null);
    assert(new TextDecoder().decode(bytes.subarray(0, count)).startsWith("HTTP/1.1 400"));
  } finally {
    for (const socket of sockets) socket.close();
    server.closeAllConnections();
    await bounded(
      new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      ),
    );
  }
});
