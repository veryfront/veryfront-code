import { assertEquals, assertMatch } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Universal Server - Health Endpoints",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("starts and serves health endpoints, 404 for others", async () => {
      await withTestContext("universal-server", async (context: TestContext) => {
        const server = await context.createProductionServer();

        // /healthz
        const h = await fetch(`http://127.0.0.1:${server.port}/healthz`);
        assertEquals(h.status, 200);
        assertEquals(await h.text(), "ok");

        // /readyz
        const r = await fetch(`http://127.0.0.1:${server.port}/readyz`);
        assertEquals(r.status, 200);
        assertEquals(await r.text(), "ready");

        // Other -> 404 HTML
        const x = await fetch(`http://127.0.0.1:${server.port}/foo`);
        assertEquals(x.status, 404);
        const ct = x.headers.get("content-type") || "";
        assertMatch(ct, /text\/html/i);
        await x.text();
      });
    });
  },
);
