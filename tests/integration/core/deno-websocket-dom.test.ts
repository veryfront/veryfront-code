import { it } from "#veryfront/testing/bdd.ts";
import { isWebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";

for (const transport of ["native", "selected"] as const) {
  it(`Deno DOM WebSocket metadata, binary mode and send order: ${transport}`, async () => {
    const runtime = new DenoAdapter();
    const listening = Promise.withResolvers<number>();
    const facts: unknown[] = [];
    const handler = (request: Request) => {
      const upgrade = transport === "native"
        ? Deno.upgradeWebSocket(request, { protocol: "echo", idleTimeout: 0 })
        : runtime.server.upgradeWebSocket(request, { protocol: "echo", idleTimeout: 0 });
      const socket = upgrade.socket;
      assert(socket instanceof EventTarget);
      // The native Deno path is the independent control for these server-side
      // defaults, including the intentionally empty protocol metadata.
      const dom = socket;
      facts.push([
        dom.url,
        dom.protocol,
        dom.extensions,
        dom.binaryType,
        dom.bufferedAmount,
        dom.CONNECTING,
        dom.OPEN,
        dom.CLOSING,
        dom.CLOSED,
      ]);
      dom.binaryType = "blob";
      const events: string[] = [];
      dom.addEventListener("open", () => events.push("listener"));
      dom.onopen = () => {
        events.push("property");
        facts.push([...events]);
        assertEquals(dom.bufferedAmount >= 0, true);
        dom.send(new Blob(["first"]));
        dom.send(new Uint8Array([2]));
        dom.send("third");
        Reflect.apply(dom.send, dom, [42]);
        Reflect.apply(dom.send, dom, [{ toString: () => "object-string" }]);
        assertThrows(() => Reflect.apply(dom.send, dom, []), TypeError);
      };
      dom.onmessage = async (event) => {
        facts.push(event.data instanceof Blob);
        assertEquals(new Uint8Array(await event.data.arrayBuffer()), new Uint8Array([7]));
        dom.send("received");
      };
      return upgrade.response;
    };
    const native = transport === "native"
      ? Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }: Deno.NetAddr) => listening.resolve(port),
      }, (request) => {
        const response = handler(request);
        assert(!isWebSocketUpgradeResponse(response));
        return response;
      })
      : undefined;
    const selected = transport === "selected"
      ? runtime.serve(handler, {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => listening.resolve(port),
      })
      : undefined;
    const client = new WebSocket(`ws://127.0.0.1:${await listening.promise}/`, "echo");
    const received: Array<Promise<string | number[]>> = [];
    const completed = Promise.withResolvers<void>();
    client.onmessage = (event) => {
      received.push(
        typeof event.data === "string"
          ? Promise.resolve(event.data)
          : event.data.arrayBuffer().then((buffer: ArrayBuffer) =>
            Array.from(new Uint8Array(buffer))
          ),
      );
      if (received.length === 5) client.send(new Uint8Array([7]));
      if (received.length === 6) completed.resolve();
    };
    client.onerror = () => completed.reject(new Error("DOM control handshake failed"));
    try {
      await completed.promise;
      assertEquals(await Promise.all(received), [
        [102, 105, 114, 115, 116],
        [2],
        "third",
        "42",
        "object-string",
        "received",
      ]);
      assertEquals(facts, [
        ["", "", "", "arraybuffer", 0, 0, 1, 2, 3],
        ["listener", "property"],
        true,
      ]);
    } finally {
      const closed = Promise.withResolvers<void>();
      client.onclose = () => closed.resolve();
      client.close();
      await closed.promise;
      await native?.shutdown();
      await runtime.shutdown();
      await selected;
    }
  });
}

