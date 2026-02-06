import { assert, assertEquals, assertMatch } from "#veryfront/testing/assert";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Production data endpoint",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("returns JSON with ETag/304 and no-cache", async () => {
      await withTestContext("production-data", async (context) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
        const server = await context.createProductionServer();

        const url = `http://127.0.0.1:${server.port}/_veryfront/data/index.json`;

        const r1 = await fetch(url);
        assertEquals(r1.status, 200);
        assertMatch(r1.headers.get("content-type") ?? "", /json/i);
        assertEquals(r1.headers.get("cache-control"), "no-cache, no-store, must-revalidate");

        const etag = r1.headers.get("etag");
        assert(etag?.length);
        await r1.text();

        const r2 = await fetch(url, { headers: { "if-none-match": etag! } });
        assertEquals(r2.status, 304);
        await r2.body?.cancel();
      });
    });
  },
);
