import { assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";

const CONFIG_SOURCE = `export default { experimental: { rsc: true } };`;

const ROOT_LAYOUT_SOURCE =
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}`;

// A client page whose query is state: it reads the live router and the page
// context. `useRouter().query` and `usePageContext().query` must agree (single
// source of truth) and `isMounted` must be false in the server HTML.
const PAGE_SOURCE = `"use client";
import { useRouter, usePageContext } from "veryfront/router";

export default function Page() {
  const r = useRouter();
  const p = usePageContext();
  return (
    <main id="app">
      <span id="router-tab">router:{r.query.tab ?? "none"}</span>
      <span id="page-tab">page:{p.query.tab ?? "none"}</span>
      <span id="mounted">mounted:{String(r.isMounted)}</span>
    </main>
  );
}
`;

async function writeApp(projectDir: string): Promise<void> {
  await writeTextFile(join(projectDir, "veryfront.config.js"), CONFIG_SOURCE);
  await remove(join(projectDir, "app"), { recursive: true }).catch(() => undefined);
  await remove(join(projectDir, "pages"), { recursive: true }).catch(() => undefined);
  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeTextFile(join(projectDir, "app", "layout.tsx"), ROOT_LAYOUT_SOURCE);
  await writeTextFile(join(projectDir, "app", "page.tsx"), PAGE_SOURCE);
}

async function waitForReady(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      try {
        if (response.status === 200) return;
      } finally {
        await response.body?.cancel();
      }
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server reported not-ready via /readyz");
}

async function getHtml(port: number, path: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return await response.text();
}

describe(
  "Reactive Router Navigation (SSR in a running app)",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("renders the live query through useRouter()/usePageContext() with one source of truth", async () => {
      await withTestContext("reactive-router-ssr", async (context) => {
        await writeApp(context.projectDir);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          signal: controller.signal,
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          localProjects: { [context.projectId]: context.projectDir },
        });
        context.trackResource(server);
        await server.ready;
        await waitForReady(port);

        // The query drives the server render, and both hooks report the same
        // value — `usePageContext().query` mirrors `useRouter().query`.
        const overview = await getHtml(port, "/?tab=overview");
        assertStringIncludes(overview, "router:<!-- -->overview");
        assertStringIncludes(overview, "page:<!-- -->overview");
        // isMounted is false in the server HTML (hydration-safe).
        assertStringIncludes(overview, "mounted:<!-- -->false");

        // A different query renders a different value — it is not baked in.
        const activity = await getHtml(port, "/?tab=activity");
        assertStringIncludes(activity, "router:<!-- -->activity");
        assertStringIncludes(activity, "page:<!-- -->activity");

        // No query -> both hooks fall back to "none" consistently.
        const bare = await getHtml(port, "/");
        assertStringIncludes(bare, "router:<!-- -->none");
        assertStringIncludes(bare, "page:<!-- -->none");
      });
    });
  },
);
