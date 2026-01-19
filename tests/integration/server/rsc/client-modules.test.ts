import { join } from "@std/path";
import { afterAll, describe, it } from "@std/testing/bdd";
import "../../../_helpers/log-guard.ts";
import { assert } from "@std/assert";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Client Modules Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC client module", {}, () => {
    it("endpoint bundles app client component", async () => {
      await withTestContext("rsc-client-module", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;
        try {
          // Remove default app directory and recreate structure
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });
          await Deno.remove(join(context.projectDir, "pages"), {
            recursive: true,
          });

          await Deno.mkdir(join(context.projectDir, "pages"), {
            recursive: true,
          });
          await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
          await Deno.mkdir(join(context.projectDir, "app", "comp"), {
            recursive: true,
          });
          // Simple client component
          await Deno.writeTextFile(
            join(context.projectDir, "app", "comp", "Widget.tsx"),
            [
              "'use client'",
              "import React from 'https://esm.sh/react@19.1.1'",
              "export function Widget(){ return React.createElement('div', null, 'W') }",
              "export default Widget",
              "",
            ].join("\n"),
          );

          const { getFreePort } = await import("../../../_helpers/utils.ts");
          const port = await getFreePort();
          h = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
          });
          await h.ready;
          const res = await fetch(
            `http://127.0.0.1:${port}/_veryfront/rsc/module?rel=${
              encodeURIComponent("/comp/Widget.tsx")
            }`,
          );
          const code = await res.text();
          assert(res.status === 200);
          // Should be ESM code containing an export
          assert(code.includes("export"));
        } finally {
          if (h?.stop) {
            await h.stop();
          }
          // Give the server time to clean up
          await new Promise((resolve) => setTimeout(resolve, 500));
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
