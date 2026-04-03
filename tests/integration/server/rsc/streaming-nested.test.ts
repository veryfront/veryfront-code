import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import "../../../_helpers/log-guard.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Stream Nested Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC stream nested", {}, () => {
    it("emits loading placeholders before final slot replacements", async () => {
      await withTestContext("rsc-stream-nested", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        const { getFreePort } = await import("../../../_helpers/utils.ts");

        let server: Awaited<ReturnType<typeof startProductionServer>> | null = null;

        try {
          await remove(join(context.projectDir, "app"), { recursive: true });
          await remove(join(context.projectDir, "pages"), { recursive: true });
          await mkdir(join(context.projectDir, "pages"), { recursive: true });
          await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

          const port = await getFreePort();
          server = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
          });
          await server.ready;

          const res = await fetch(
            `http://127.0.0.1:${port}/_veryfront/rsc/stream?name=Eve`,
          );
          assertEquals(res.status, 200);

          const slotLines = (await res.text())
            .split(/\n+/)
            .filter((line) => line.trim().startsWith("{"))
            .map((line) => {
              try {
                return JSON.parse(line) as { type: string; id: string; html: string };
              } catch {
                return null;
              }
            })
            .filter((line): line is { type: string; id: string; html: string } => line !== null)
            .filter((line) => line.type === "slot");

          assertEquals(slotLines.length, 4);
          assertEquals(slotLines[0]?.id, "root");
          assertEquals(slotLines[0]?.html, "<div>Loading Eve…</div>");
          assertEquals(slotLines[1]?.id, "sidebar");
          assertEquals(slotLines[1]?.html, '<aside data-state="loading">Sidebar loading…</aside>');
          assertEquals(slotLines[2]?.id, "root");
          assertEquals(slotLines[2]?.html, "<div>Hello Eve</div>");
          assertEquals(slotLines[3]?.id, "sidebar");
          assertEquals(slotLines[3]?.html, "<aside><ul><li>Eve ready</li></ul></aside>");
        } finally {
          try {
            await server?.stop?.();
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
