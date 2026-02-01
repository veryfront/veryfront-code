import { delay } from "#std/async";
import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import "../../../_helpers/log-guard.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Flight Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("Flight endpoint", {}, () => {
    it("removed: returns 410", async () => {
      await withTestContext("rsc-flight-501", async (context) => {
        context.setEnv({ VERYFRONT_EXPERIMENTAL_RSC: "1" });

        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );
        const { getFreePort } = await import("../../../_helpers/utils.ts");

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;

        try {
          await remove(`${context.projectDir}/app`, { recursive: true });
          await writeTextFile(`${context.projectDir}/pages/index.mdx`, "# Home");

          const port = await getFreePort();
          h = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
          });

          await h.ready;
          await delay(200);

          const res = await fetch(
            `http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=Neo`,
          );
          assertEquals(res.status, 410);
          await res.text().catch((e) =>
            console.debug?.("[test] flight_page text read failed", e)
          );
        } finally {
          await h?.stop?.();

          await delay(500);
          await drainEventLoop(10, 50);
          await assertDrained({
            allowResources: [/MessagePort/i, /Timer/i, /^fetch/i],
            retries: 20,
            delayMs: 50,
            allowOpsDelta: 2,
          });
        }
      });
    });
  });
});
