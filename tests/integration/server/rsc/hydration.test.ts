import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

// Clean up renderer intervals to prevent resource leaks
afterAll(async () => {
  await cleanupBundler();
});

// Verify /_veryfront/rsc/hydrator.js serves JS with no-cache headers in dev/prod path

describe("RSC hydrator.js", () => {
  it("serves javascript and no-cache headers", async () => {
    await withTestContext("rsc-hydrator", async (context) => {
      // Enable RSC via config instead of env var
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      const server = await context.createProductionServer();
      const res = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/hydrator.js`);
      assertEquals(res.status, 200);
      assertMatch(res.headers.get("content-type") || "", /javascript/i);
      assertMatch(res.headers.get("cache-control") || "", /no-cache|private|max-age=0/i);
      await res.body?.cancel();
    });
  });
});
