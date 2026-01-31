import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";
import { assert } from "@veryfront/testing/assert";
import { mkdir, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "@std/async";

describe("RSC Client Modules Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC client module", {}, () => {
    it("endpoint bundles app client component", async () => {
      await withTestContext("rsc-client-module", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        let h: Awaited<ReturnType<typeof startProductionServer>> | null = null;

        try {
          await remove(join(context.projectDir, "app"), { recursive: true });
          await remove(join(context.projectDir, "pages"), { recursive: true });

          await mkdir(join(context.projectDir, "pages"), { recursive: true });
          await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

          await mkdir(join(context.projectDir, "app", "comp"), { recursive: true });
          await writeTextFile(
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

          const rel = encodeURIComponent("/comp/Widget.tsx");
          const res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/module?rel=${rel}`);
          const code = await res.text();

          assert(res.status === 200);
          assert(code.includes("export"));
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
