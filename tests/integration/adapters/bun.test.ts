import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { BunAdapter } from "#veryfront/platform/adapters/runtime/bun/index.ts";
import { startUniversalServer } from "../../../src/server/production-server.ts";
import { getFreePort } from "../../_helpers/utils.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";

const isBunRuntime = typeof (globalThis as any).Bun !== "undefined";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "BunAdapter",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("Basic server operations", () => {
      it(
        "should create and serve requests",
        { ignore: !isBunRuntime },
        async () => {
          const adapter = new BunAdapter();
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
            assertEquals(res.status, 200);
            assertEquals(await res.text(), "ok");
            assertEquals(hit, 1);
          } finally {
            await server.stop();
          }
        },
      );
    });

    describe("Universal server integration", () => {
      it(
        "should run with universal server",
        { ignore: !isBunRuntime },
        async () => {
          const adapter = new BunAdapter();
          const dir = await makeTempDir({ prefix: "vf_bun_universal_" });

          try {
            await mkdir(join(dir, "public"), { recursive: true });
            await writeTextFile(join(dir, "public", "hello.txt"), "hi");
            await mkdir(join(dir, "app"), { recursive: true });
            await writeTextFile(join(dir, "app", "page.mdx"), "# Home");

            const port = await getFreePort();
            const server = await startUniversalServer({
              projectDir: dir,
              port,
              bindAddress: "127.0.0.1",
              adapter,
            });
            await server.ready;

            try {
              const health = await fetch(`http://127.0.0.1:${port}/healthz`);
              assertEquals(health.status, 200);
              await health.text();

              const staticFile = await fetch(`http://127.0.0.1:${port}/hello.txt`);
              assertEquals(await staticFile.text(), "hi");

              const page = await fetch(`http://127.0.0.1:${port}/`);
              const html = await page.text();
              assert(/Home/i.test(html));
            } finally {
              await server.stop();
            }
          } finally {
            await remove(dir, { recursive: true }).catch(() => {});
          }
        },
      );

      it(
        "should work with thin server wrapper",
        { ignore: !isBunRuntime },
        async () => {
          const { startUniversalServer: startBun } = await import(
            "../../../src/server/production-server.ts"
          );
          const dir = await makeTempDir({ prefix: "vf_bun_wrap_" });

          try {
            const port = 9150 + Math.floor(Math.random() * 100);
            const handle = await startBun({
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
        },
      );
    });
  },
);
