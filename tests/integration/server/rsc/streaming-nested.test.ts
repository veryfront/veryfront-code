import { assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import "../../../_helpers/log-guard.ts";
import { join } from "@veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { isDeno } from "../../../../src/platform/compat/runtime.ts";

describe("RSC Stream Nested Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC stream nested", {}, () => {
    it("with loading/error returns 200", async () => {
      await withTestContext("rsc-stream-nested", async (context) => {
        // Enable RSC via config instead of env var
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;
        try {
          // Remove default app directory and create pages structure
          await remove(join(context.projectDir, "app"), { recursive: true });
          await remove(join(context.projectDir, "pages"), {
            recursive: true,
          });

          await mkdir(join(context.projectDir, "pages"), {
            recursive: true,
          });
          await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

          const { getFreePort } = await import("../../../_helpers/utils.ts");
          const port = await getFreePort();
          h = await startProductionServer({
            projectDir: context.projectDir,
            port,
            hostname: "127.0.0.1",
          });
          await h.ready;

          const res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream?page=/nested`);
          assertEquals(res.status, 200);
          // Fully consume stream to ensure clean shutdown of underlying ports
          await res.text();
        } finally {
          try {
            await h?.stop?.();
          } catch {
            /* best-effort */
          }
          await drainEventLoop();
          await assertDrained({ allowResources: [/MessagePort/i] });
        }
      });
    });
  });
});
