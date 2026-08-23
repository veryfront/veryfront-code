import { assertEquals, assertMatch } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { withInProcessProject } from "../../../_helpers/in-process-project.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Hydration Tests", () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC client.js", () => {
    it("serves canonical client javascript and removes legacy hydrator endpoint", async () => {
      await withInProcessProject("rsc-client", {
        mode: "production",
        config: { experimental: { rsc: true } },
      }, async (project) => {
        const res = await project.handle("/_veryfront/rsc/client.js");

        assertEquals(res.status, 200);
        assertMatch(res.headers.get("content-type") ?? "", /javascript/i);
        assertMatch(res.headers.get("cache-control") ?? "", /no-cache|private|max-age=0/i);

        await res.body?.cancel();

        const legacy = await project.handle("/_veryfront/rsc/hydrator.js");
        assertEquals(legacy.status, 404);
        await legacy.body?.cancel();
      });
    });
  });
});
