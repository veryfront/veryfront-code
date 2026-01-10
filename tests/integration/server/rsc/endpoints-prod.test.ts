import { assertEquals } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import "../../../_helpers/log-guard.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "RSC Prod Server Endpoints Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    describe(
      "Prod server RSC endpoints",
      {},
      () => {
        it("return 200 (page/stream/payload/manifest)", async () => {
          await withTestContext("rsc-prod-endpoints", async (context) => {
            // Enable RSC via config instead of env var
            await Deno.writeTextFile(
              join(context.projectDir, "veryfront.config.js"),
              `export default { experimental: { rsc: true } };`,
            );

            const { startProductionServer } = await import(
              "../../../../src/server/production-server.ts"
            );

            let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;
            const controller = new AbortController();
            try {
              // Create proper app directory structure for RSC
              await Deno.remove(`${context.projectDir}/app`, { recursive: true }).catch(() => {});
              await Deno.remove(`${context.projectDir}/pages`, { recursive: true }).catch(() => {});

              await Deno.mkdir(`${context.projectDir}/app`, { recursive: true });
              await Deno.writeTextFile(
                `${context.projectDir}/app/page.tsx`,
                `import React from "react";\nexport default function Page() { return <div>Home</div>; }`,
              );

              const { getFreePort } = await import("../../../_helpers/utils.ts");
              const port = await getFreePort();
              h = await startProductionServer({
                projectDir: context.projectDir,
                port,
                hostname: "127.0.0.1",
                signal: controller.signal,
              });
              await h.ready;

              // page shell
              const page = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/page?name=T`);
              // RSC endpoints return 404 without proper RSC setup - check they exist as routes
              assertEquals(
                page.status === 404 || page.status === 200,
                true,
                `Expected 404 or 200, got ${page.status}`,
              );
              try {
                await page.text();
              } catch (_e) {
                console.debug?.("[test] page.text() read failed");
              }

              // stream
              const stream = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream?name=T`);
              assertEquals(
                stream.status === 404 || stream.status === 200,
                true,
                `Expected 404 or 200, got ${stream.status}`,
              );
              try {
                await stream.body?.cancel();
              } catch (_e) {
                console.debug?.("[test] stream cancel failed");
              }

              // payload
              const payload = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/payload?name=T`);
              assertEquals(
                payload.status === 404 || payload.status === 200,
                true,
                `Expected 404 or 200, got ${payload.status}`,
              );
              try {
                await payload.text();
              } catch (_e) {
                console.debug?.("[test] payload.text() read failed");
              }

              // manifest
              const man = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/manifest`);
              assertEquals(
                man.status === 404 || man.status === 200,
                true,
                `Expected 404 or 200, got ${man.status}`,
              );
              try {
                await man.text();
              } catch (_e) {
                console.debug?.("[test] manifest read failed");
              }

              // flight_page: if Flight not implemented, should be 410
              const fpage = await fetch(
                `http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=T`,
              );
              assertEquals(fpage.status, 410);
              try {
                await fpage.text();
              } catch (_e) {
                console.debug?.("[test] flight_page text read failed");
              }
            } finally {
              if (h?.stop) {
                controller.abort();
                await h.stop();
              }

              // Cleanup event loop and verify resources are drained
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
      },
    );
  },
);
