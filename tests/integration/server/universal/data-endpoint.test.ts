import { assert, assertEquals, assertMatch } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

// Tests the /_veryfront/data/:slug JSON endpoint

describe(
  "Universal data endpoint",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("returns JSON with ETag/304 and no-cache", async () => {
      await withTestContext("universal-data", async (context) => {
        // Create a simple page
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
        const server = await context.createProductionServer();

        const url = `http://127.0.0.1:${server.port}/_veryfront/data/index.json`;
        const r1 = await fetch(url);
        assertEquals(r1.status, 200);
        assertMatch(r1.headers.get("content-type") || "", /json/i);
        assertEquals(r1.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
        const etag = r1.headers.get("etag");
        assert(etag && etag.length > 0);
        await r1.text();

        const r2 = await fetch(url, { headers: { "if-none-match": etag! } });
        assertEquals(r2.status, 304);
        await r2.body?.cancel();
      });
    });
  },
);
