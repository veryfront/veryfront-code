import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { delay } from "@std/async";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import {
  HMRServer,
  type HMRServerOptions,
  type HMRUpdate,
} from "../../../../src/server/dev-server/hmr-server.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { isDeno } from "../../../../src/platform/compat/runtime.ts";

// WebSocket tests only work in Deno - Bun's WebSocket API requires different integration
const wsIt = isDeno ? it : it.skip;

describe("HMR Server Module Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("HMR Server - Instance Creation", () => {
    it("creates instance with options", async () => {
      const adapter = await getAdapter();
      const options: HMRServerOptions = {
        port: 3001,
        projectDir: "/tmp/test",
        reactRefresh: true,
        adapter,
      };

      const server = new HMRServer(options);
      assertExists(server);
    });
  });

  describe("HMR Server - Server Lifecycle", () => {
    it("starts and stops server", async () => {
      await withTestContext("hmr-start-stop", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();

        // Give server time to start
        await delay(100);

        // Verify server is running by making a request
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        assertEquals(response.status, 404);
        assertEquals(await response.text(), "Not Found");

        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });
  });

  describe("HMR Server - HMR Runtime Script", () => {
    it("serves HMR runtime script", async () => {
      await withTestContext("hmr-runtime-script", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          reactRefresh: true,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "application/javascript");
        assertEquals(response.headers.get("cache-control"), "no-cache");

        const content = await response.text();
        assertEquals(content.includes("Veryfront HMR Runtime"), true);
        assertEquals(content.includes(`ws://' + host + ':${port}`), true);

        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });
  });

  describe("HMR Server - WebSocket Connections", () => {
    wsIt("handles WebSocket connections", async () => {
      await withTestContext("hmr-websocket-connection", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          reactRefresh: true,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        // Connect WebSocket client
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages: unknown[] = [];
        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data as string));
        };

        // Wait for connection to open
        await new Promise((resolve) => {
          ws.onopen = resolve;
        });

        // Wait for initial connection message
        await delay(100);

        assertEquals(messages.length, 1);
        assertEquals((messages[0] as { type: string }).type, "connected");
        assertEquals((messages[0] as { reactRefresh: boolean }).reactRefresh, true);

        ws.close();
        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });

    wsIt("sends updates to connected clients", async () => {
      await withTestContext("hmr-send-updates", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        const ws = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages: unknown[] = [];
        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data as string));
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
        assertEquals((messages[1] as { type: string }).type, "update");
        assertEquals((messages[1] as { path: string }).path, "/src/app.tsx");

        ws.close();
        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });

    wsIt("handles multiple WebSocket clients", async () => {
      await withTestContext("hmr-multiple-clients", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        // Connect multiple clients
        const clients = [];
        const messageArrays: unknown[][] = [];

        for (let i = 0; i < 3; i++) {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          const messages: unknown[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data as string));
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
          assertEquals((messages[1] as { type: string }).type, "reload");
        }

        // Close all clients
        for (const ws of clients) {
          ws.close();
        }

        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });

    wsIt("removes disconnected clients", async () => {
      await withTestContext("hmr-remove-disconnected", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        // Connect two clients
        const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
        const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages1: unknown[] = [];
        const messages2: unknown[] = [];

        ws1.onmessage = (event) => {
          messages1.push(JSON.parse(event.data as string));
        };

        ws2.onmessage = (event) => {
          messages2.push(JSON.parse(event.data as string));
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
        assertEquals((messages2[1] as { type: string }).type, "update");

        ws2.close();
        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });

    it("handles WebSocket upgrade request", async () => {
      await withTestContext("hmr-websocket-upgrade", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
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

        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });

    wsIt("only sends to open WebSocket connections", async () => {
      await withTestContext("hmr-open-connections-only", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
        server.start();
        await delay(100);

        // Connect two clients
        const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
        const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages: unknown[] = [];
        ws2.onmessage = (event) => {
          messages.push(JSON.parse(event.data as string));
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
        controller.abort();
        await server.stop();
        await delay(100);
        await drainEventLoop();
      });
    });
  });

  describe("HMR Server - Runtime Generation", () => {
    it("getHMRRuntime includes React Refresh logic", async () => {
      const adapter = await getAdapter();
      const server = new HMRServer({
        port: 3001,
        projectDir: "/tmp/test",
        reactRefresh: true,
        adapter,
      });

      // Access private method via prototype
      const proto = Object.getPrototypeOf(server);
      const runtime = proto.getHMRRuntime.call(server) as string;

      assertEquals(runtime.includes("reactRefreshEnabled"), true);
      assertEquals(runtime.includes("$RefreshReg$"), true);
      assertEquals(runtime.includes("updateCSS"), true);
      assertEquals(runtime.includes("window.__veryfrontHMRWebSocket"), true);
    });

    it("runtime handles different update types", async () => {
      const adapter = await getAdapter();
      const server = new HMRServer({
        port: 3001,
        projectDir: "/tmp/test",
        adapter,
      });

      const proto = Object.getPrototypeOf(server);
      const runtime = proto.getHMRRuntime.call(server) as string;

      // Check runtime handles different message types
      assertEquals(runtime.includes("case 'connected':"), true);
      assertEquals(runtime.includes("case 'update':"), true);
      assertEquals(runtime.includes("case 'reload':"), true);
      assertEquals(runtime.includes("window.location.reload()"), true);
    });
  });

  describe("HMR Server - Shutdown", () => {
    // Note: This test is skipped due to WebSocket close handshake issues in Deno
    // The client-side onclose handlers may not fire reliably when the server calls client.close()
    it.ignore("stop closes all client connections", async () => {
      await withTestContext("hmr-stop-closes-clients", async (context) => {
        const adapter = await getAdapter();
        const controller = new AbortController();
        const port = await context.allocatePort();
        const server = new HMRServer({
          port,
          projectDir: "/tmp/test",
          adapter,
          signal: controller.signal,
        });

        context.trackResource(server, "HMR Server");
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
        controller.abort();
        await server.stop();

        // All clients should be closed
        await Promise.all(closedPromises);

        for (const ws of clients) {
          assertEquals(ws.readyState, WebSocket.CLOSED);
        }

        await delay(100);
        await drainEventLoop();
      });
    });
  });
});
