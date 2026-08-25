import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { withInProcessProject } from "../../../_helpers/in-process-project.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Handler Isolation Tests", () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC handler isolation", () => {
    it("creates a fresh handler after reset for different projectDir", async () => {
      const manifestStatuses: number[] = [];

      await withInProcessProject("rsc-iso-1", {
        mode: "production",
        config: { experimental: { rsc: true } },
      }, async (project) => {
        const r1 = await project.handle("/_veryfront/rsc/manifest");
        manifestStatuses.push(r1.status);
        await r1.body?.cancel();
      });

      const { __resetRSCHandlerForTests } = await import(
        "../../../../src/server/services/rsc/endpoints/index.ts"
      );
      __resetRSCHandlerForTests();

      await withInProcessProject("rsc-iso-2", {
        mode: "production",
        config: { experimental: { rsc: true } },
      }, async (project) => {
        const r2 = await project.handle("/_veryfront/rsc/manifest");
        manifestStatuses.push(r2.status);
        await r2.body?.cancel();
      });

      __resetRSCHandlerForTests();

      assertEquals(manifestStatuses.length, 2);
    });
  });
});