it("explicitly disabled Deno WebSocket provider never falls back", async () => {
  const runtime = new DenoAdapter();
  const failed = Promise.withResolvers<void>();
  const server = await runtime.serve((request) => {
    const upgrade = runtime.server.upgradeWebSocket(request, { idleTimeout: 0 });
    upgrade.socket.onerror = () => failed.resolve();
    return upgrade.response;
  }, { hostname: "127.0.0.1", port: 0, nodeWebSocketServerProvider: null });
  const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/`);
  const closed = Promise.withResolvers<void>();
  let opened = false;
  client.onopen = () => {
    opened = true;
  };
  client.onerror = () => {};
  client.onclose = () => closed.resolve();
  try {
    await failed.promise;
    await closed.promise;
    assertEquals(opened, false);
  } finally {
    client.close();
    await runtime.shutdown();
  }
});

it("custom Deno provider supplies the real buffered amount accessor", async () => {
  const { WsNodeWebSocketServerProvider: source } = await import(
    "../../../extensions/ext-node-websocket-ws/src/index.ts"
  );
  let servers = 0;
  let reads = 0;
  const provider = {
    supportsIdleTimeout: true as const,
    createServer(options: Parameters<typeof source.createServer>[0]) {
      servers++;
      return source.createServer(options);
    },
    getBufferedAmount(connection: Parameters<NonNullable<typeof source.getBufferedAmount>>[0]) {
      reads++;
      return source.getBufferedAmount!(connection);
    },
  };
  const runtime = new DenoAdapter();
  const observed = Promise.withResolvers<void>();
  const server = await runtime.serve((request) => {
    const upgrade = runtime.server.upgradeWebSocket(request);
    assertEquals(upgrade.socket.bufferedAmount, 0);
    assertEquals(reads, 0, "connecting socket must not query the transport");
    upgrade.socket.onopen = () => {
      assertEquals(upgrade.socket.bufferedAmount, 0);
      assertEquals(reads, 1);
      observed.resolve();
    };
    return upgrade.response;
  }, { hostname: "127.0.0.1", port: 0, nodeWebSocketServerProvider: provider });
  const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/`);
  try {
    await observed.promise;
    assertEquals(servers, 1);
  } finally {
    const closed = Promise.withResolvers<void>();
    client.onclose = () => closed.resolve();
    // The server open callback can precede the client open event.
    if (client.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => client.onopen = () => resolve());
    }
    client.close();
    await closed.promise;
    await runtime.shutdown();
  }
});

for (const transport of ["native", "selected"] as const) {
  it(`Deno Blob send drains before immediate close: ${transport}`, async () => {
    const runtime = new DenoAdapter();
    const listening = Promise.withResolvers<number>();
    const serverClosed = Promise.withResolvers<CloseEvent>();
    const handler = (request: Request) => {
      const upgrade = transport === "native"
        ? Deno.upgradeWebSocket(request, { idleTimeout: 0 })
        : runtime.server.upgradeWebSocket(request, { idleTimeout: 0 });
      upgrade.socket.onopen = () => {
        upgrade.socket.send(new Blob(["before-close"]));
        assertEquals(upgrade.socket.bufferedAmount, 0);
        if (transport === "selected") {
          assertThrows(() => upgrade.socket.close(1005), TypeError);
          assertEquals(upgrade.socket.readyState, WebSocket.OPEN);
        }
        Reflect.apply(upgrade.socket.close, upgrade.socket, [1000.4, { toString: () => "done" }]);
        assertEquals(upgrade.socket.readyState, WebSocket.CLOSING);
      };
      upgrade.socket.onclose = (event) => serverClosed.resolve(event);
      return upgrade.response;
    };
    const native = transport === "native"
      ? Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => listening.resolve(port),
      }, (request) => {
        const response = handler(request);
        assert(!isWebSocketUpgradeResponse(response));
        return response;
      })
      : undefined;
    const selected = transport === "selected"
      ? runtime.serve(handler, {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => listening.resolve(port),
      })
      : undefined;
    const client = new WebSocket(`ws://127.0.0.1:${await listening.promise}/`);
    const messages: Promise<string>[] = [];
    const closed = Promise.withResolvers<CloseEvent>();
    client.onmessage = (event) => messages.push(event.data.text());
    client.onclose = (event) => closed.resolve(event);
    client.onerror = () => closed.reject(new Error("Blob close control failed"));
    try {
      const event = await closed.promise;
      assertEquals(await Promise.all(messages), ["before-close"]);
      assertEquals([event.code, event.reason, event.wasClean], [1000, "done", true]);
      const serverEvent = await serverClosed.promise;
      assertEquals([serverEvent.code, serverEvent.reason, serverEvent.wasClean], [
        1000,
        "done",
        true,
      ]);
    } finally {
      client.close();
      await native?.shutdown();
      await runtime.shutdown();
      await selected;
    }
  });
}
