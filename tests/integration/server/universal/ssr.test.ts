import { assertEquals, assertMatch, assertStringIncludes } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { join } from "std/path/mod.ts";
import { startUniversalServer } from "../../../../src/server/production-server.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  console.log("[SSR Test] Starting cleanupBundler...");
  await cleanupBundler();
  console.log("[SSR Test] cleanupBundler complete");
});

globalThis.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason instanceof Error && (reason.message === "boom" || reason.message === "fail")) {
    event.preventDefault();
  }
});

describe(
  "Universal Server - SSR",
  {},
  () => {
    it("returns 500 HTML fallback with security headers on SSR error", async () => {
      await withTestContext("universal-server-500-fallback", async (context: TestContext) => {
        const dir = join(context.projectDir, "app");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          join(dir, "boom.tsx"),
          `export default function Page(){ throw new Error('fail'); }`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/boom`);
          const ct = res.headers.get("content-type") || "";
          assertMatch(ct, /text\/html/i);
          const csp = res.headers.get("content-security-policy") || "";
          if (!/default-src/i.test(csp)) throw new Error(`missing csp: ${csp}`);
          await res.text();
        } finally {
          await server.stop();
        }
      });
    });

    it("renders App Router loading/error via universal server", async () => {
      await withTestContext("universal-server-app-loading-error", async (context: TestContext) => {
        try {
          await Deno.remove(join(context.projectDir, "app"), {
            recursive: true,
          });
        } catch (e) {
          console.warn("[TEST] cleanup: failed to remove app dir", e);
        }
        await Deno.mkdir(join(context.projectDir, "app", "a", "b"), {
          recursive: true,
        });

        await Deno.writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Root({ children }: any){ return (<html><body><main data-router-focus>{children}</main></body></html>); }`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "a", "loading.tsx"),
          `export default function Loading(){ return <p>Loading A...</p>; }`,
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "a", "error.tsx"),
          `export default function Error({ error }: any){ return <p>ErrA:{String(error&&error.message||error)}</p>; }`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "a", "b", "page.tsx"),
          `export default async function Page(){ await new Promise(r=>setTimeout(r, 20)); throw new Error('boom'); }`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/a/b`);
          const html = await res.text();
          if (!(html.includes("ErrA:") || html.includes("Loading A..."))) {
            throw new Error("Expected loading or error content in HTML");
          }
        } finally {
          await server.stop();
        }
      });
    });

    it("renders not-found.tsx for missing App Router page", async () => {
      await withTestContext("universal-server-app-not-found", async (context: TestContext) => {
        try {
          await Deno.remove(join(context.projectDir, "app"), {
            recursive: true,
          });
        } catch (e) {
          console.warn("[TEST] cleanup: failed to remove app dir", e);
        }
        const segDir = join(context.projectDir, "app", "a", "b");
        await Deno.mkdir(segDir, { recursive: true });
        await Deno.writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p>Missing B</p>; }`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
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
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(
          join(appDir, "page.mdx"),
          `---\ntitle: Custom Title\ndescription: Custom Description\n---\n\n# Hello\n`,
        );

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
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
        await Deno.mkdir(metaDir, { recursive: true });
        await Deno.writeTextFile(
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
          hostname: "127.0.0.1",
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

    it("serves SSR with ETag and HEAD support", async () => {
      await withTestContext("universal-server-ssr-etag-head", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(join(appDir, "page.mdx"), `# Home SSR\n\nContent here.`);

        const port = await context.allocatePort();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
        });
        context.trackResource(server);
        await server.ready;

        try {
          const res1 = await fetch(`http://127.0.0.1:${port}/`);
          const etag = res1.headers.get("etag");
          if (!etag) throw new Error("missing etag on GET");
          const html1 = await res1.text();
          if (!/Home SSR/.test(html1)) throw new Error("SSR missing content");

          const resHead = await fetch(`http://127.0.0.1:${port}/`, {
            method: "HEAD",
          });
          if (resHead.status !== 200) {
            throw new Error(`HEAD bad status ${resHead.status}`);
          }
          if (resHead.headers.get("etag") !== etag) {
            throw new Error("HEAD etag mismatch");
          }

          const res304 = await fetch(`http://127.0.0.1:${port}/`, {
            headers: { "if-none-match": etag },
          });
          if (res304.status !== 304) {
            throw new Error(`expected 304 got ${res304.status}`);
          }
          await res304.body?.cancel();
        } finally {
          await server.stop();
        }
      });
    });
  },
);
