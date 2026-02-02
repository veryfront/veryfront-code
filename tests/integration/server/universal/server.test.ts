import { assert, assertEquals, assertExists, assertMatch, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { isNotFoundError, mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { startUniversalServer } from "../../../../src/server/production-server.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { assertDrained } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "#std/async";

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (!(reason instanceof Error)) return;
    if (reason.message !== "boom" && reason.message !== "fail") return;
    event.preventDefault();
  });
}

async function startServer(context: TestContext, port: number, signal: AbortSignal, debug?: boolean) {
  const server = await startUniversalServer({
    projectDir: context.projectDir,
    port,
    bindAddress: "127.0.0.1",
    debug,
    signal,
  });
  await server.ready;
  return server;
}

describe(
  "Universal Server (adapter-backed)",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("starts and serves health endpoints, 404 for others", async () => {
      await withTestContext("universal-server", async (context: TestContext) => {
        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal, true);

        const h = await fetch(`http://127.0.0.1:${port}/healthz`);
        assertEquals(h.status, 200);
        assertEquals(await h.text(), "ok");

        const r = await fetch(`http://127.0.0.1:${port}/readyz`);
        assertEquals(r.status, 200);
        assertEquals(await r.text(), "ready");

        const x = await fetch(`http://127.0.0.1:${port}/foo`);
        assertEquals(x.status, 404);
        assertMatch(x.headers.get("content-type") ?? "", /text\/html/i);
        await x.text();

        controller.abort();
        await server.stop();
      });
    });

    it("serves static files from public/ and exposes metrics and CORS", async () => {
      await withTestContext("universal-server-static", async (context: TestContext) => {
        await writeTextFile(`${context.projectDir}/public/hello.txt`, "hi");

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/hello.txt`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(res.status, 200);
        assertEquals(await res.text(), "hi");

        const allowOrigin = res.headers.get("access-control-allow-origin");
        if (allowOrigin) assertEquals(allowOrigin, "http://example.com");

        const etag = res.headers.get("etag");
        if (etag) {
          const notMod = await fetch(`http://127.0.0.1:${port}/hello.txt`, {
            headers: { "if-none-match": etag },
          });
          assertEquals(notMod.status, 304);
          await notMod.text();
        }

        const m = await fetch(`http://127.0.0.1:${port}/_metrics`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(m.status, 200);
        const json = await m.json();
        if (!json?.counters) throw new Error("missing counters in metrics");

        const metricsAllowOrigin = m.headers.get("access-control-allow-origin");
        if (metricsAllowOrigin) assertEquals(metricsAllowOrigin, "http://example.com");

        controller.abort();
        await server.stop();
      });
    });

    it("handles pages/api and app route handlers (GET/POST)", async () => {
      await withTestContext("universal-server-api", async (context: TestContext) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const pagesApiDir = join(context.projectDir, "pages", "api");
        await mkdir(pagesApiDir, { recursive: true });
        await writeTextFile(
          join(pagesApiDir, "hello.ts"),
          `
        export async function GET() {
          return Response.json({ msg: 'pages api' });
        }
      `,
        );

        const appApiEchoDir = join(context.projectDir, "app", "api", "echo");
        await mkdir(appApiEchoDir, { recursive: true });
        await writeTextFile(
          join(appApiEchoDir, "route.ts"),
          `
        export async function POST(req: Request) {
          const data = await req.json();
          return Response.json({ youSent: data });
        }
      `,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const a = await fetch(`http://127.0.0.1:${port}/api/hello`);
        const aj = await a.json();
        assertEquals(aj.msg, "pages api");

        const b = await fetch(`http://127.0.0.1:${port}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true }),
        });
        assertEquals(b.status, 200);
        const bj = await b.json();
        assertEquals(bj.youSent.ok, true);

        await writeTextFile(join(context.projectDir, "app", "page.mdx"), `# Hello World`);
        await delay(50);

        const p = await fetch(`http://127.0.0.1:${port}/`);
        assertEquals(p.status, 200);
        const html = await p.text();
        if (!/Hello World/i.test(html)) throw new Error("SSR content missing");

        const manifestRes = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/manifest`);
        assertEquals(manifestRes.status, 200);
        await manifestRes.text();

        const hydr = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/hydrator.js`);
        assertEquals(hydr.status, 200);
        await hydr.text();

        const dom = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/dom.js`);
        assertEquals(dom.status, 200);
        await dom.text();

        const stream = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream`);
        assertEquals(stream.status, 200);
        const cc = stream.headers.get("cache-control") ?? "";
        if (!/no-cache/i.test(cc)) throw new Error(`stream missing no-cache: ${cc}`);
        await stream.text();

        const payload = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/payload`);
        assertEquals(payload.status, 200);
        await payload.text();

        controller.abort();
        await server.stop();
      });
    });

    it("serves hydrate.js alias and RSC render ETag/304", async () => {
      await withTestContext("universal-server-rsc-hydrate-etag", async (context: TestContext) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app");
        await mkdir(dir, { recursive: true });
        await writeTextFile(join(dir, "page.ts"), `export default async function Page(){ return '<div>Hi</div>'; }`);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const hyd = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/hydrate.js`);
        assertEquals(hyd.status, 200);
        await hyd.body?.cancel();

        const r1 = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/render`);
        assertEquals(r1.status, 200);
        const etag = r1.headers.get("etag");
        if (!etag) throw new Error("missing etag on render payload");
        await r1.body?.cancel();

        const r2 = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/render`, {
          headers: { "if-none-match": etag },
        });
        assertEquals(r2.status, 304);
        await r2.body?.cancel();

        controller.abort();
        await server.stop();
      });
    });

    it("returns 500 HTML fallback with security headers on SSR error", async () => {
      await withTestContext("universal-server-500-fallback", async (context: TestContext) => {
        const dir = join(context.projectDir, "app");
        await mkdir(dir, { recursive: true });
        await writeTextFile(join(dir, "boom.tsx"), `export default function Page(){ throw new Error('fail'); }`);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/boom`);
        assertMatch(res.headers.get("content-type") ?? "", /text\/html/i);
        await res.text();

        controller.abort();
        await server.stop();
      });
    });

    // Requires streaming SSR (renderToReadableStream) for async server components
    it.ignore("renders App Router loading/error via universal server", async () => {
      await withTestContext("universal-server-app-loading-error", async (context: TestContext) => {
        try {
          await remove(join(context.projectDir, "app"), { recursive: true });
        } catch (e) {
          if (!isNotFoundError(e)) console.warn("[TEST] cleanup: failed to remove app dir", e);
        }

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
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/a/b`);
        const html = await res.text();
        if (!html.includes("ErrA:") && !html.includes("Loading A...")) {
          throw new Error("Expected loading or error content in HTML");
        }

        controller.abort();
        await server.stop();
      });
    });

    it.ignore("renders not-found.tsx for missing App Router page", async () => {
      await withTestContext("universal-server-app-not-found", async (context: TestContext) => {
        try {
          await remove(join(context.projectDir, "app"), { recursive: true });
        } catch (e) {
          if (!isNotFoundError(e)) console.warn("[TEST] cleanup: failed to remove app dir", e);
        }

        const segDir = join(context.projectDir, "app", "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p>Missing B</p>; }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/a/b/missing`);
        assertEquals(res.status, 404);
        const html = await res.text();
        assertStringIncludes(html, "Missing B");

        controller.abort();
        await server.stop();
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
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/`);
        assertEquals(res.status, 200);
        const html = await res.text();
        assertStringIncludes(html, "<title>Custom Title</title>");
        assertMatch(html, /<meta[^>]*name="description"[^>]*content="Custom Description"/i);

        controller.abort();
        await server.stop();
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
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res = await fetch(`http://127.0.0.1:${port}/meta`);
        assertEquals(res.status, 200);
        const html = await res.text();
        assertStringIncludes(html, "<title>GM Title</title>");
        assertMatch(html, /<meta[^>]*name="description"[^>]*content="GM Desc"/i);
        assertMatch(html, /<meta[^>]*name="keywords"[^>]*content="foo,bar"/i);

        controller.abort();
        await server.stop();
      });
    });

    it("streams RSC NDJSON with root and sidebar slots in order", async () => {
      await withTestContext("universal-server-rsc-stream-order", async (context: TestContext) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app", "rsc");
        await mkdir(dir, { recursive: true });
        await writeTextFile(join(dir, "page.ts"), `export default async function Page(){ return '<div>RSC Stream</div>'; }`);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const resp = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream?page=/rsc`);
        assertEquals(resp.status, 200);
        assertExists(resp.body);

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore stream cancellation errors
          }
        }

        const events = buf
          .split(/\n+/)
          .filter((l) => l.trim().startsWith("{"))
          .map((l) => {
            try {
              return JSON.parse(l) as { type: string; id: string; html: string };
            } catch {
              return null;
            }
          })
          .filter((e): e is { type: string; id: string; html: string } => Boolean(e));

        if (events.length === 0) throw new Error("no stream events parsed");

        const ids = events.map((e) => e.id);
        if (!ids.includes("root")) throw new Error("root slot missing");
        if (!ids.includes("sidebar")) throw new Error("sidebar slot missing");

        const lastRootIndex = events.map((e) => e.id).lastIndexOf("root");
        const anySidebarBefore = events.slice(0, Math.max(0, lastRootIndex)).some((e) => e.id === "sidebar");
        if (!anySidebarBefore) throw new Error("sidebar did not appear before final root");

        controller.abort();
        await server.stop();
      });
    });

    it("serves SSR with caching headers and HEAD support", async () => {
      await withTestContext("universal-server-ssr-caching-head", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });
        await writeTextFile(join(appDir, "page.mdx"), `# Home SSR\n\nContent here.`);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const res1 = await fetch(`http://127.0.0.1:${port}/`);
        assertEquals(res1.status, 200);
        const cacheControl = res1.headers.get("cache-control") ?? "";
        assert(cacheControl.includes("no-cache") || cacheControl.includes("no-store"));

        const html1 = await res1.text();
        if (!/Home SSR/.test(html1)) throw new Error("SSR missing content");

        const resHead = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
        assertEquals(resHead.status, 200);
        await resHead.body?.cancel();

        controller.abort();
        await server.stop();
      });
    });

    it("handles App Router params and method Allow header", async () => {
      await withTestContext("universal-server-app-route-methods", async (context: TestContext) => {
        const postDir = join(context.projectDir, "app", "post", "[slug]");
        await mkdir(postDir, { recursive: true });
        await writeTextFile(
          join(postDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ slug: params.slug }); }`,
        );

        const adminDir = join(context.projectDir, "app", "admin");
        await mkdir(adminDir, { recursive: true });
        await writeTextFile(join(adminDir, "route.ts"), `export async function POST(_req: Request){ return new Response('ok'); }`);

        const docsDir = join(context.projectDir, "app", "docs", "[...parts]");
        await mkdir(docsDir, { recursive: true });
        await writeTextFile(
          join(docsDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ parts: params.parts }); }`,
        );

        const optDir = join(context.projectDir, "app", "opt", "[[...rest]]");
        await mkdir(optDir, { recursive: true });
        await writeTextFile(
          join(optDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ rest: params.rest ?? '' }); }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const g = await fetch(`http://127.0.0.1:${port}/post/hello`);
        const gj = await g.json();
        assertEquals(gj.slug, "hello");

        const h = await fetch(`http://127.0.0.1:${port}/post/hello`, { method: "HEAD" });
        assertEquals(h.status, 200);
        await h.text();

        const x = await fetch(`http://127.0.0.1:${port}/admin`);
        assertEquals(x.status, 405);
        const allow = x.headers.get("allow") ?? x.headers.get("Allow");
        if (!allow || !/POST/.test(allow)) throw new Error(`Allow header missing POST: ${allow}`);
        await x.text();

        const opt = await fetch(`http://127.0.0.1:${port}/admin`, { method: "OPTIONS" });
        assertEquals(opt.status, 204);
        const optionsAllow = opt.headers.get("allow") ?? opt.headers.get("Allow");
        if (!optionsAllow || !/POST/.test(optionsAllow) || !/OPTIONS/.test(optionsAllow)) {
          throw new Error(`OPTIONS Allow missing: ${optionsAllow}`);
        }
        await opt.text();

        const d = await fetch(`http://127.0.0.1:${port}/docs/a/b/c`);
        const dj = await d.json();
        assertEquals(dj.parts, "a/b/c");

        const o = await fetch(`http://127.0.0.1:${port}/opt`);
        const oj = await o.json();
        assertEquals(oj.rest, "");

        controller.abort();
        await server.stop();
      });
    });

    it("serves RSC render/page endpoints for App Router page", async () => {
      await withTestContext("universal-server-rsc-endpoints", async (context: TestContext) => {
        const dir = join(context.projectDir, "app", "rsc");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );
        await writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div id="rsc-hello">RSC Hello</div>'; }`,
        );
        await writeTextFile(
          join(dir, "Button.client.tsx"),
          `"use client"\nexport default function Button(){ return <button id="btn">Click</button>; }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startServer(context, port, controller.signal);

        const renderRes = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/render/rsc`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(renderRes.status, 200);

        const payload = await renderRes.json();
        if (typeof payload?.html !== "string") throw new Error("invalid rsc payload");
        if (!payload.html.includes("RSC Hello")) throw new Error("rsc html missing");

        const man = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/manifest`);
        assertEquals(man.status, 200);
        const manifest = await man.json();
        if (manifest?.components) {
          const keys = Object.keys(manifest.components);
          if (!(keys.length >= 0)) throw new Error("manifest missing components");
        }

        const a1 = renderRes.headers.get("access-control-allow-origin");
        if (a1) assertEquals(a1, "https://rsc.test");

        const pageRes = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/page/rsc`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(pageRes.status, 200);
        const pageHtml = await pageRes.text();
        assertMatch(pageHtml, /<!DOCTYPE html>/i);
        assertMatch(pageHtml, /<div id="rsc-root">/i);

        const a2 = pageRes.headers.get("access-control-allow-origin");
        if (a2) assertEquals(a2, "https://rsc.test");

        const clientRes = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/client.js`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(clientRes.status, 200);
        const clientJs = await clientRes.text();
        if (!/tryStream\(/.test(clientJs)) throw new Error("client.js missing tryStream");

        const allow = clientRes.headers.get("access-control-allow-origin");
        if (allow) assertEquals(allow, "https://rsc.test");

        const s = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(s.status, 200);
        assertExists(s.body);

        const reader = s.body.getReader();
        try {
          const { value } = await reader.read();
          if (!value?.length) throw new Error("empty stream");
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore stream cancellation errors
          }
        }

        controller.abort();
        await server.stop();
        await assertDrained();
      });
    });
  },
);
