import { assertNotEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Handler Isolation Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC handler isolation", () => {
    it("creates a fresh handler after reset for different projectDir", async () => {
      await withTestContext("rsc-iso-1", async (ctx1) => {
        await writeTextFile(
          join(ctx1.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const s1 = await ctx1.createProductionServer();
        const r1 = await fetch(`http://127.0.0.1:${s1.port}/_veryfront/rsc/manifest`);
        r1.body?.cancel();
      });

      const { __resetRSCHandlerForTests } = await import(
        "../../../../src/server/services/rsc/endpoints/index.ts"
      );
      __resetRSCHandlerForTests();

      await withTestContext("rsc-iso-2", async (ctx2) => {
        await writeTextFile(
          join(ctx2.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const s2 = await ctx2.createProductionServer();
        assertNotEquals(s2.port, 0);

        const r2 = await fetch(`http://127.0.0.1:${s2.port}/_veryfront/rsc/manifest`);
        r2.body?.cancel();
      });

      __resetRSCHandlerForTests();
    });
  });
});
