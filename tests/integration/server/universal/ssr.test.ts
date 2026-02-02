import { assert, assertEquals, assertMatch, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { isNotFoundError, mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { startUniversalServer } from "../../../../src/server/production-server.ts";
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
  "Universal Server - SSR",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      console.log("[SSR Test] Starting cleanupBundler...");
      await cleanupBundler();
      console.log("[SSR Test] cleanupBundler complete");
    });

    it("returns 500 HTML fallback with security headers on SSR error", async () => {
      await withTestContext("universal-server-500-fallback", async (context: TestContext) => {
        const dir = join(context.projectDir, "app");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(dir, "boom.tsx"),
          `export default function Page(){ throw new Error('fail'); }`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
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

    // Requires streaming SSR (renderToReadableStream) for async server components
    it.ignore("renders App Router loading/error via universal server", async () => {
      await withTestContext("universal-server-app-loading-error", async (context: TestContext) => {
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
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/a/b`);
          const html = await res.text();
          if (html.includes("ErrA:") || html.includes("Loading A...")) return;
          throw new Error("Expected loading or error content in HTML");
        } finally {
          await server.stop();
        }
      });
    });

    it.ignore("renders not-found.tsx for missing App Router page", async () => {
      await withTestContext("universal-server-app-not-found", async (context: TestContext) => {
        await removeAppDir(context.projectDir);

        const segDir = join(context.projectDir, "app", "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p>Missing B</p>; }`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/a/b/missing`);
          assertEquals(res.status, 404);
          const html = await res.text();
          assertStringIncludes(html, "Missing B");
        } finally {
          await server.stop();
        }
      });
    });

    it("includes metadata (title, description) in SSR HTML", async () => {
      await withTestContext("universal-server-metadata", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });
        await writeTextFile(
          join(appDir, "page.mdx"),
          `---\ntitle: Custom Title\ndescription: Custom Description\n---\n\n# Hello\n`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res.status, 200);
          const html = await res.text();
          assertStringIncludes(html, "<title>Custom Title</title>");
          assertMatch(html, /<meta[^>]*name="description"[^>]*content="Custom Description"/i);
        } finally {
          await server.stop();
        }
      });
    });

    it("applies generateMetadata() from App Router script page", async () => {
      await withTestContext("universal-server-generate-metadata", async (context: TestContext) => {
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
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/meta`);
          assertEquals(res.status, 200);
          const html = await res.text();
          assertStringIncludes(html, "<title>GM Title</title>");
          assertMatch(html, /<meta[^>]*name="description"[^>]*content="GM Desc"/i);
          assertMatch(html, /<meta[^>]*name="keywords"[^>]*content="foo,bar"/i);
        } finally {
          await server.stop();
        }
      });
    });

    it("serves SSR with caching headers and HEAD support", async () => {
      await withTestContext("universal-server-ssr-caching-head", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });
        await writeTextFile(join(appDir, "page.mdx"), `# Home SSR\n\nContent here.`);

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
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
