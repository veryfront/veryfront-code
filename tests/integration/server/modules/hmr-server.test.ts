import { assertEquals, assertExists } from "@std/assert";
import { delay } from "@std/async";
import {
  HMRServer,
  type HMRServerOptions,
  type HMRUpdate,
} from "../../../../src/server/dev-server/hmr-server.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";

// Helper to find an available port
async function getAvailablePort(): Promise<number> {
  const server = Deno.serve({
    port: 0,
    handler: () => new Response("test"),
  });
  const port = server.addr.port;
  await server.shutdown();
  return port;
}

Deno.test({
  name: "HMRServer - creates instance with options",
  fn: async () => {
    const adapter = await getAdapter();
    const options: HMRServerOptions = {
      port: 3001,
      projectDir: "/tmp/test",
      reactRefresh: true,
      adapter,
    };

    const server = new HMRServer(options);
    assertExists(server);
  },
});

Deno.test({
  name: "HMRServer - starts and stops server",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();

    // Give server time to start
    await delay(100);

    // Verify server is running by making a request
    const response = await fetch(`http://127.0.0.1:${port}/test`);
    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Not Found");

    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - serves HMR runtime script",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      reactRefresh: true,
      adapter,
    });

    server.start();
    await delay(100);

    const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/javascript");
    assertEquals(response.headers.get("cache-control"), "no-cache");

    const content = await response.text();
    assertEquals(content.includes("Veryfront HMR Runtime"), true);
    assertEquals(content.includes(`ws://' + host + ':${port}`), true);

    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - handles WebSocket connections",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      reactRefresh: true,
      adapter,
    });

    server.start();
    await delay(100);

    // Connect WebSocket client
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const messages: any[] = [];
    ws.onmessage = (event) => {
      messages.push(JSON.parse(event.data));
    };

    // Wait for connection to open
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    // Wait for initial connection message
    await delay(100);

    assertEquals(messages.length, 1);
    assertEquals(messages[0].type, "connected");
    assertEquals(messages[0].reactRefresh, true);

    ws.close();
    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - sends updates to connected clients",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const messages: any[] = [];
    ws.onmessage = (event) => {
      messages.push(JSON.parse(event.data));
    };

    // Wait for connection
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    // Send update
    const update: HMRUpdate = {
      type: "update",
      path: "/src/app.tsx",
      timestamp: Date.now(),
    };

    server.sendUpdate(update);

    // Wait for update message
    await delay(100);

    // Should have connected message and update message
    assertEquals(messages.length, 2);
    assertEquals(messages[1].type, "update");
    assertEquals(messages[1].path, "/src/app.tsx");

    ws.close();
    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - handles multiple WebSocket clients",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    // Connect multiple clients
    const clients = [];
    const messageArrays = [];

    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const messages: any[] = [];

      ws.onmessage = (event) => {
        messages.push(JSON.parse(event.data));
      };

      clients.push(ws);
      messageArrays.push(messages);
    }

    // Wait for all connections
    await Promise.all(
      clients.map(
        (ws) =>
          new Promise((resolve) => {
            ws.onopen = resolve;
          }),
      ),
    );

    await delay(100);

    // Send update to all clients
    const update: HMRUpdate = {
      type: "reload",
    };

    server.sendUpdate(update);
    await delay(100);

    // All clients should receive the update
    for (const messages of messageArrays) {
      assertEquals(messages.length, 2); // connected + reload
      assertEquals(messages[1].type, "reload");
    }

    // Close all clients
    for (const ws of clients) {
      ws.close();
    }

    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - removes disconnected clients",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    // Connect two clients
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

    const messages1: any[] = [];
    const messages2: any[] = [];

    ws1.onmessage = (event) => {
      messages1.push(JSON.parse(event.data));
    };

    ws2.onmessage = (event) => {
      messages2.push(JSON.parse(event.data));
    };

    // Wait for connections
    await Promise.all([
      new Promise((resolve) => {
        ws1.onopen = resolve;
      }),
      new Promise((resolve) => {
        ws2.onopen = resolve;
      }),
    ]);

    await delay(100);

    // Close one client
    ws1.close();
    await delay(100);

    // Send update
    const update: HMRUpdate = {
      type: "update",
      path: "/test.css",
    };

    server.sendUpdate(update);
    await delay(100);

    // Only ws2 should receive the update
    assertEquals(messages1.length, 1); // Only connected message
    assertEquals(messages2.length, 2); // Connected + update
    assertEquals(messages2[1].type, "update");

    ws2.close();
    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - handles WebSocket upgrade request",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    // Make a regular HTTP request (no upgrade)
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: {
        connection: "keep-alive",
      },
    });

    assertEquals(response.status, 404);
    await response.text(); // Consume the body to avoid leak

    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - only sends to open WebSocket connections",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    // Connect two clients
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

    const messages: any[] = [];
    ws2.onmessage = (event) => {
      messages.push(JSON.parse(event.data));
    };

    // Wait for connections
    await Promise.all([
      new Promise((resolve) => {
        ws1.onopen = resolve;
      }),
      new Promise((resolve) => {
        ws2.onopen = resolve;
      }),
    ]);

    await delay(100);

    // Close ws1 but don't wait for close event
    ws1.close();

    // Send update immediately
    const update: HMRUpdate = {
      type: "update",
      path: "/test.js",
    };

    server.sendUpdate(update);
    await delay(100);

    // ws2 should still receive the update
    assertEquals(messages.length >= 2, true); // At least connected + update

    ws2.close();
    await server.stop();
  },
});

