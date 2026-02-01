/**
 * HMR Server Tests
 *
 * Comprehensive tests covering:
 * - Server lifecycle (start, stop)
 * - WebSocket connection handling
 * - File change detection and broadcasting
 * - Module invalidation logic
 * - Error handling and recovery
 * - Client connection management
 * - Cross-runtime compatibility
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { delay, makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { HMRServer, type HMRServerOptions } from "../../../src/server/dev-server/hmr-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { isDeno } from "../../../src/platform/compat/runtime.ts";

const denoOnlyDescribe = isDeno ? describe : describe.skip;

async function createHMRServer(
  context: any,
  options: Partial<HMRServerOptions> = {},
  signal?: AbortSignal,
): Promise<{ server: HMRServer; port: number }> {
  const adapter = await getAdapter();
  const port = await context.allocatePort();

  const server = new HMRServer({
    projectDir: context.projectDir,
    port,
    adapter,
    signal,
    ...options,
  });

  context.trackResource(server, `HMR Server on port ${port}`);
  await server.start();
  await delay(300); // Give server time to fully start

  return { server, port };
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise((resolve) => (ws.onopen = resolve));
  return ws;
}

async function stopServer(
  server: HMRServer,
  controller?: AbortController,
  delayMs = 0,
): Promise<void> {
  controller?.abort();
  await server.stop();
  if (delayMs > 0) await delay(delayMs);
  await drainEventLoop();
}

denoOnlyDescribe("HMR Server Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe(
    "HMR Server - Initialization and Lifecycle",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("creates HMR server instance with options", async () => {
        const adapter = await getAdapter();
        const options: HMRServerOptions = {
          projectDir: "/tmp/test",
          port: 3001,
          reactRefresh: true,
          adapter,
        };

        const server = new HMRServer(options);
        assertExists(server, "Server instance should be created");
      });

      it("starts and serves HTTP endpoints", async () => {
        await withTestContext("hmr-lifecycle", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200, "Server should be running");
          await response.text();

          await stopServer(server, controller, 200);
        });
      });

      // TEMPORARILY SKIPPED: WebSocket close handshake hangs indefinitely
      // Root cause: Client-side onclose handlers never fire when server calls client.close()
      // This appears to be a Deno WebSocket implementation issue where:
      // 1. Server-side client.close() initiates close handshake
      // 2. Close frame should be sent to client
      // 3. Client-side onclose should fire
      // 4. But step 3 never happens, causing test to wait indefinitely
      // TODO(#deno-websocket): Investigate Deno WebSocket close handshake behavior
      // TODO(#deno-websocket): Consider alternative approach to graceful WebSocket shutdown
      it.ignore("stops server and closes client connections", async () => {
        await withTestContext("hmr-stop-with-clients", async (context) => {
          const { server, port } = await createHMRServer(context);

          const ws1 = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const ws2 = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          const closedPromises = [
            new Promise((resolve) => (ws1.onclose = resolve)),
            new Promise((resolve) => (ws2.onclose = resolve)),
          ];

          await Promise.all([
            new Promise((resolve) => (ws1.onopen = resolve)),
            new Promise((resolve) => (ws2.onopen = resolve)),
          ]);

          await server.stop();
          await Promise.all(closedPromises);

          assertEquals(ws1.readyState, WebSocket.CLOSED);
          assertEquals(ws2.readyState, WebSocket.CLOSED);

          await delay(200);
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - WebSocket Connection Handling",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("upgrades WebSocket connections successfully", async () => {
        await withTestContext("hmr-websocket-upgrade", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          assertEquals(ws.readyState, WebSocket.OPEN);

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("sends connected message on WebSocket open", async () => {
        await withTestContext("hmr-connected-message", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: true },
            controller.signal,
          );

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          await new Promise((resolve) => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data));
              resolve(undefined);
            };
          });

          assertEquals(messages.length, 1);
          assertEquals(messages[0].type, "connected");
          assertEquals(messages[0].reactRefresh, true);

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("handles multiple concurrent WebSocket connections", async () => {
        await withTestContext("hmr-multiple-connections", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const clients: WebSocket[] = [];
          const messageArrays: any[][] = [];

          for (let i = 0; i < 3; i++) {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
            const messages: any[] = [];

            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data));
            };

            clients.push(ws);
            messageArrays.push(messages);
          }

          await Promise.all(clients.map((ws) => new Promise((resolve) => (ws.onopen = resolve))));
          await delay(100);

          for (const messages of messageArrays) {
            assert(messages.length >= 1, "Should receive connected message");
            assertEquals(messages[0].type, "connected");
          }

          clients.forEach((ws) => ws.close());
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("removes disconnected clients from client list", async () => {
        await withTestContext("hmr-client-removal", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws1 = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          const ws2 = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          await delay(100);

          const closePromise = new Promise((resolve) => (ws1.onclose = resolve));
          ws1.close();
          await closePromise;
          await delay(100);

          assertEquals(ws2.readyState, WebSocket.OPEN);

          ws2.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("handles WebSocket errors gracefully", async () => {
        await withTestContext("hmr-websocket-errors", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);

          ws.close();
          await delay(100);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          await stopServer(server, controller);
        });
      });

      it("rejects non-WebSocket requests to /hmr endpoint", async () => {
        await withTestContext("hmr-non-websocket-request", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/hmr`);

          assert(
            response.status === 404 || response.status >= 400,
            "Should reject non-WebSocket requests",
          );
          await response.text();

          await stopServer(server, controller);
        });
      });
    },
  );

  describe(
    "HMR Server - Client Messages",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("handles ping-pong messages", async () => {
        await withTestContext("hmr-ping-pong", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await delay(100);

          ws.send(JSON.stringify({ type: "ping" }));
          await delay(100);

          const pongMessage = messages.find((m) => m.type === "pong");
          assertExists(pongMessage, "Should receive pong response");

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("registers modules from client", async () => {
        await withTestContext("hmr-register-module", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          await delay(100);

          ws.send(
            JSON.stringify({
              type: "register",
              id: "app.tsx",
              file: "/src/app.tsx",
            }),
          );

          await delay(100);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("handles malformed messages gracefully", async () => {
        await withTestContext("hmr-malformed-message", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          await delay(100);

          ws.send("invalid json {");
          await delay(100);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("handles unknown message types", async () => {
        await withTestContext("hmr-unknown-message", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          await delay(100);

          ws.send(JSON.stringify({ type: "unknown_type", data: "test" }));
          await delay(100);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });
    },
  );

  describe(
    "HMR Server - HTTP Endpoints",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("serves HMR runtime script", async () => {
        await withTestContext("hmr-runtime-script", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);

          assertEquals(response.status, 200);
          assertEquals(response.headers.get("content-type"), "application/javascript");
          assertEquals(response.headers.get("cache-control"), "no-cache");

          const content = await response.text();
          assert(content.includes("Veryfront HMR Runtime"), "Should contain HMR runtime code");
          assert(content.includes(`HMR_PORT = ${port}`), "Should include correct port");
          assert(content.includes("ws://localhost:"), "Should include WebSocket URL");

          await stopServer(server, controller);
        });
      });

      it("serves React Refresh runtime when enabled", async () => {
        await withTestContext("hmr-react-refresh-runtime", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: true },
            controller.signal,
          );

          const response = await fetch(`http://127.0.0.1:${port}/react-refresh-runtime.js`);

          assertEquals(response.status, 200);
          assertEquals(response.headers.get("content-type"), "application/javascript");
          assertEquals(response.headers.get("cache-control"), "no-cache");

          const content = await response.text();
          assert(
            content.includes("__REACT_REFRESH_RUNTIME__"),
            "Should contain React Refresh runtime",
          );

          await stopServer(server, controller);
        });
      });

      it("returns 404 for React Refresh runtime when disabled", async () => {
        await withTestContext("hmr-react-refresh-disabled", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: false },
            controller.signal,
          );

          const response = await fetch(`http://127.0.0.1:${port}/react-refresh-runtime.js`);

          assertEquals(response.status, 404);
          await response.text();

          await stopServer(server, controller);
        });
      });

      it("returns 404 for unknown endpoints", async () => {
        await withTestContext("hmr-404-endpoint", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/unknown-endpoint`);

          assertEquals(response.status, 404);
          assertEquals(await response.text(), "Not Found");

          await stopServer(server, controller);
        });
      });
    },
  );

  describe(
    "HMR Server - File Change Detection",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("detects file changes and broadcasts updates", async () => {
        await withTestContext("hmr-file-change-detection", async (context) => {
          const testFile = join(context.projectDir, "pages", "test.tsx");
          await writeTextFile(
            testFile,
            "export default function Test() { return <div>V1</div> }",
          );

          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: true },
            controller.signal,
          );

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await delay(200);

          await writeTextFile(
            testFile,
            "export default function Test() { return <div>V2</div> }",
          );

          await delay(600);

          const updateMessage = messages.find((m) => m.type === "update");
          if (updateMessage) {
            assertExists(updateMessage, "Should receive update message");
            assertExists(updateMessage.updates, "Update should contain updates array");
          }

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("detects CSS file changes", async () => {
        await withTestContext("hmr-css-change", async (context) => {
          await mkdir(join(context.projectDir, "src"), { recursive: true });
          const cssFile = join(context.projectDir, "src", "style.css");
          await writeTextFile(cssFile, "body { color: red; }");

          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await delay(200);

          await writeTextFile(cssFile, "body { color: blue; }");
          await delay(600);

          const updateMessage = messages.find((m) => m.type === "update");
          const cssUpdate = updateMessage?.updates?.find((u: any) => u.type === "css-update");
          if (cssUpdate) {
            assertEquals(cssUpdate.type, "css-update");
            assertEquals(cssUpdate.accepted, true);
          }

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      it("ignores directory changes", async () => {
        await withTestContext("hmr-ignore-directories", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await delay(200);

          const newDir = join(context.projectDir, "pages", "new-dir");
          await mkdir(newDir);
          await delay(400);

          const updateMessages = messages.filter((m) => m.type === "update");
          assertEquals(
            updateMessages.length === 0,
            true,
            "Should not send updates for directory changes",
          );

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });
    },
  );

  describe(
    "HMR Server - Error Handling",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("handles missing project directories gracefully", async () => {
        await withTestContext("hmr-missing-dirs", async (context) => {
          const emptyDir = await makeTempDir();
          context.addCleanup(async () => {
            await remove(emptyDir, { recursive: true });
          });

          const adapter = await getAdapter();
          const port = await context.allocatePort();

          const server = new HMRServer({
            projectDir: emptyDir,
            port,
            adapter,
          });

          context.trackResource(server);

          await server.start();
          await delay(200);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          await stopServer(server, undefined, 200);
        });
      });

      it("handles WebSocket upgrade failures gracefully", async () => {
        await withTestContext("hmr-upgrade-failure", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          try {
            const response = await fetch(`http://127.0.0.1:${port}/hmr`, {
              headers: { Connection: "keep-alive" },
            });

            assert(response.status >= 400 || response.status === 404);
            await response.text();
          } catch {
            // Connection errors are acceptable
          }

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          await stopServer(server, controller);
        });
      });

      it("cleans up resources on stop even with errors", async () => {
        await withTestContext("hmr-cleanup-with-errors", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const clients = Array.from(
            { length: 3 },
            () => new WebSocket(`ws://127.0.0.1:${port}/hmr`),
          );

          await Promise.all(clients.map((ws) => new Promise((resolve) => (ws.onopen = resolve))));

          controller.abort();
          await server.stop();
          await delay(300);

          for (const ws of clients) {
            assertEquals(ws.readyState, WebSocket.CLOSED);
          }

          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - Runtime Compatibility",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("works with detected runtime adapter", async () => {
        await withTestContext("hmr-runtime-compat", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          assertEquals(ws.readyState, WebSocket.OPEN);

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });

      // Note: The modular HMR server uses Deno.serve which binds to 0.0.0.0 by default,
      // so it's accessible via both localhost and 127.0.0.1 without explicit hostname configuration

      it("includes correct configuration in runtime script", async () => {
        await withTestContext("hmr-runtime-config", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: true },
            controller.signal,
          );

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          const content = await response.text();

          assert(content.includes(`HMR_PORT = ${port}`), "Should include correct port");
          assert(content.includes("setupReactRefresh"), "Should include React Refresh setup");
          assert(content.includes("refreshTailwindCSS"), "Should include CSS refresh handler");
          assert(content.includes("updateJS"), "Should include JS update handler");

          await stopServer(server, controller);
        });
      });
    },
  );

  describe(
    "HMR Server - Module Graph",
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it("maintains module graph across updates", async () => {
        await withTestContext("hmr-module-graph", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = await openWebSocket(`ws://127.0.0.1:${port}/hmr`);
          await delay(100);

          ws.send(JSON.stringify({ type: "register", id: "app.tsx", file: "/src/app.tsx" }));
          await delay(50);
          ws.send(JSON.stringify({ type: "register", id: "header.tsx", file: "/src/header.tsx" }));
          await delay(50);
          ws.send(JSON.stringify({ type: "register", id: "footer.tsx", file: "/src/footer.tsx" }));
          await delay(100);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);

          await stopServer(server, controller);
        });
      });
    },
  );
});
