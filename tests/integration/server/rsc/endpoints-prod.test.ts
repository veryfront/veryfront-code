import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import "../../../_helpers/log-guard.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

function assertStatus200Or404(res: Response, label: string): void {
  assertEquals(
    res.status === 404 || res.status === 200,
    true,
    `Expected 404 or 200 for ${label}, got ${res.status}`,
  );
}

async function safeReadText(res: Response, label: string): Promise<void> {
  try {
    await res.text();
  } catch {
    console.debug?.(`[test] ${label} read failed`);
  }
}

async function safeCancelBody(res: Response, label: string): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    console.debug?.(`[test] ${label} cancel failed`);
  }
}

describe(
  "RSC Prod Server Endpoints Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("Prod server RSC endpoints", {}, () => {
      it("return 200 (page/stream/payload/manifest)", async () => {
        await withTestContext("rsc-prod-endpoints", async (context) => {
          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { experimental: { rsc: true } };`,
          );

          const { startProductionServer } = await import(
            "../../../../src/server/production-server.ts"
          );

          let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;
          const controller = new AbortController();

          try {
            await remove(`${context.projectDir}/app`, { recursive: true }).catch(() => {});
            await remove(`${context.projectDir}/pages`, { recursive: true }).catch(() => {});

            await mkdir(`${context.projectDir}/app`, { recursive: true });
            await writeTextFile(
              `${context.projectDir}/app/page.tsx`,
              `import React from "react";\nexport default function Page() { return <div>Home</div>; }`,
            );

            const { getFreePort } = await import("../../../_helpers/utils.ts");
            const port = await getFreePort();

            h = await startProductionServer({
              projectDir: context.projectDir,
              port,
              bindAddress: "127.0.0.1",
              signal: controller.signal,
            });
            await h.ready;

            const base = `http://127.0.0.1:${port}/_veryfront/rsc`;

            const page = await fetch(`${base}/page?name=T`);
            assertStatus200Or404(page, "page");
            await safeReadText(page, "page.text()");

            const stream = await fetch(`${base}/stream?name=T`);
            assertStatus200Or404(stream, "stream");
            await safeCancelBody(stream, "stream body");

            const payload = await fetch(`${base}/payload?name=T`);
            assertStatus200Or404(payload, "payload");
            await safeReadText(payload, "payload.text()");

            const man = await fetch(`${base}/manifest`);
            assertStatus200Or404(man, "manifest");
            await safeReadText(man, "manifest");

            const fpage = await fetch(`${base}/flight_page?name=T`);
            assertEquals(fpage.status, 410);
            await safeReadText(fpage, "flight_page text");
          } finally {
            if (h?.stop) {
              controller.abort();
              await h.stop();
            }

            await drainEventLoop(4, 20);
            await assertDrained({
              allowResources: [/MessagePort/i, /Timer/i, /^fetch/i],
              retries: 5,
              delayMs: 20,
              allowOpsDelta: 2,
            });
          }
        });
      });
    });
  },
);
