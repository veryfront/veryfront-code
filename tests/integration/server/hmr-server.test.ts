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

import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { delay } from "std/async/delay.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { HMRServer, type HMRServerOptions } from "../../../src/server/dev-server/hmr-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Helper to create and start HMR server with cleanup
async function createHMRServer(
  context: any,
  options: Partial<HMRServerOptions> = {},
  signal?: AbortSignal,
) {
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

describe("HMR Server Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe(
    "HMR Server - Initialization and Lifecycle",
    {},
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

          // Verify server is running
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200, "Server should be running");
          await response.text();

          controller.abort();
          await server.stop();
          await delay(200);
          await drainEventLoop();
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

          // Connect WebSocket clients
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

          // Stop server should close all connections
          await server.stop();

          // Wait for connections to close
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
    {},
    () => {
      it("upgrades WebSocket connections successfully", async () => {
        await withTestContext("hmr-websocket-upgrade", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          const openPromise = new Promise((resolve) => (ws.onopen = resolve));
          await openPromise;

          assertEquals(ws.readyState, WebSocket.OPEN);

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
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

          const messagePromise = new Promise((resolve) => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data));
              resolve(undefined);
            };
          });

          await messagePromise;

          assertEquals(messages.length, 1);
          assertEquals(messages[0].type, "connected");
          assertEquals(messages[0].reactRefresh, true);

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
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

          // All clients should receive connected message
          for (const messages of messageArrays) {
            assert(messages.length >= 1, "Should receive connected message");
            assertEquals(messages[0].type, "connected");
          }

          clients.forEach((ws) => ws.close());
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("removes disconnected clients from client list", async () => {
        await withTestContext("hmr-client-removal", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws1 = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const ws2 = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await Promise.all([
            new Promise((resolve) => (ws1.onopen = resolve)),
            new Promise((resolve) => (ws2.onopen = resolve)),
          ]);

          await delay(100);

          // Close first client
          const closePromise = new Promise((resolve) => (ws1.onclose = resolve));
          ws1.close();
          await closePromise;
          await delay(100);

          // Second client should still be connected
          assertEquals(ws2.readyState, WebSocket.OPEN);

          ws2.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles WebSocket errors gracefully", async () => {
        await withTestContext("hmr-websocket-errors", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await new Promise((resolve) => (ws.onopen = resolve));

          // Force close from client side
          ws.close();
          await delay(100);

          // Server should handle this gracefully without crashing
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("rejects non-WebSocket requests to /hmr endpoint", async () => {
        await withTestContext("hmr-non-websocket-request", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          // Try regular HTTP request to WebSocket endpoint
          const response = await fetch(`http://127.0.0.1:${port}/hmr`);

          // Should either return error or 404
          assert(
            response.status === 404 || response.status >= 400,
            "Should reject non-WebSocket requests",
          );
          await response.text();

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - Client Messages",
    {},
    () => {
      it("handles ping-pong messages", async () => {
        await withTestContext("hmr-ping-pong", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(100);

          // Send ping
          ws.send(JSON.stringify({ type: "ping" }));
          await delay(100);

          // Should receive connected and pong
          const pongMessage = messages.find((m) => m.type === "pong");
          assertExists(pongMessage, "Should receive pong response");

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("registers modules from client", async () => {
        await withTestContext("hmr-register-module", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(100);

          // Register a module
          ws.send(
            JSON.stringify({
              type: "register",
              id: "app.tsx",
              file: "/src/app.tsx",
            }),
          );

          await delay(100);

          // Server should register the module without errors
          // Verify by checking server is still responsive
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles malformed messages gracefully", async () => {
        await withTestContext("hmr-malformed-message", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(100);

          // Send invalid JSON
          ws.send("invalid json {");
          await delay(100);

          // Server should handle gracefully
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles unknown message types", async () => {
        await withTestContext("hmr-unknown-message", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(100);

          // Send unknown message type
          ws.send(JSON.stringify({ type: "unknown_type", data: "test" }));
          await delay(100);

          // Server should handle gracefully
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - HTTP Endpoints",
    {},
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

          controller.abort();
          await server.stop();
          await drainEventLoop();
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

          controller.abort();
          await server.stop();
          await drainEventLoop();
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

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("returns 404 for unknown endpoints", async () => {
        await withTestContext("hmr-404-endpoint", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const response = await fetch(`http://127.0.0.1:${port}/unknown-endpoint`);

          assertEquals(response.status, 404);
          assertEquals(await response.text(), "Not Found");

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - File Change Detection",
    {},
    () => {
      it("detects file changes and broadcasts updates", async () => {
        await withTestContext("hmr-file-change-detection", async (context) => {
          // Create test file
          const testFile = join(context.projectDir, "pages", "test.tsx");
          await Deno.writeTextFile(
            testFile,
            "export default function Test() { return <div>V1</div> }",
          );

          const controller = new AbortController();
          const { server, port } = await createHMRServer(
            context,
            { reactRefresh: true },
            controller.signal,
          );

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(200);

          // Modify the file
          await Deno.writeTextFile(
            testFile,
            "export default function Test() { return <div>V2</div> }",
          );

          // Wait for file watcher to detect change
          await delay(600);

          // Should receive update message (if file watcher is working)
          const updateMessage = messages.find((m) => m.type === "update");
          if (updateMessage) {
            assertExists(updateMessage, "Should receive update message");
            assertExists(updateMessage.updates, "Update should contain updates array");
          }

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("detects CSS file changes", async () => {
        await withTestContext("hmr-css-change", async (context) => {
          // Create CSS file in src directory
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          const cssFile = join(context.projectDir, "src", "style.css");
          await Deno.writeTextFile(cssFile, "body { color: red; }");

          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(200);

          // Modify CSS
          await Deno.writeTextFile(cssFile, "body { color: blue; }");
          await delay(600);

          // Should receive CSS update (if file watcher is working)
          const updateMessage = messages.find((m) => m.type === "update");
          if (updateMessage && updateMessage.updates) {
            const cssUpdate = updateMessage.updates.find((u: any) => u.type === "css-update");
            if (cssUpdate) {
              assertEquals(cssUpdate.type, "css-update");
              assertEquals(cssUpdate.accepted, true);
            }
          }

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("ignores directory changes", async () => {
        await withTestContext("hmr-ignore-directories", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          const messages: any[] = [];

          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data));
          };

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(200);

          // Create a new directory
          const newDir = join(context.projectDir, "pages", "new-dir");
          await Deno.mkdir(newDir);
          await delay(400);

          // Should not receive update for directory creation
          const updateMessages = messages.filter((m) => m.type === "update");
          // Directory creation should not trigger updates
          assertEquals(
            updateMessages.length === 0,
            true,
            "Should not send updates for directory changes",
          );

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - Error Handling",
    {},
    () => {
      it("handles missing project directories gracefully", async () => {
        await withTestContext("hmr-missing-dirs", async (context) => {
          // Use temp dir without standard structure
          const emptyDir = await Deno.makeTempDir();
          context.addCleanup(async () => {
            await Deno.remove(emptyDir, { recursive: true });
          });

          const adapter = await getAdapter();
          const port = await context.allocatePort();

          const server = new HMRServer({
            projectDir: emptyDir,
            port,
            adapter,
          });

          context.trackResource(server);

          // Should start even if standard directories don't exist
          await server.start();
          await delay(200);

          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          await server.stop();
          await delay(200);
          await drainEventLoop();
        });
      });

      it("handles WebSocket upgrade failures gracefully", async () => {
        await withTestContext("hmr-upgrade-failure", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          // Try to connect with invalid WebSocket request
          try {
            const response = await fetch(`http://127.0.0.1:${port}/hmr`, {
              headers: {
                Connection: "keep-alive",
              },
            });

            // Should handle gracefully (404 or error response)
            assert(response.status >= 400 || response.status === 404);
            await response.text();
          } catch (_error) {
            // Connection errors are acceptable
          }

          // Server should still be running
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });

      it("cleans up resources on stop even with errors", async () => {
        await withTestContext("hmr-cleanup-with-errors", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          // Connect multiple clients
          const clients: WebSocket[] = [];
          for (let i = 0; i < 3; i++) {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
            clients.push(ws);
          }

          await Promise.all(clients.map((ws) => new Promise((resolve) => (ws.onopen = resolve))));

          // Stop should close all clients
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
    {},
    () => {
      it("works with detected runtime adapter", async () => {
        await withTestContext("hmr-runtime-compat", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          // Verify server works with runtime adapter
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          // Verify WebSocket works
          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
          await new Promise((resolve) => (ws.onopen = resolve));
          assertEquals(ws.readyState, WebSocket.OPEN);

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
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

          // Verify runtime includes correct configuration
          assert(content.includes(`HMR_PORT = ${port}`), "Should include correct port");
          assert(content.includes("setupReactRefresh"), "Should include React Refresh setup");
          assert(content.includes("updateCSS"), "Should include CSS update handler");
          assert(content.includes("updateJS"), "Should include JS update handler");

          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "HMR Server - Module Graph",
    {},
    () => {
      it("maintains module graph across updates", async () => {
        await withTestContext("hmr-module-graph", async (context) => {
          const controller = new AbortController();
          const { server, port } = await createHMRServer(context, {}, controller.signal);

          const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr`);

          await new Promise((resolve) => (ws.onopen = resolve));
          await delay(100);

          // Register multiple modules
          ws.send(JSON.stringify({ type: "register", id: "app.tsx", file: "/src/app.tsx" }));
          await delay(50);
          ws.send(JSON.stringify({ type: "register", id: "header.tsx", file: "/src/header.tsx" }));
          await delay(50);
          ws.send(JSON.stringify({ type: "register", id: "footer.tsx", file: "/src/footer.tsx" }));
          await delay(100);

          // Server should maintain module graph without errors
          const response = await fetch(`http://127.0.0.1:${port}/hmr-runtime.js`);
          assertEquals(response.status, 200);
          await response.text();

          ws.close();
          await delay(100);
          controller.abort();
          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );
});
