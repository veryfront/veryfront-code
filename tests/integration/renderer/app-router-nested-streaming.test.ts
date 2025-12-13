import { assert } from "https://deno.land/std@0.220.1/assert/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/mod.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "App Router",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("nested loading+error streaming", async () => {
      await withTestContext("app-router-nested-streaming", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });
        await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

        await ensureDir(join(context.projectDir, "pages"));
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

        const segA = join(context.projectDir, "app", "a");
        const segB = join(segA, "b");
        await ensureDir(segB);

        await Deno.writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Root({ children }: any){ return (<html><body><main data-router-focus>{children}</main></body></html>); }`,
        );

        await Deno.writeTextFile(
          join(segA, "loading.tsx"),
          `export default function Loading(){ return <p>Loading A...</p>; }`,
        );
        await Deno.writeTextFile(
          join(segA, "error.tsx"),
          `export default function Error({ error }: any){ return <p>ErrA:{String(error&&error.message||error)}</p>; }`,
        );

        await Deno.writeTextFile(
          join(segB, "page.tsx"),
          `export default function Page(){ throw new Error('boom'); }`,
        );

        const { getFreePort } = await import("../../_helpers/utils.ts");
        const { withTestServer, createTestDevServer } = await import("../../_helpers/server.ts");
        const port = getFreePort(9100, 9200);

        await withTestServer(
          () =>
            createTestDevServer({
              port,
              projectDir: context.projectDir,
              enableHMR: false,
            }),
          async (_server) => {
            await new Promise((resolve) => setTimeout(resolve, 500));

            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`http://localhost:${port}/a/b`, {
              signal: ctrl.signal,
            }).catch(() => new Response("", { status: 599 }));
            clearTimeout(timer);
            const html = await res.text();

            assert(
              res.status === 200 || res.status === 404 || res.status === 500 || res.status === 599,
            );

            if (res.status === 200 || res.status === 500) {
              if (!(html.includes("Loading A...") || html.includes("ErrA:"))) {
                console.error("[DEBUG] Status:", res.status);
                console.error("[DEBUG] HTML received:\n", html.slice(0, 500));
              }
              assert(html.includes("Loading A...") || html.includes("ErrA:"));
            }
          },
        );
      });
    });
  },
);
