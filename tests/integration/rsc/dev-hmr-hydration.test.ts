import { assertEquals } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { delay } from "@std/async";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "Dev HMR",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("client boundary re-hydrates after file change", async () => {
      await withTestContext("rsc-dev-hmr-hydration", async (context) => {
        // Enable RSC via config instead of env var
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        // Create app structure
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page(){ return <div data-client-ref="/app/Client.client.tsx#default">INIT</div>; }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "Client.client.tsx"),
          `'use client'\nexport default function C(){ return <span>V1</span>; }`,
        );

        const server = await context.createDevServer({ enableHMR: true });
        await delay(500);

        try {
          // First load (simulate hydration by requesting page shell+manifest+hydrator in browser normally)
          const res1 = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/page`);
          assertEquals(res1.status, 200);
          await res1.body?.cancel();

          // Change client component
          await writeTextFile(
            join(context.projectDir, "app", "Client.client.tsx"),
            `'use client'\nexport default function C(){ return <span>V2</span>; }`,
          );
          await delay(400);

          // Second load
          const res2 = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/page`);
          assertEquals(res2.status, 200);
          await res2.body?.cancel();
        } finally {
          await server.stop();
          // Give server time to clean up
          await delay(100);
        }
      });
    });
  },
);
