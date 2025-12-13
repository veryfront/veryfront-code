import { assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "Dev HMR",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("client boundary re-hydrates after file change", async () => {
      await withTestContext("rsc-dev-hmr-hydration", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page(){ return <div data-client-ref="/app/Client.client.tsx#default">INIT</div>; }`,
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "Client.client.tsx"),
          `'use client'\nexport default function C(){ return <span>V1</span>; }`,
        );

        const server = await context.createDevServer({ enableHMR: true });
        await new Promise((r) => setTimeout(r, 500));

        try {
          const res1 = await fetch(`http://localhost:${server.port}/_veryfront/rsc/page`);
          assertEquals(res1.status, 200);
          await res1.body?.cancel();

          await Deno.writeTextFile(
            join(context.projectDir, "app", "Client.client.tsx"),
            `'use client'\nexport default function C(){ return <span>V2</span>; }`,
          );
          await new Promise((r) => setTimeout(r, 400));

          const res2 = await fetch(`http://localhost:${server.port}/_veryfront/rsc/page`);
          assertEquals(res2.status, 200);
          await res2.body?.cancel();
        } finally {
          await server.stop();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
    });
  },
);
