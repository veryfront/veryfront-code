
import { assert, assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import { delay } from "std/async/delay.ts";
import { join as _join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { HMRServer as ModuleHMRServer } from "../../../../src/server/dev-server/hmr-server.ts";
import { ErrorOverlay } from "../../../../src/server/dev-server/error-overlay/index.ts";
import { APIServer } from "../../../../src/module-system/server/index.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

function createMockRenderer() {
  return {
    // deno-lint-ignore require-await
    renderPage: async (slug: string) => {
      if (slug === "error-page") {
        throw new Error("Render error: Page not found");
      }
      return {
        html: `<div>Content for ${slug}</div>`,
        frontmatter: { title: slug, description: `Description for ${slug}` },
        headings: [{ depth: 1, text: `Heading for ${slug}`, id: "heading-1" }],
      };
    },
  };
}

describe(
  "Server Modules - HMR Integration",
  {
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("broadcasts file changes to all connected clients", async () => {
      await withTestContext("hmr-broadcast-multiple-clients", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          reactRefresh: false,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const client1 = new WebSocket(`ws://localhost:${port}`);
        const client2 = new WebSocket(`ws://localhost:${port}`);
        const client3 = new WebSocket(`ws://localhost:${port}`);

        const messages1: any[] = [];
        const messages2: any[] = [];
        const messages3: any[] = [];

        client1.onmessage = (e) => messages1.push(JSON.parse(e.data));
        client2.onmessage = (e) => messages2.push(JSON.parse(e.data));
        client3.onmessage = (e) => messages3.push(JSON.parse(e.data));

        await Promise.all([
          new Promise((resolve) => (client1.onopen = resolve)),
          new Promise((resolve) => (client2.onopen = resolve)),
          new Promise((resolve) => (client3.onopen = resolve)),
        ]);

        await delay(200);

        hmrServer.sendUpdate({ type: "reload" });
        await delay(200);

        const reloadMsg1 = messages1.find((m) => m.type === "reload");
        const reloadMsg2 = messages2.find((m) => m.type === "reload");
        const reloadMsg3 = messages3.find((m) => m.type === "reload");

        assertExists(reloadMsg1, "Client 1 should receive reload message");
        assertExists(reloadMsg2, "Client 2 should receive reload message");
        assertExists(reloadMsg3, "Client 3 should receive reload message");

        client1.close();
        client2.close();
        client3.close();
        await delay(100);
        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("handles WebSocket connection errors gracefully", async () => {
      await withTestContext("hmr-connection-errors", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const ws = new WebSocket(`ws://localhost:${port}`);
        await new Promise((resolve) => (ws.onopen = resolve));
        await delay(100);

        assertEquals(hmrServer.getConnectionCount(), 1);

        ws.close();
        await delay(200);

        assertEquals(hmrServer.getConnectionCount(), 0);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200);
        await response.text();

        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("manages multiple clients connecting and disconnecting", async () => {
      await withTestContext("hmr-client-lifecycle", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const ws1 = new WebSocket(`ws://localhost:${port}`);
        const ws2 = new WebSocket(`ws://localhost:${port}`);
        const ws3 = new WebSocket(`ws://localhost:${port}`);

        await Promise.all([
          new Promise((resolve) => (ws1.onopen = resolve)),
          new Promise((resolve) => (ws2.onopen = resolve)),
          new Promise((resolve) => (ws3.onopen = resolve)),
        ]);
        await delay(100);

        assertEquals(hmrServer.getConnectionCount(), 3);

        ws1.close();
        await delay(100);
        assertEquals(hmrServer.getConnectionCount(), 2);

        ws2.close();
        await delay(100);
        assertEquals(hmrServer.getConnectionCount(), 1);

        ws3.close();
        await delay(100);
        assertEquals(hmrServer.getConnectionCount(), 0);

        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("broadcasts updates only to connected clients", async () => {
      await withTestContext("hmr-selective-broadcast", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const ws1 = new WebSocket(`ws://localhost:${port}`);
        const ws2 = new WebSocket(`ws://localhost:${port}`);

        const messages1: any[] = [];
        const messages2: any[] = [];

        ws1.onmessage = (e) => messages1.push(JSON.parse(e.data));
        ws2.onmessage = (e) => messages2.push(JSON.parse(e.data));

        await Promise.all([
          new Promise((resolve) => (ws1.onopen = resolve)),
          new Promise((resolve) => (ws2.onopen = resolve)),
        ]);
        await delay(200);

        ws1.close();
        await delay(200);

        hmrServer.sendUpdate({ type: "reload" });
        await delay(200);

        const reload1 = messages1.filter((m) => m.type === "reload");
        const reload2 = messages2.filter((m) => m.type === "reload");

        assertEquals(reload1.length, 0, "Closed client should not receive updates");
        assertEquals(reload2.length, 1, "Active client should receive update");

        ws2.close();
        await delay(100);
        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("serves HMR runtime script with correct configuration", async () => {
      await withTestContext("hmr-runtime-script", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          reactRefresh: true,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "application/javascript");

        const content = await response.text();
        assertStringIncludes(content, "Veryfront HMR Runtime");
        assertStringIncludes(content, `${port}`);
        assertStringIncludes(content, "WebSocket");

        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });
  },
);

describe(
  "Server Modules - Error Overlay Integration",
  {
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("generates runtime error overlay with error details", () => {
      const errorInfo = {
        type: "runtime" as const,
        error: new Error("Test runtime error"),
        file: "/src/app.tsx",
        line: 42,
        column: 10,
      };

      const html = ErrorOverlay.createHTML(errorInfo);

      assertStringIncludes(html, "Runtime Error");
      assertStringIncludes(html, "Test runtime error");
      assertStringIncludes(html, "/src/app.tsx");
      assertStringIncludes(html, "42");
      assert(html.length > 0, "HTML should be generated");
    });

    it("generates build error overlay with suggestions", () => {
      const error = new Error('Cannot find module "./missing"');
      const errorInfo = {
        type: "build" as const,
        error,
      };

      const html = ErrorOverlay.createHTML(errorInfo);

      assertStringIncludes(html, "Build Error");
      assertStringIncludes(html, "Cannot find module");

      const suggestion = ErrorOverlay.getSuggestion(error);
      assertExists(suggestion, "Should provide suggestion for module error");
      assertStringIncludes(suggestion!, "module exists");
    });

    it("provides helpful suggestions for common errors", () => {
      const testCases = [
        {
          error: new Error("Unexpected token <"),
          expectedSuggestion: "syntax errors",
        },
        {
          error: new Error("Module not found: react"),
          expectedSuggestion: "module exists",
        },
        {
          error: new Error("Invalid frontmatter syntax"),
          expectedSuggestion: "frontmatter syntax",
        },
        {
          error: new Error("Cannot use hook outside component"),
          expectedSuggestion: "hooks can only",
        },
      ];

      for (const { error, expectedSuggestion } of testCases) {
        const suggestion = ErrorOverlay.getSuggestion(error);
        assertExists(suggestion, `Should provide suggestion for: ${error.message}`);
        assertStringIncludes(
          suggestion!.toLowerCase(),
          expectedSuggestion.toLowerCase(),
          `Suggestion should mention "${expectedSuggestion}"`,
        );
      }
    });

    it("generates error overlay runtime script", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(runtime, "window.showErrorOverlay");
      assertStringIncludes(runtime, "addEventListener");
      assertStringIncludes(runtime, "error");
      assertStringIncludes(runtime, "unhandledrejection");
      assert(runtime.length > 0, "Runtime script should be generated");
    });

    it("handles errors without file information", () => {
      const errorInfo = {
        type: "runtime" as const,
        error: new Error("Generic error"),
      };

      const html = ErrorOverlay.createHTML(errorInfo);

      assertStringIncludes(html, "Runtime Error");
      assertStringIncludes(html, "Generic error");
      assert(html.length > 0, "HTML should be generated without file info");
    });
  },
);

describe(
  "Server Modules - API Server Integration",
  {
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("handles page data requests successfully", async () => {
      const renderer = createMockRenderer();
      const apiServer = new APIServer({ renderer });

      const response = await apiServer.handleRequest("/_veryfront/data/test-page.json");

      assertExists(response, "Should return response for data request");
      assertEquals(response!.status, 200);
      assertEquals(response!.headers.get("content-type"), "application/json");

      const data = await response!.json();
      assertEquals(data.slug, "test-page");
      assertEquals(data.frontmatter.title, "test-page");
      assertStringIncludes(data.html, "test-page");
    });

    it("handles API errors and returns error response", async () => {
      const renderer = createMockRenderer();
      const apiServer = new APIServer({ renderer });

      const response = await apiServer.handleRequest("/_veryfront/data/error-page.json");

      assertExists(response, "Should return error response");
      assertEquals(response!.status, 404);
      assertEquals(response!.headers.get("content-type"), "application/json");

      const data = await response!.json();
      assertExists(data.error, "Should include error message");
      assertStringIncludes(data.error, "Render error");
    });

    it("returns null for non-API routes", async () => {
      const renderer = createMockRenderer();
      const apiServer = new APIServer({ renderer });

      const response = await apiServer.handleRequest("/regular-page");

      assertEquals(response, null, "Should return null for non-API routes");
    });

    it("sets no-cache headers for data endpoints", async () => {
      const renderer = createMockRenderer();
      const apiServer = new APIServer({ renderer });

      const response = await apiServer.handleRequest("/_veryfront/data/index.json");

      assertExists(response);
      assertEquals(response!.headers.get("cache-control"), "no-cache");
    });
  },
);

describe(
  "Server Modules - Full Stack Integration",
  {
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("integrates HMR server with API server", async () => {
      await withTestContext("hmr-api-integration", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const renderer = createMockRenderer();
        const apiServer = new APIServer({ renderer });

        const hmrResponse = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(hmrResponse.status, 200);
        await hmrResponse.text();

        const apiResponse = await apiServer.handleRequest("/_veryfront/data/test.json");
        assertExists(apiResponse);
        assertEquals(apiResponse!.status, 200);

        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("handles concurrent HMR updates and API requests", async () => {
      await withTestContext("concurrent-operations", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");
        hmrServer.start();
        await delay(300);

        const renderer = createMockRenderer();
        const apiServer = new APIServer({ renderer });

        const ws1 = new WebSocket(`ws://localhost:${port}`);
        const ws2 = new WebSocket(`ws://localhost:${port}`);

        const messages1: any[] = [];
        const messages2: any[] = [];

        ws1.onmessage = (e) => messages1.push(JSON.parse(e.data));
        ws2.onmessage = (e) => messages2.push(JSON.parse(e.data));

        await Promise.all([
          new Promise((resolve) => (ws1.onopen = resolve)),
          new Promise((resolve) => (ws2.onopen = resolve)),
        ]);
        await delay(200);

        const operations = await Promise.all([
          (() => {
            hmrServer.sendUpdate({ type: "reload" });
            return "hmr-done";
          })(),
          apiServer.handleRequest("/_veryfront/data/page1.json"),
          apiServer.handleRequest("/_veryfront/data/page2.json"),
          apiServer.handleRequest("/_veryfront/data/page3.json"),
        ]);

        assertEquals(operations[0], "hmr-done");
        assertExists(operations[1]);
        assertExists(operations[2]);
        assertExists(operations[3]);

        await delay(200);
        const reload1 = messages1.filter((m) => m.type === "reload");
        const reload2 = messages2.filter((m) => m.type === "reload");

        assert(reload1.length > 0, "Client 1 should receive reload");
        assert(reload2.length > 0, "Client 2 should receive reload");

        ws1.close();
        ws2.close();
        await delay(100);
        controller.abort();
        await hmrServer.stop();
        await drainEventLoop();
      });
    });

    it("propagates API errors to error overlay", async () => {
      const renderer = createMockRenderer();
      const apiServer = new APIServer({ renderer });

      const response = await apiServer.handleRequest("/_veryfront/data/error-page.json");

      assertExists(response);
      assertEquals(response!.status, 404);

      const data = await response!.json();
      const error = new Error(data.error);

      const errorInfo = {
        type: "runtime" as const,
        error,
      };

      const html = ErrorOverlay.createHTML(errorInfo);

      assertStringIncludes(html, "Render error");
      assertStringIncludes(html, "Runtime Error");
    });

    it("handles server restart scenario", async () => {
      await withTestContext("server-restart", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller1 = new AbortController();
        const hmrServer1 = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller1.signal,
        });

        hmrServer1.start();
        await delay(300);

        const response1 = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response1.status, 200);
        await response1.text();

        controller1.abort();
        await hmrServer1.stop();
        await delay(300);

        const controller2 = new AbortController();
        const hmrServer2 = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller2.signal,
        });

        context.trackResource(hmrServer2, "HMR Server 2");
        hmrServer2.start();
        await delay(300);

        const response2 = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response2.status, 200);
        await response2.text();

        controller2.abort();
        await hmrServer2.stop();
        await drainEventLoop();
      });
    });

    it("handles graceful shutdown with active connections", async () => {
      await withTestContext("graceful-shutdown", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        hmrServer.start();
        await delay(300);

        const clients: WebSocket[] = [];
        for (let i = 0; i < 5; i++) {
          const ws = new WebSocket(`ws://localhost:${port}`);
          clients.push(ws);
        }

        await Promise.all(clients.map((ws) => new Promise((resolve) => (ws.onopen = resolve))));
        await delay(200);

        assertEquals(hmrServer.getConnectionCount(), 5);

        controller.abort();
        await hmrServer.stop();
        await delay(300);

        for (const ws of clients) {
          assertEquals(ws.readyState, WebSocket.CLOSED);
        }

        assertEquals(hmrServer.getConnectionCount(), 0);
        await drainEventLoop();
      });
    });

    it("error overlay and HMR work together", async () => {
      await withTestContext("error-overlay-hmr", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller = new AbortController();
        const hmrServer = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller.signal,
        });

        context.trackResource(hmrServer, "HMR Server");

        try {
          hmrServer.start();
          await delay(300);

          const hmrResponse = await fetch(`http://localhost:${port}/hmr-runtime.js`);
          const hmrRuntime = await hmrResponse.text();

          const errorRuntime = ErrorOverlay.getRuntime();

          assertStringIncludes(hmrRuntime, "WebSocket");
          assertStringIncludes(errorRuntime, "showErrorOverlay");

          assert(hmrRuntime.length > 0);
          assert(errorRuntime.length > 0);
        } finally {
          controller.abort();
          await hmrServer.stop();
          await delay(200);
          await drainEventLoop();
        }
      });
    });
  },
);

describe(
  "Server Modules - Error Recovery",
  {
    sanitizeResources: true,
    sanitizeOps: true,
  },
  () => {
    it("recovers from malformed API responses", async () => {
      const badRenderer = {
        renderPage: (_slug: string) => {
          return {} as any;
        },
      };

      const apiServer = new APIServer({ renderer: badRenderer });
      const response = await apiServer.handleRequest("/_veryfront/data/test.json");

      assertExists(response);
      assertEquals(response!.status, 200);

      const data = await response!.json();
      assertExists(data);
    });

    it("handles HMR server port conflicts", async () => {
      await withTestContext("port-conflict", async (context) => {
        const adapter = await getAdapter();
        const port = await context.allocatePort();

        const controller1 = new AbortController();
        const hmrServer1 = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller1.signal,
        });

        hmrServer1.start();
        await delay(300);

        const controller2 = new AbortController();
        const hmrServer2 = new ModuleHMRServer({
          port,
          projectDir: context.projectDir,
          adapter,
          signal: controller2.signal,
        });

        let errorThrown = false;
        try {
          hmrServer2.start();
          await delay(300);
        } catch (_error) {
          errorThrown = true;
        }

        const response = await fetch(`http://localhost:${port}/hmr-runtime.js`);
        assertEquals(response.status, 200);
        await response.text();

        controller1.abort();
        await hmrServer1.stop();
        if (!errorThrown) {
          controller2.abort();
          await hmrServer2.stop();
        }
        await drainEventLoop();
      });
    });
  },
);
