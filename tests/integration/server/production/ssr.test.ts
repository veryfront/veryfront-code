import { assert, assertEquals, assertMatch, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { isNotFoundError, mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { startProductionServer } from "../../../../src/server/production-server.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

function registerUnhandledRejectionGuard(): void {
  if (typeof globalThis.addEventListener !== "function") return;

  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (!(reason instanceof Error)) return;

    if (reason.message !== "boom" && reason.message !== "fail") return;

    event.preventDefault(); // Prevent test failure for intentional errors
  });
}

async function removeAppDir(projectDir: string): Promise<void> {
  try {
    await remove(join(projectDir, "app"), { recursive: true });
  } catch (e) {
    if (!isNotFoundError(e)) {
      console.warn("[TEST] cleanup: failed to remove app dir", e);
    }
  }
}

registerUnhandledRejectionGuard();

describe(
  "Production Server - SSR",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      console.log("[SSR Test] Starting cleanupBundler...");
      await cleanupBundler();
      console.log("[SSR Test] cleanupBundler complete");
    });

    it("returns 500 HTML fallback with security headers on SSR error", async () => {
      await withTestContext("production-server-500-fallback", async (context: TestContext) => {
        const dir = join(context.projectDir, "app");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(dir, "boom.tsx"),
          `export default function Page(){ throw new Error('fail'); }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/boom`);
          const ct = res.headers.get("content-type") ?? "";
          assertMatch(ct, /text\/html/i);
          await res.text();
        } finally {
          await server.stop();
        }
      });
    });

    it("renders App Router loading fallback HTML when a suspended page later errors", async () => {
      await withTestContext("production-server-app-loading-error", async (context: TestContext) => {
        await removeAppDir(context.projectDir);

        await mkdir(join(context.projectDir, "app", "a", "b"), { recursive: true });

        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Root({ children }: any){ return (<html><body><main data-router-focus>{children}</main></body></html>); }`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "a", "loading.tsx"),
          `export default function Loading(){ return <p>Loading A...</p>; }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "a", "error.tsx"),
          `export default function Error({ error }: any){ return <p>ErrA:{String(error&&error.message||error)}</p>; }`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "a", "b", "page.tsx"),
          `export default async function Page(){ await new Promise(r=>setTimeout(r, 20)); throw new Error('boom'); }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/a/b`);
          assertEquals(res.status, 200);
          assertMatch(res.headers.get("content-type") ?? "", /text\/html/i);
          const html = await res.text();
          assertStringIncludes(html, "Loading A...");
          assertStringIncludes(html, "veryfront-hydration-data");
        } finally {
          await server.stop();
        }
      });
    });

    it("renders the nearest app/error.tsx when a page throws synchronously", async () => {
      await withTestContext("production-server-app-error-boundary-ssr", async (context) => {
        await removeAppDir(context.projectDir);

        await mkdir(join(context.projectDir, "app", "a", "b"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Root({ children }: any){ return (<html><body><main data-router-focus>{children}</main></body></html>); }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "a", "error.tsx"),
          `export default function Error({ error }: any){ return <p>ErrA:{String(error&&error.message||error)}</p>; }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "a", "b", "page.tsx"),
          `export default function Page(){ throw new Error('boom'); }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          // Mark this project as local so the SSR error overlay path is active
          // (post-VULN-SRV-1/2, the overlay gates strictly on `isLocalProject`).
          localProjects: { [context.projectId]: context.projectDir },
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/a/b`);
          assertEquals(res.status, 500);
          assertMatch(res.headers.get("content-type") ?? "", /text\/html/i);
          const html = await res.text();
          assertStringIncludes(html, "ErrA:");
          assertStringIncludes(html, "boom");
          assertEquals(html.includes("Runtime Error"), false);
        } finally {
          await server.stop();
        }
      });
    });

    /**
     * Studio Navigator resolves a selected element by reading `data-node-file`
     * off the server-rendered HTML. React hydration keeps server-rendered
     * attributes, so if SSR omits them the browser bundle cannot put them back.
     *
     * Hosted preview compiles as production. Both requests below use one
     * production server and vary only the trusted Host-derived environment.
     * Preview runs first so the production assertions also detect cache leaks.
     */
    it("renders page, layout, and not-found node positions by request environment", async () => {
      await withTestContext("production-server-node-positions", async (context: TestContext) => {
        await removeAppDir(context.projectDir);

        const appDir = join(context.projectDir, "app");
        const segDir = join(appDir, "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(appDir, "layout.tsx"),
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <div id="root-layout">{children}</div>;
}
`,
        );
        await writeTextFile(
          join(appDir, "page.tsx"),
          `export default function Page() {
  return <section id="page-root">Hello from the page</section>;
}
`,
        );
        await writeTextFile(
          join(appDir, "not-found.tsx"),
          `export default function RootNotFound(){ return <p>Root Missing</p>; }`,
        );
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p id="deep-not-found">Missing B</p>; }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          defaultEnvironment: "production",
        });
        context.trackResource(server);
        await server.ready;

        try {
          for (
            const scenario of [
              { name: "preview", expectNodePositions: true },
              { name: "production", expectNodePositions: false },
            ] as const
          ) {
            const host = `${context.projectId}.${scenario.name}.localhost:${port}`;
            const pageResponse = await fetch(`http://${host}/`);
            assertEquals(pageResponse.status, 200);
            const pageHtml = await pageResponse.text();

            assertStringIncludes(pageHtml, 'id="page-root"');
            assertStringIncludes(pageHtml, 'id="root-layout"');
            assertEquals(
              pageHtml.includes('data-node-file="app/page.tsx"'),
              scenario.expectNodePositions,
              `page node positions in ${scenario.name}`,
            );
            assertEquals(
              pageHtml.includes('data-node-file="app/layout.tsx"'),
              scenario.expectNodePositions,
              `layout node positions in ${scenario.name}`,
            );

            const notFoundResponse = await fetch(`http://${host}/a/b/missing`);
            assertEquals(notFoundResponse.status, 404);
            assertMatch(notFoundResponse.headers.get("content-type") ?? "", /text\/html/i);
            const notFoundHtml = await notFoundResponse.text();
            // The id attribute only survives a real SSR render:
            // extractNotFoundText rebuilds the text as a bare <p>, so this
            // pins the assertions below to the render path.
            assertStringIncludes(notFoundHtml, 'id="deep-not-found"');
            assertStringIncludes(notFoundHtml, "Missing B");
            assertEquals(
              notFoundHtml.includes('data-node-file="app/a/b/not-found.tsx"'),
              scenario.expectNodePositions,
            );
            assertEquals(notFoundHtml.includes("Root Missing"), false);
          }
        } finally {
          await server.stop();
        }
      });
    });

    it("returns HTTP redirects from getServerData instead of rendering a 500 page", async () => {
      await withTestContext("production-server-ssr-redirects", async (context: TestContext) => {
        const pagesDir = join(context.projectDir, "pages");
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          join(pagesDir, "redirect.tsx"),
          `export function getServerData(){ return { redirect: { destination: '/login', permanent: false } }; }
           export default function Page(){ return <div>Redirect source</div>; }`,
        );
        await writeTextFile(
          join(pagesDir, "permanent.tsx"),
          `export function getServerData(){ return { redirect: { destination: '/moved', permanent: true } }; }
           export default function Page(){ return <div>Permanent redirect</div>; }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/redirect`, {
            redirect: "manual",
          });
          assertEquals(res.status, 302);
          assertEquals(res.headers.get("location"), "/login");
          assertEquals(await res.text(), "");

          const head = await fetch(`http://127.0.0.1:${port}/permanent`, {
            method: "HEAD",
            redirect: "manual",
          });
          assertEquals(head.status, 301);
          assertEquals(head.headers.get("location"), "/moved");
          assertEquals(head.body, null);
        } finally {
          await server.stop();
        }
      });
    });

    // `throw notFound()` used to reach the SSR error handler as a plain object,
    // get stringified to "[object Object]", and answer 500. The status code is
    // the whole point of the helper, so assert it over the wire.
    it("returns 404 and 302 when getServerData throws notFound() or redirect()", async () => {
      await withTestContext(
        "production-server-ssr-thrown-control",
        async (context: TestContext) => {
          const pagesDir = join(context.projectDir, "pages");
          await mkdir(pagesDir, { recursive: true });
          // `notFound()` and `redirect()` brand their result with a registered
          // symbol, so a result built by project code is recognised by the
          // framework. The fixtures rebuild that public brand rather than import
          // the helpers, which keeps the page modules dependency-free.
          const brand =
            `Object.defineProperty(result, Symbol.for("veryfront.dataControlResult"), { value: true });`;

          await writeTextFile(
            join(pagesDir, "missing.tsx"),
            `export function getServerData(){
             const result = { notFound: true };
             ${brand}
             throw result;
           }
           export default function Page(){ return <div>Should not render</div>; }`,
          );
          await writeTextFile(
            join(pagesDir, "moved.tsx"),
            `export function getServerData(){
             const result = { redirect: { destination: '/login', permanent: false } };
             ${brand}
             throw result;
           }
           export default function Page(){ return <div>Should not render</div>; }`,
          );

          const port = await context.allocatePort();
          const server = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
          });
          context.trackResource(server);
          await server.ready;

          try {
            const missing = await fetch(`http://127.0.0.1:${port}/missing`);
            assertEquals(missing.status, 404);
            const html = await missing.text();
            assertEquals(html.includes("Should not render"), false);

            const moved = await fetch(`http://127.0.0.1:${port}/moved`, { redirect: "manual" });
            assertEquals(moved.status, 302);
            assertEquals(moved.headers.get("location"), "/login");
            await moved.text();
          } finally {
            await server.stop();
          }
        },
      );
    });

    it("includes metadata (title, description) in SSR HTML", async () => {
      await withTestContext("production-server-metadata", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });
        await writeTextFile(
          join(appDir, "page.mdx"),
          `---\ntitle: Custom Title\ndescription: Custom Description\n---\n\n# Hello\n`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res.status, 200);
          const html = await res.text();
          assertStringIncludes(
            html,
            '<title data-vf-shell-head="true">Custom Title</title>',
          );
          assertMatch(html, /<meta[^>]*name="description"[^>]*content="Custom Description"/i);
        } finally {
          await server.stop();
        }
      });
    });

    it("applies generateMetadata() from App Router script page", async () => {
      await withTestContext("production-server-generate-metadata", async (context: TestContext) => {
        const metaDir = join(context.projectDir, "app", "meta");
        await mkdir(metaDir, { recursive: true });
        await writeTextFile(
          join(metaDir, "page.ts"),
          `export async function generateMetadata(){
           return { title: 'GM Title', description: 'GM Desc', meta: [{ name: 'keywords', content: 'foo,bar' }] };
         }
         export default function Page(){ return '<h1>Hi</h1>'; }`,
        );

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/meta`);
          assertEquals(res.status, 200);
          const html = await res.text();
          assertStringIncludes(
            html,
            '<title data-vf-shell-head="true">GM Title</title>',
          );
          assertMatch(html, /<meta[^>]*name="description"[^>]*content="GM Desc"/i);
          assertMatch(html, /<meta[^>]*name="keywords"[^>]*content="foo,bar"/i);
        } finally {
          await server.stop();
        }
      });
    });

    it("serves SSR with caching headers and HEAD support", async () => {
      await withTestContext("production-server-ssr-caching-head", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });
        await writeTextFile(join(appDir, "page.mdx"), `# Home SSR\n\nContent here.`);

        const port = await context.allocatePort();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res1 = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res1.status, 200);

          const cacheControl = res1.headers.get("cache-control") ?? "";
          assert(cacheControl.includes("no-cache") || cacheControl.includes("no-store"));

          const html1 = await res1.text();
          if (!/Home SSR/.test(html1)) throw new Error("SSR missing content");

          const resHead = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
          assertEquals(resHead.status, 200);
          await resHead.body?.cancel();
        } finally {
          await server.stop();
        }
      });
    });
  },
);