Deno.test({
  name: "HMRServer - getHMRRuntime includes React Refresh logic",
  fn: async () => {
    const adapter = await getAdapter();
    const server = new HMRServer({
      port: 3001,
      projectDir: "/tmp/test",
      reactRefresh: true,
      adapter,
    });

    // Access private method via prototype
    const proto = Object.getPrototypeOf(server);
    const runtime = proto.getHMRRuntime.call(server);

    assertEquals(runtime.includes("reactRefreshEnabled"), true);
    assertEquals(runtime.includes("$RefreshReg$"), true);
    assertEquals(runtime.includes("updateCSS"), true);
    assertEquals(runtime.includes("window.__veryfrontHMRWebSocket"), true);
  },
});

Deno.test({
  name: "HMRServer - runtime handles different update types",
  fn: async () => {
    const adapter = await getAdapter();
    const server = new HMRServer({
      port: 3001,
      projectDir: "/tmp/test",
      adapter,
    });

    const proto = Object.getPrototypeOf(server);
    const runtime = proto.getHMRRuntime.call(server);

    // Check runtime handles different message types
    assertEquals(runtime.includes("case 'connected':"), true);
    assertEquals(runtime.includes("case 'update':"), true);
    assertEquals(runtime.includes("case 'reload':"), true);
    assertEquals(runtime.includes("window.location.reload()"), true);
  },
});

Deno.test({
  name: "HMRServer - stop closes all client connections",
  permissions: { net: true },
  fn: async () => {
    const adapter = await getAdapter();
    const port = await getAvailablePort();
    const server = new HMRServer({
      port,
      projectDir: "/tmp/test",
      adapter,
    });

    server.start();
    await delay(100);

    // Connect multiple clients
    const clients = [];
    const closedPromises = [];

    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const closedPromise = new Promise((resolve) => {
        ws.onclose = resolve;
      });

      clients.push(ws);
      closedPromises.push(closedPromise);
    }

    // Wait for all connections
    await Promise.all(
      clients.map(
        (ws) =>
          new Promise((resolve) => {
            ws.onopen = resolve;
          }),
      ),
    );

    // Stop server should close all connections
    await server.stop();

    // All clients should be closed
    await Promise.all(closedPromises);

    for (const ws of clients) {
      assertEquals(ws.readyState, WebSocket.CLOSED);
    }
  },
});
