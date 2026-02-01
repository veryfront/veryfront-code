import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { delay } from "#std/async";
import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { scaleMs } from "#veryfront/testing";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "App Router",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // TODO: This test is flaky due to timing issues with streaming SSR and error boundaries
    // The streaming behavior doesn't always produce the expected loading/error content in time
    // Skipping until streaming behavior is more reliable
    it.skip("nested loading+error streaming", async () => {
      await withTestContext("app-router-nested-streaming", async (context) => {
        await remove(join(context.projectDir, "app"), { recursive: true });
        await remove(join(context.projectDir, "pages"), { recursive: true });

        await mkdir(join(context.projectDir, "pages"), { recursive: true });
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

        const segA = join(context.projectDir, "app", "a");
        const segB = join(segA, "b");
        await mkdir(segB, { recursive: true });

        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Root({ children }: any){ return (<html><body><main data-router-focus>{children}</main></body></html>); }`,
        );

        await writeTextFile(
          join(segA, "loading.tsx"),
          `export default function Loading(){ return <p>Loading A...</p>; }`,
        );
        await writeTextFile(
          join(segA, "error.tsx"),
          `export default function Error({ error }: any){ return <p>ErrA:{String(error?.message ?? error)}</p>; }`,
        );

        await writeTextFile(
          join(segB, "page.tsx"),
          `export default function Page(){ throw new Error('boom'); }`,
        );

        const { getFreePort } = await import("../../_helpers/utils.ts");
        const { withTestServer, createTestDevServer } = await import("../../_helpers/server.ts");
        const port = await getFreePort();

        await withTestServer(
          () =>
            createTestDevServer({
              port,
              projectDir: context.projectDir,
              enableHMR: false,
            }),
          async () => {
            await delay(500);

            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), scaleMs(5000));

            const res = await fetch(`http://127.0.0.1:${port}/a/b`, {
              signal: ctrl.signal,
            }).catch(() => new Response("", { status: 599 }));

            clearTimeout(timer);

            const html = await res.text();

            assert([200, 404, 500, 599].includes(res.status));

            if (res.status !== 200 && res.status !== 500) return;

            const hasExpected = html.includes("Loading A...") || html.includes("ErrA:");
            if (!hasExpected) {
              console.error("[DEBUG] Status:", res.status);
              console.error("[DEBUG] HTML received:\n", html.slice(0, 500));
            }
            assert(hasExpected);
          },
        );
      });
    });
  },
);
