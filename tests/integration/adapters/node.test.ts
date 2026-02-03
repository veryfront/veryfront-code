import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { NodeAdapter, nodeAdapter } from "#veryfront/platform/adapters/runtime/node/index.ts";
import { startUniversalServer } from "../../../src/server/production-server.ts";
import { getFreePort } from "../../_helpers/utils.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "NodeAdapter",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("Structure and exports", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should export NodeAdapter class and singleton", () => {
        assertExists(NodeAdapter);
        assertExists(nodeAdapter);

        assertEquals(typeof NodeAdapter, "function");
        assertEquals(NodeAdapter.name, "NodeAdapter");
        assertEquals(nodeAdapter instanceof NodeAdapter, true);
      });

      it("should have correct adapter properties", () => {
        const adapter = new NodeAdapter();

        assertEquals(adapter.name, "node");
        assertExists(adapter.fs);
        assertExists(adapter.env);
        assertExists(adapter.capabilities);
      });

      it("should have correct feature flags", () => {
        const adapter = new NodeAdapter();

        assertEquals(adapter.capabilities.websocket, true);
        assertEquals(adapter.capabilities.http2, true);
        assertEquals(adapter.capabilities.workers, true);
        assertEquals(adapter.capabilities.jsx, false);
        assertEquals(adapter.capabilities.typescript, false);
      });

      it("should implement RuntimeAdapter interface", () => {
        const adapter = new NodeAdapter();

        assertExists(adapter.name);
        assertExists(adapter.fs);
        assertExists(adapter.env);
        assertExists(adapter.capabilities);
        assertExists(adapter.serve);
      });
    });

    describe("File system adapter", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should have all required methods", () => {
        const { fs } = new NodeAdapter();

        assertExists(fs.readFile);
        assertExists(fs.writeFile);
        assertExists(fs.exists);
        assertExists(fs.readDir);
        assertExists(fs.stat);
        assertExists(fs.mkdir);
        assertExists(fs.remove);

        assertEquals(typeof fs.readFile, "function");
        assertEquals(typeof fs.writeFile, "function");
        assertEquals(typeof fs.exists, "function");
        assertEquals(typeof fs.readDir, "function");
        assertEquals(typeof fs.stat, "function");
        assertEquals(typeof fs.mkdir, "function");
        assertEquals(typeof fs.remove, "function");
      });

      it("should lazy load Node.js modules", () => {
        const { fs } = new NodeAdapter();

        assertExists(fs);
        assertEquals((fs as { fs?: unknown }).fs, undefined);
        assertEquals((fs as { path?: unknown }).path, undefined);
      });
    });

    describe("Environment adapter", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should have all required methods", () => {
        const { env } = new NodeAdapter();

        assertExists(env.get);
        assertExists(env.set);
        assertExists(env.toObject);

        assertEquals(typeof env.get, "function");
        assertEquals(typeof env.set, "function");
        assertEquals(typeof env.toObject, "function");
      });

      it("should work with mocked process object", () => {
        const g = globalThis as { process?: unknown };
        const originalProcess = g.process;

        g.process = {
          env: {
            TEST_VAR: "test_value",
            ANOTHER_VAR: "another_value",
          },
        };

        try {
          const { env } = new NodeAdapter();
          assertExists(env.get);
          assertExists(env.set);
          assertExists(env.toObject);
        } finally {
          if (originalProcess) {
            g.process = originalProcess;
          } else {
            delete g.process;
          }
        }
      });
    });

    describe("Server operations", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should have serve method with correct signature", () => {
        const adapter = new NodeAdapter();

        assertExists(adapter.serve);
        assertEquals(typeof adapter.serve, "function");

        const ctorName = adapter.serve.constructor.name;
        assert(
          ctorName === "Function" || ctorName === "AsyncFunction",
          `Expected Function or AsyncFunction, got ${ctorName}`,
        );

        // Only required parameters count towards length (options has default value)
        assertEquals(adapter.serve.length, 1);
      });

      it("should create functional server", async () => {
        const adapter = new NodeAdapter();
        let hit = 0;
        const port = await getFreePort();

        const server = await adapter.serve(
          () => {
            hit++;
            return new Response("ok");
          },
          { port, hostname: "127.0.0.1" },
        );

        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          const text = await res.text();
          assertEquals(res.status, 200);
          assertEquals(text, "ok");
          assertEquals(hit, 1);
        } finally {
          await server.stop();
        }
      });
    });

    describe("Universal server integration", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should run with universal server", async () => {
        const dir = await makeTempDir({ prefix: "vf_node_universal_" });

        try {
          await mkdir(join(dir, "public"), { recursive: true });
          await writeTextFile(join(dir, "public", "hello.txt"), "hi");
          await mkdir(join(dir, "app"), { recursive: true });
          await writeTextFile(join(dir, "app", "page.mdx"), "# Home");
          await mkdir(join(dir, "app", "api", "echo"), { recursive: true });
          await writeTextFile(
            join(dir, "app", "api", "echo", "route.ts"),
            `export async function POST(req: Request){ const d = await req.json(); return Response.json(d); }`,
          );

          const port = await getFreePort();
          const adapter = new NodeAdapter();
          const testProjectId = `test_node_${Date.now().toString(36)}`;
          const server = await startUniversalServer({
            projectDir: dir,
            port,
            bindAddress: "127.0.0.1",
            adapter,
            defaultProjectSlug: testProjectId,
            defaultProjectId: testProjectId,
          });
          await server.ready;

          try {
            const health = await fetch(`http://127.0.0.1:${port}/healthz`);
            const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
            assertEquals(health.status, 200);
            assertEquals(ready.status, 200);
            await health.body?.cancel(); // Consume response to prevent leak
            await ready.body?.cancel(); // Consume response to prevent leak

            const staticFile = await fetch(`http://127.0.0.1:${port}/hello.txt`);
            assertEquals(await staticFile.text(), "hi");

            const page = await fetch(`http://127.0.0.1:${port}/`);
            const html = await page.text();
            assert(/Home/i.test(html));

            const apiResponse = await fetch(`http://127.0.0.1:${port}/api/echo`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ok: true }),
            });
            const apiJson = await apiResponse.json().catch(() => ({}));
            assertEquals(apiJson.ok, true);

            const etag = staticFile.headers.get("etag");
            if (etag) {
              const cached = await fetch(`http://127.0.0.1:${port}/hello.txt`, {
                headers: { "if-none-match": etag },
              });
              assertEquals(cached.status, 304);
              await cached.body?.cancel();
            }
          } finally {
            await server.stop();
          }
        } finally {
          await remove(dir, { recursive: true }).catch(() => {});
        }
      });

      it("should work with thin server wrapper", async () => {
        const { startUniversalServer: startNode } = await import(
          "../../../src/server/production-server.ts"
        );
        const dir = await makeTempDir({ prefix: "vf_node_wrap_" });

        try {
          const port = 9050 + Math.floor(Math.random() * 100);
          const handle = await startNode({
            projectDir: dir,
            port,
            bindAddress: "127.0.0.1",
          });

          assertExists(handle);
          assertEquals(typeof handle.stop, "function");
          await handle.stop();
        } finally {
          await remove(dir, { recursive: true }).catch(() => {});
        }
      });
    });

    describe("Singleton instance", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should have same properties as new instance", () => {
        assertEquals(nodeAdapter.name, "node");
        assertEquals(nodeAdapter.capabilities.websocket, true);
        assertEquals(nodeAdapter.capabilities.http2, true);
        assertEquals(nodeAdapter.capabilities.workers, true);
        assertEquals(nodeAdapter.capabilities.jsx, false);
        assertEquals(nodeAdapter.capabilities.typescript, false);

        assertExists(nodeAdapter.fs);
        assertExists(nodeAdapter.env);
        assertExists(nodeAdapter.serve);
      });
    });
  },
);

function assert(condition: boolean, message?: string): asserts condition {
  if (condition) return;
  throw new Error(message ?? "Assertion failed");
}
