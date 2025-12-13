import { assertEquals } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Universal Server - Static Files",
  {},
  () => {
    it("serves static files from public/ and exposes metrics and CORS", async () => {
      await withTestContext("universal-server-static", async (context: TestContext) => {
        await Deno.writeTextFile(`${context.projectDir}/public/hello.txt`, "hi");
        const server = await context.createProductionServer();

        const res = await fetch(`http://127.0.0.1:${server.port}/hello.txt`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(res.status, 200);
        assertEquals(await res.text(), "hi");
        if (res.headers.get("access-control-allow-origin")) {
          assertEquals(res.headers.get("access-control-allow-origin"), "http://example.com");
        }
        const etag = res.headers.get("etag");
        if (etag) {
          const notMod = await fetch(`http://127.0.0.1:${server.port}/hello.txt`, {
            headers: { "if-none-match": etag },
          });
          assertEquals(notMod.status, 304);
          await notMod.body?.cancel();
        }

        const m = await fetch(`http://127.0.0.1:${server.port}/_metrics`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(m.status, 200);
        const json = await m.json();
        if (!json || !json.counters) {
          throw new Error("missing counters in metrics");
        }
        if (m.headers.get("access-control-allow-origin")) {
          assertEquals(m.headers.get("access-control-allow-origin"), "http://example.com");
        }
      });
    });
  },
);
