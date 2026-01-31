import { assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import "../../_helpers/log-guard.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { delay } from "@std/async";
import { scaleMs } from "@veryfront/testing";

describe("RSC Flight Smoke Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC Flight endpoint smoke test", {}, () => {
    it("returns 410 (removed endpoint)", async () => {
      await withTestContext("rsc-flight-smoke", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import("../../../src/server/production-server.ts");
        const { getFreePort } = await import("../../_helpers/utils.ts");

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;

        try {
          const port = await getFreePort();
          h = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
          });

          await h.ready;
          await delay(400);

          const url = `http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=Smoke`;
          const ac = new AbortController();
          const timeoutId = setTimeout(() => ac.abort(), scaleMs(3000));

          const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timeoutId));
          await res.body?.cancel();

          assertEquals(res.status, 410);
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
