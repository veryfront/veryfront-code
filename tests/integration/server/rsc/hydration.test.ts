import { assertEquals, assertMatch } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Hydration Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC hydrator.js", () => {
    it("serves javascript and no-cache headers", async () => {
      await withTestContext("rsc-hydrator", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const server = await context.createProductionServer();
        const res = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/hydrator.js`);

        assertEquals(res.status, 200);
        assertMatch(res.headers.get("content-type") ?? "", /javascript/i);
        assertMatch(res.headers.get("cache-control") ?? "", /no-cache|private|max-age=0/i);

        await res.body?.cancel();
      });
    });
  });
});
