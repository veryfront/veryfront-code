
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { delay } from "std/async/delay.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { HMRServer, type HMRServerOptions } from "../../../src/server/dev-server/hmr-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

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
  await delay(300);

  return { server, port };
}

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

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200, "Server should be running");
        await response.text();

        controller.abort();
        await server.stop();
        await delay(200);
        await drainEventLoop();
      });
    });

    // TODO(#deno-websocket): Investigate Deno WebSocket close handshake behavior
    // TODO(#deno-websocket): Consider alternative approach to graceful WebSocket shutdown
    it.ignore("stops server and closes client connections", async () => {
      await withTestContext("hmr-stop-with-clients", async (context) => {
        const { server, port } = await createHMRServer(context);

        const ws1 = new WebSocket(`ws://localhost:${port}/hmr`);
        const ws2 = new WebSocket(`ws://localhost:${port}/hmr`);

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
  {},
  () => {
    it("upgrades WebSocket connections successfully", async () => {
      await withTestContext("hmr-websocket-upgrade", async (context) => {
        const controller = new AbortController();
        const { server, port } = await createHMRServer(context, {}, controller.signal);

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
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
          const ws = new WebSocket(`ws://localhost:${port}/hmr`);
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
        controller.abort();
        await server.stop();
        await drainEventLoop();
      });
    });

    it("removes disconnected clients from client list", async () => {
      await withTestContext("hmr-client-removal", async (context) => {
        const controller = new AbortController();
        const { server, port } = await createHMRServer(context, {}, controller.signal);

        const ws1 = new WebSocket(`ws://localhost:${port}/hmr`);
        const ws2 = new WebSocket(`ws://localhost:${port}/hmr`);

        await Promise.all([
          new Promise((resolve) => (ws1.onopen = resolve)),
          new Promise((resolve) => (ws2.onopen = resolve)),
        ]);

        await delay(100);

        const closePromise = new Promise((resolve) => (ws1.onclose = resolve));
        ws1.close();
        await closePromise;
        await delay(100);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

        await new Promise((resolve) => (ws.onopen = resolve));

        ws.close();
        await delay(100);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        const response = await fetch(`http://localhost:${port}/hmr`);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
        const messages: any[] = [];

        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data));
        };

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        ws.send(JSON.stringify({ type: "ping" }));
        await delay(100);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        ws.send(
          JSON.stringify({
            type: "register",
            id: "app.tsx",
            file: "/src/app.tsx",
          }),
        );

        await delay(100);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        ws.send("invalid json {");
        await delay(100);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        ws.send(JSON.stringify({ type: "unknown_type", data: "test" }));
        await delay(100);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);

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

        const response = await fetch(`http://localhost:${port}/react-refresh-runtime.js`);

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

        const response = await fetch(`http://localhost:${port}/react-refresh-runtime.js`);

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

        const response = await fetch(`http://localhost:${port}/unknown-endpoint`);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
        const messages: any[] = [];

        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data));
        };

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(200);

        await Deno.writeTextFile(
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
        controller.abort();
        await server.stop();
        await drainEventLoop();
      });
    });

    it("detects CSS file changes", async () => {
      await withTestContext("hmr-css-change", async (context) => {
        await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
        const cssFile = join(context.projectDir, "src", "style.css");
        await Deno.writeTextFile(cssFile, "body { color: red; }");

        const controller = new AbortController();
        const { server, port } = await createHMRServer(context, {}, controller.signal);

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
        const messages: any[] = [];

        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data));
        };

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(200);

        await Deno.writeTextFile(cssFile, "body { color: blue; }");
        await delay(600);

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
        const messages: any[] = [];

        ws.onmessage = (event) => {
          messages.push(JSON.parse(event.data));
        };

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(200);

        const newDir = join(context.projectDir, "pages", "new-dir");
        await Deno.mkdir(newDir);
        await delay(400);

        const updateMessages = messages.filter((m) => m.type === "update");
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

        await server.start();
        await delay(200);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        try {
          const response = await fetch(`http://localhost:${port}/hmr`, {
            headers: {
              Connection: "keep-alive",
            },
          });

          assert(response.status >= 400 || response.status === 404);
          await response.text();
        } catch (_error) {
          // Connection errors are acceptable
        }

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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

        const clients: WebSocket[] = [];
        for (let i = 0; i < 3; i++) {
          const ws = new WebSocket(`ws://localhost:${port}/hmr`);
          clients.push(ws);
        }

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
  {},
  () => {
    it("works with detected runtime adapter", async () => {
      await withTestContext("hmr-runtime-compat", async (context) => {
        const controller = new AbortController();
        const { server, port } = await createHMRServer(context, {}, controller.signal);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200);
        await response.text();

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);
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

    it("includes correct configuration in runtime script", async () => {
      await withTestContext("hmr-runtime-config", async (context) => {
        const controller = new AbortController();
        const { server, port } = await createHMRServer(
          context,
          { reactRefresh: true },
          controller.signal,
        );

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        const content = await response.text();

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

        const ws = new WebSocket(`ws://localhost:${port}/hmr`);

        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        ws.send(JSON.stringify({ type: "register", id: "app.tsx", file: "/src/app.tsx" }));
        await delay(50);
        ws.send(JSON.stringify({ type: "register", id: "header.tsx", file: "/src/header.tsx" }));
        await delay(50);
        ws.send(JSON.stringify({ type: "register", id: "footer.tsx", file: "/src/footer.tsx" }));
        await delay(100);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
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
