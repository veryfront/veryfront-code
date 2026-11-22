import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createDenoNodeServerWithStartupOwner,
  createNodeServer,
} from "#veryfront/platform/adapters/runtime/node/http-server.ts";
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

it("Deno default WebSocket provider resolves once after concurrent authorized upgrades", async () => {
  const adapter = new NodeServerAdapter(true);
  const provider = Promise.withResolvers<typeof WsNodeWebSocketServerProvider>();
  const bothRequests = Promise.withResolvers<void>();
  let requests = 0;
  let loads = 0;
  const server = await createDenoNodeServerWithStartupOwner(
    (request) => {
      if (++requests === 2) bothRequests.resolve();
      return adapter.upgradeWebSocket(request, { idleTimeout: 0 }).response;
    },
    { hostname: "127.0.0.1", port: 0 },
    undefined,
    () => {
      loads++;
      return provider.promise;
    },
  );
  const clients = [
    new WebSocket(`ws://127.0.0.1:${server.addr.port}`),
    new WebSocket(`ws://127.0.0.1:${server.addr.port}`),
  ];
  const opened = clients.map((client) =>
    new Promise<void>((resolve, reject) => {
      client.onopen = () => resolve();
      client.onerror = () => reject(new Error("lazy provider handshake failed"));
    })
  );
  try {
    await bothRequests.promise;
    assertEquals(loads, 1);
    provider.resolve(WsNodeWebSocketServerProvider);
    await Promise.all(opened);
    assertEquals(loads, 1);
  } finally {
    await Promise.all(clients.map((client) =>
      new Promise<void>((resolve) => {
        client.onclose = () => resolve();
        client.close();
      })
    ));
    await server.stop();
  }
});

for (const policy of ["disabled", "custom", "reject"] as const) {
  it(`Deno lazy WebSocket provider honors ${policy} policy`, async () => {
    const adapter = new NodeServerAdapter(true);
    let loads = 0;
    const failure = Promise.withResolvers<void>();
    const options: Parameters<typeof createDenoNodeServerWithStartupOwner>[1] = {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: policy === "disabled"
        ? null
        : policy === "custom"
        ? WsNodeWebSocketServerProvider
        : undefined,
    };
    const server = await createDenoNodeServerWithStartupOwner(
      (request) => {
        const upgrade = adapter.upgradeWebSocket(request, { idleTimeout: 0 });
        upgrade.socket.addEventListener("error", () => failure.resolve());
        return upgrade.response;
      },
      options,
      undefined,
      () => {
        loads++;
        return Promise.reject(new Error("synthetic provider load failure"));
      },
    );
    // Caller mutation after startup cannot broaden the captured policy.
    options.nodeWebSocketServerProvider = policy === "disabled" ? undefined : null;
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}`);
    let opened = false;
    const ready = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    client.onopen = () => {
      opened = true;
      ready.resolve();
    };
    client.onerror = () => {};
    client.onclose = () => {
      closed.resolve();
      ready.resolve();
    };
    try {
      await ready.promise;
      assertEquals(opened, policy === "custom");
      assertEquals(loads, policy === "reject" ? 1 : 0);
      if (!opened) await failure.promise;
    } finally {
      client.close();
      await closed.promise;
      await server.stop();
    }
  });
}

it("Deno lazy provider cannot create a server after listener shutdown", async () => {
  const adapter = new NodeServerAdapter(true);
  const loading = Promise.withResolvers<void>();
  const provider = Promise.withResolvers<typeof WsNodeWebSocketServerProvider>();
  const failed = Promise.withResolvers<void>();
  let servers = 0;
  const server = await createDenoNodeServerWithStartupOwner(
    (request) => {
      const upgrade = adapter.upgradeWebSocket(request, { idleTimeout: 0 });
      upgrade.socket.addEventListener("error", () => failed.resolve());
      return upgrade.response;
    },
    { hostname: "127.0.0.1", port: 0 },
    undefined,
    () => {
      loading.resolve();
      return provider.promise;
    },
  );
  const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}`);
  const closed = Promise.withResolvers<void>();
  let opened = false;
  client.onopen = () => {
    opened = true;
  };
  client.onerror = () => {};
  client.onclose = () => closed.resolve();
  try {
    await loading.promise;
    await server.stop();
    provider.resolve({
      ...WsNodeWebSocketServerProvider,
      createServer(options) {
        servers++;
        return WsNodeWebSocketServerProvider.createServer(options);
      },
    });
    await closed.promise;
    await failed.promise;
    assertEquals(opened, false);
    assertEquals(servers, 0);
  } finally {
    client.close();
    await server.stop();
  }
});

it("malformed upgrade authority returns 400 before handler or default provider loading", async () => {
  let calls = 0;
  let loads = 0;
  const server = await createDenoNodeServerWithStartupOwner(
    () => {
      calls++;
      return new Response("unexpected");
    },
    { hostname: "127.0.0.1", port: 0 },
    undefined,
    () => {
      loads++;
      return Promise.resolve(WsNodeWebSocketServerProvider);
    },
  );
  const connection = await Deno.connect({ hostname: "127.0.0.1", port: server.addr.port });
  try {
    await connection.write(new TextEncoder().encode(
      "GET / HTTP/1.1\r\nHost: [\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    ));
    const chunks: string[] = [];
    while (true) {
      const bytes = new Uint8Array(1024);
      const count = await connection.read(bytes);
      if (count === null) break;
      chunks.push(new TextDecoder().decode(bytes.subarray(0, count)));
    }
    const response = chunks.join("");
    assertStringIncludes(response, "HTTP/1.1 400 Bad Request");
    assertStringIncludes(response, "Bad Request");
    assertEquals(calls, 0);
    assertEquals(loads, 0);
  } finally {
    connection.close();
    await server.stop();
  }
});
