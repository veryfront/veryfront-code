import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "#std/async";
import { buildClientModuleUrl } from "../../../../src/rendering/rsc/client-module-strategy.ts";

function extractHydrationData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  assertExists(match?.[1], "expected hydration data script in HTML");
  return JSON.parse(match[1]);
}

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
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
          });

          await h.ready;

          const rel = encodeURIComponent("/comp/Widget.tsx");
          const res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/module?rel=${rel}`);
          const code = await res.text();

          assert(res.status === 200);
          assert(code.includes("export"));
          assertEquals(code.includes("<div"), false);
          assert(code.includes('from "https://esm.sh/react@19.1.1"'));
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

    it("renders production HTML with explicit fs hydration strategy for local projects", async () => {
      await withTestContext("rsc-client-page-render", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await remove(join(context.projectDir, "app"), { recursive: true });
        await remove(join(context.projectDir, "pages"), { recursive: true });

        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          [
            '"use client";',
            "export default function Page() {",
            '  return <main data-rendered="client-page">Client Page</main>;',
            "}",
            "",
          ].join("\n"),
        );

        // Start the server with the project registered as local so the RSC
        // `fs` client-module strategy and the `/_veryfront/fs/` module loader
        // are active. Post-VULN-SRV-1/2 these gate strictly on `isLocalProject`.
        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );
        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          localProjects: { [context.projectId]: context.projectDir },
        });
        context.trackResource(server);
        await server.ready;

        const baseUrl = `http://127.0.0.1:${port}`;

        const pageRes = await fetch(`${baseUrl}/`);
        assertEquals(pageRes.status, 200);
        const html = await pageRes.text();

        assertStringIncludes(html, "Client Page");
        assertEquals(html.includes("/_veryfront/fs/"), false);

        const hydrationData = extractHydrationData(html);
        assertEquals(hydrationData.clientModuleStrategy, "fs");
        assertEquals(hydrationData.pagePath, "app/page.tsx");

        const moduleUrl = buildClientModuleUrl({
          strategy: "fs",
          rel: String(hydrationData.pagePath),
        });
        assertExists(moduleUrl);

        const moduleRes = await fetch(`${baseUrl}${moduleUrl}`);
        assertEquals(moduleRes.status, 200);
        const moduleCode = await moduleRes.text();

        assertStringIncludes(moduleCode, "Client Page");
      });
    });
  });
});
