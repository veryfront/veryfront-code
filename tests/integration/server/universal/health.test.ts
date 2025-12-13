import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Universal Server - Health Endpoints",
  {},
  () => {
    it("starts and serves health endpoints, 404 for others", async () => {
      await withTestContext("universal-server", async (context: TestContext) => {
        const server = await context.createProductionServer();

        const h = await fetch(`http://127.0.0.1:${server.port}/healthz`);
        assertEquals(h.status, 200);
        assertEquals(await h.text(), "ok");

        const r = await fetch(`http://127.0.0.1:${server.port}/readyz`);
        assertEquals(r.status, 200);
        assertEquals(await r.text(), "ready");

        const x = await fetch(`http://127.0.0.1:${server.port}/foo`);
        assertEquals(x.status, 404);
        const ct = x.headers.get("content-type") || "";
        assertMatch(ct, /text\/html/i);
        await x.text();
      });
    });
  },
);
