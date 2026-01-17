import { assertEquals } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd.ts";
import { join } from "@std/path";
import "../../_helpers/log-guard.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

describe("RSC Flight Smoke Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC Flight endpoint smoke test", {}, () => {
    it("returns 410 (removed endpoint)", async () => {
      await withTestContext("rsc-flight-smoke", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import("../../../src/server/production-server.ts");

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;
        try {
          const { getFreePort } = await import("../../_helpers/utils.ts");
          const port = await getFreePort();
          h = await startProductionServer({
            projectDir: context.projectDir,
            port,
            hostname: "127.0.0.1",
          });
          await h.ready;
          await new Promise((r) => setTimeout(r, 400));
          const url = `http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=Smoke`;
          const ac = new AbortController();
          const to = setTimeout(() => ac.abort(), 3000);
          const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(to));
          await res.body?.cancel();
          assertEquals(res.status, 410);
        } finally {
          if (h?.stop) {
            await h.stop();
          }
          // Give the server time to clean up
          await new Promise((resolve) => setTimeout(resolve, 500));
          // Deterministically drain and verify
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
