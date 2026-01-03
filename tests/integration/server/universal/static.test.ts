import { assertEquals } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Universal Server - Static Files",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("serves static files from public/ and exposes metrics and CORS", async () => {
      await withTestContext("universal-server-static", async (context: TestContext) => {
        // create public file
        await Deno.writeTextFile(`${context.projectDir}/public/hello.txt`, "hi");
        const server = await context.createProductionServer();

        // static
        const res = await fetch(`http://127.0.0.1:${server.port}/hello.txt`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(res.status, 200);
        assertEquals(await res.text(), "hi");
        // CORS reflected
        if (res.headers.get("access-control-allow-origin")) {
          assertEquals(res.headers.get("access-control-allow-origin"), "http://example.com");
        }
        // ETag flow
        const etag = res.headers.get("etag");
        if (etag) {
          const notMod = await fetch(`http://127.0.0.1:${server.port}/hello.txt`, {
            headers: { "if-none-match": etag },
          });
          assertEquals(notMod.status, 304);
          await notMod.body?.cancel();
        }

        // metrics
        const m = await fetch(`http://127.0.0.1:${server.port}/_metrics`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(m.status, 200);
        const json = await m.json();
        if (!json || !json.counters) {
          throw new Error("missing counters in metrics");
        }
        // CORS reflected
        if (m.headers.get("access-control-allow-origin")) {
          assertEquals(m.headers.get("access-control-allow-origin"), "http://example.com");
        }
      });
    });
  },
);
