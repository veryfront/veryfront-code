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

const wsIt = isDeno ? it : it.skip;

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve();
  });
}

function collectMessages(ws: WebSocket, messages: unknown[]): void {
  ws.onmessage = (event) => {
    messages.push(JSON.parse(String(event.data)));
  };
}

async function stopServer(
  controller: AbortController,
  server: HMRServer,
): Promise<void> {
  controller.abort();
  await server.stop();
  await delay(100);
  await drainEventLoop();
}

describe("HMR Server Module Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
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

        await delay(100);

        const response = await fetch(`http://127.0.0.1:${port}/test`);
        assertEquals(response.status, 404);
        assertEquals(await response.text(), "Not Found");

        await stopServer(controller, server);
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

        await stopServer(controller, server);
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

        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const messages: unknown[] = [];
        collectMessages(ws, messages);

        await waitForOpen(ws);
        await delay(100);

        assertEquals(messages.length, 1);
        assertEquals((messages[0] as { type: string }).type, "connected");
        assertEquals((messages[0] as { reactRefresh: boolean }).reactRefresh, true);

        ws.close();
        await stopServer(controller, server);
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
        collectMessages(ws, messages);

        await waitForOpen(ws);

        const update: HMRUpdate = {
          type: "update",
          path: "/src/app.tsx",
          timestamp: Date.now(),
        };

        server.sendUpdate(update);
        await delay(100);

        assertEquals(messages.length, 2);
        assertEquals((messages[1] as { type: string }).type, "update");
        assertEquals((messages[1] as { path: string }).path, "/src/app.tsx");

        ws.close();
        await stopServer(controller, server);
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

        const clients: WebSocket[] = [];
        const messageArrays: unknown[][] = [];

        for (let i = 0; i < 3; i++) {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          const messages: unknown[] = [];
          collectMessages(ws, messages);

          clients.push(ws);
          messageArrays.push(messages);
        }

        await Promise.all(clients.map(waitForOpen));
        await delay(100);

        const update: HMRUpdate = { type: "reload" };
        server.sendUpdate(update);
        await delay(100);

        for (const messages of messageArrays) {
          assertEquals(messages.length, 2);
          assertEquals((messages[1] as { type: string }).type, "reload");
        }

        for (const ws of clients) ws.close();

        await stopServer(controller, server);
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

        const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
        const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages1: unknown[] = [];
        const messages2: unknown[] = [];
        collectMessages(ws1, messages1);
        collectMessages(ws2, messages2);

        await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
        await delay(100);

        ws1.close();
        await delay(100);

        const update: HMRUpdate = {
          type: "update",
          path: "/test.css",
        };

        server.sendUpdate(update);
        await delay(100);

        assertEquals(messages1.length, 1);
        assertEquals(messages2.length, 2);
        assertEquals((messages2[1] as { type: string }).type, "update");

        ws2.close();
        await stopServer(controller, server);
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

        const response = await fetch(`http://127.0.0.1:${port}/`, {
          headers: { connection: "keep-alive" },
        });

        assertEquals(response.status, 404);
        await response.text();

        await stopServer(controller, server);
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

        const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
        const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);

        const messages: unknown[] = [];
        collectMessages(ws2, messages);

        await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
        await delay(100);

        ws1.close();

        const update: HMRUpdate = {
          type: "update",
          path: "/test.js",
        };

        server.sendUpdate(update);
        await delay(100);

        assertEquals(messages.length >= 2, true);

        ws2.close();
        await stopServer(controller, server);
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

      const proto = Object.getPrototypeOf(server) as { getHMRRuntime: () => string };
      const runtime = proto.getHMRRuntime.call(server);

      assertEquals(runtime.includes("reactRefreshEnabled"), true);
      assertEquals(runtime.includes("$RefreshReg$"), true);
      assertEquals(runtime.includes("refreshTailwindCSS"), true);
      assertEquals(runtime.includes("window.__veryfrontHMRWebSocket"), true);
    });

    it("runtime handles different update types", async () => {
      const adapter = await getAdapter();
      const server = new HMRServer({
        port: 3001,
        projectDir: "/tmp/test",
        adapter,
      });

      const proto = Object.getPrototypeOf(server) as { getHMRRuntime: () => string };
      const runtime = proto.getHMRRuntime.call(server);

      assertEquals(runtime.includes("case 'connected':"), true);
      assertEquals(runtime.includes("case 'update':"), true);
      assertEquals(runtime.includes("case 'reload':"), true);
      assertEquals(runtime.includes("window.location.reload()"), true);
    });
  });

  describe("HMR Server - Shutdown", () => {
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

        const clients: WebSocket[] = [];
        const closedPromises: Promise<void>[] = [];

        for (let i = 0; i < 3; i++) {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          clients.push(ws);

          closedPromises.push(
            new Promise((resolve) => {
              ws.onclose = () => resolve();
            }),
          );
        }

        await Promise.all(clients.map(waitForOpen));

        controller.abort();
        await server.stop();

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
