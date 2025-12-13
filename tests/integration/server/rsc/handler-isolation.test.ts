import { assertNotEquals } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});


describe("RSC handler isolation", () => {
  it("creates a fresh handler after reset for different projectDir", async () => {
    await withTestContext("rsc-iso-1", async (ctx1) => {
      await Deno.writeTextFile(
        join(ctx1.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      const s1 = await ctx1.createProductionServer();
      await fetch(`http://127.0.0.1:${s1.port}/_veryfront/rsc/manifest`).then((r) =>
        r.body?.cancel()
      );
    });
    const { __resetRSCHandlerForTests } = await import("../../../../src/server/handlers/request/rsc/endpoints/index.ts");
    __resetRSCHandlerForTests();

    await withTestContext("rsc-iso-2", async (ctx2) => {
      await Deno.writeTextFile(
        join(ctx2.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      const s2 = await ctx2.createProductionServer();
      assertNotEquals(s2.port, 0);
      await fetch(`http://127.0.0.1:${s2.port}/_veryfront/rsc/manifest`).then((r) =>
        r.body?.cancel()
      );
    });

    __resetRSCHandlerForTests();
  });
});
