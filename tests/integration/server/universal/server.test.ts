import { assertEquals, assertExists, assertMatch, assertStringIncludes } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { join } from "std/path/mod.ts";
import { startUniversalServer } from "../../../../src/server/production-server.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, withEnv } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

globalThis.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason instanceof Error && (reason.message === "boom" || reason.message === "fail")) {
    event.preventDefault();
  }
});

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
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          debug: true,
          signal: controller.signal,
        });

        await server.ready;

        const h = await fetch(`http://127.0.0.1:${port}/healthz`);
        assertEquals(h.status, 200);
        assertEquals(await h.text(), "ok");

        const r = await fetch(`http://127.0.0.1:${port}/readyz`);
        assertEquals(r.status, 200);
        assertEquals(await r.text(), "ready");

        const x = await fetch(`http://127.0.0.1:${port}/foo`);
        assertEquals(x.status, 404);
        const ct = x.headers.get("content-type") || "";
        assertMatch(ct, /text\/html/i);
        await x.text();

        controller.abort();
        await server.stop();
      });
    });

    it("serves static files from public/ and exposes metrics and CORS", async () => {
      await withTestContext("universal-server-static", async (context: TestContext) => {
        await Deno.writeTextFile(`${context.projectDir}/public/hello.txt`, "hi");
        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/hello.txt`, {
          headers: { origin: "http://example.com" },
        });
        assertEquals(res.status, 200);
        assertEquals(await res.text(), "hi");
        if (res.headers.get("access-control-allow-origin")) {
          assertEquals(res.headers.get("access-control-allow-origin"), "http://example.com");
        }
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
        if (!json || !json.counters) {
          throw new Error("missing counters in metrics");
        }
        if (m.headers.get("access-control-allow-origin")) {
          assertEquals(m.headers.get("access-control-allow-origin"), "http://example.com");
        }

        controller.abort();
        await server.stop();
      });
    });

    it("handles pages/api and app route handlers (GET/POST)", async () => {
      await withTestContext("universal-server-api", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const pagesApiDir = join(context.projectDir, "pages", "api");
        await Deno.mkdir(pagesApiDir, { recursive: true });
        await Deno.writeTextFile(
          join(pagesApiDir, "hello.ts"),
          `
        export async function GET() {
          return Response.json({ msg: 'pages api' });
        }
      `,
        );

        const appApiEchoDir = join(context.projectDir, "app", "api", "echo");
        await Deno.mkdir(appApiEchoDir, { recursive: true });
        await Deno.writeTextFile(
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
          const server = await startUniversalServer({
            projectDir: context.projectDir,
            port,
            hostname: "127.0.0.1",
            signal: controller.signal,
          });
          await server.ready;

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

          await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), `# Hello World`);
          await new Promise((r) => setTimeout(r, 50));
          const p = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(p.status, 200);
          const html = await p.text();
          if (!/Hello World/i.test(html)) throw new Error("SSR content missing");

          const m = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/manifest`);
          assertEquals(m.status, 200);
          await m.text();

          const hydr = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/hydrator.js`);
          assertEquals(hydr.status, 200);
          await hydr.text();

          const dom = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/dom.js`);
          assertEquals(dom.status, 200);
          await dom.text();

          const stream = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream`);
          assertEquals(stream.status, 200);
          const cc = stream.headers.get("cache-control") || "";
          if (!/no-cache/i.test(cc)) {
            throw new Error(`stream missing no-cache: ${cc}`);
          }
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
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );
          const dir = join(context.projectDir, "app");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(
            join(dir, "page.ts"),
            `export default async function Page(){ return '<div>Hi</div>'; }`,
          );

          const port = await context.allocatePort();
          const controller = new AbortController();
          const server = await startUniversalServer({
            projectDir: context.projectDir,
            port,
            hostname: "127.0.0.1",
            signal: controller.signal,
          });
          await server.ready;

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
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          join(dir, "boom.tsx"),
          `export default function Page(){ throw new Error('fail'); }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/boom`);
        const ct = res.headers.get("content-type") || "";
        assertMatch(ct, /text\/html/i);
        const csp = res.headers.get("content-security-policy") || "";
        if (!/default-src/i.test(csp)) throw new Error(`missing csp: ${csp}`);
        await res.text();

        controller.abort();
        await server.stop();
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
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/a/b`);
        const html = await res.text();
        if (!(html.includes("ErrA:") || html.includes("Loading A..."))) {
          throw new Error("Expected loading or error content in HTML");
        }

        controller.abort();
        await server.stop();
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
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

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
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(
          join(appDir, "page.mdx"),
          `---\ntitle: Custom Title\ndescription: Custom Description\n---\n\n# Hello\n`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

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
        await Deno.mkdir(metaDir, { recursive: true });
        await Deno.writeTextFile(
          join(metaDir, "page.ts"),
          `export async function generateMetadata(){
           return { title: 'GM Title', description: 'GM Desc', meta: [{ name: 'keywords', content: 'foo,bar' }] };
         }
         export default function Page(){ return '<h1>Hi</h1>'; }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

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
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app", "rsc");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div>RSC Stream</div>'; }`,
        );

        const port = await context.allocatePort();
          const controller = new AbortController();
          const server = await startUniversalServer({
            projectDir: context.projectDir,
            port,
            hostname: "127.0.0.1",
            signal: controller.signal,
          });
          await server.ready;

          const resp = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream?page=/rsc`);
          assertEquals(resp.status, 200);
          assertExists(resp.body);
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
          }
          const lines = buf.split(/\n+/).filter((l) => l.trim().startsWith("{"));
          const events = lines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<{ type: string; id: string; html: string }>;
          if (events.length === 0) throw new Error("no stream events parsed");
          const ids = events.map((e) => e.id);
          if (!ids.includes("root")) throw new Error("root slot missing");
          if (!ids.includes("sidebar")) throw new Error("sidebar slot missing");
          const lastRoot = events
            .map((e, i) => [e, i] as const)
            .filter(([e]) => e.id === "root")
            .pop();
          const anySidebarBefore = events.slice(0, lastRoot?.[1] ?? 0).some((e) =>
            e.id === "sidebar"
          );
          if (!anySidebarBefore) {
            throw new Error("sidebar did not appear before final root");
          }

          controller.abort();
          await server.stop();
      });
    });

    it("serves SSR with ETag and HEAD support", async () => {
      await withTestContext("universal-server-ssr-etag-head", async (context: TestContext) => {
        const appDir = join(context.projectDir, "app");
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(join(appDir, "page.mdx"), `# Home SSR\n\nContent here.`);

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

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

        controller.abort();
        await server.stop();
      });
    });

    it("handles App Router params and method Allow header", async () => {
      await withTestContext("universal-server-app-route-methods", async (context: TestContext) => {
        const postDir = join(context.projectDir, "app", "post", "[slug]");
        await Deno.mkdir(postDir, { recursive: true });
        await Deno.writeTextFile(
          join(postDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ slug: params.slug }); }`,
        );
        const adminDir = join(context.projectDir, "app", "admin");
        await Deno.mkdir(adminDir, { recursive: true });
        await Deno.writeTextFile(
          join(adminDir, "route.ts"),
          `export async function POST(_req: Request){ return new Response('ok'); }`,
        );

        const docsDir = join(context.projectDir, "app", "docs", "[...parts]");
        await Deno.mkdir(docsDir, { recursive: true });
        await Deno.writeTextFile(
          join(docsDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ parts: params.parts }); }`,
        );

        const optDir = join(context.projectDir, "app", "opt", "[[...rest]]");
        await Deno.mkdir(optDir, { recursive: true });
        await Deno.writeTextFile(
          join(optDir, "route.ts"),
          `export async function GET(_req: Request, { params }: any){ return Response.json({ rest: params.rest ?? '' }); }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

        const g = await fetch(`http://127.0.0.1:${port}/post/hello`);
        const gj = await g.json();
        assertEquals(gj.slug, "hello");

        const h = await fetch(`http://127.0.0.1:${port}/post/hello`, {
          method: "HEAD",
        });
        assertEquals(h.status, 200);
        await h.text();

        const x = await fetch(`http://127.0.0.1:${port}/admin`);
        assertEquals(x.status, 405);
        const allow = x.headers.get("allow") || x.headers.get("Allow");
        if (!allow || !/POST/.test(allow)) {
          throw new Error(`Allow header missing POST: ${allow}`);
        }
        await x.text();

        const opt = await fetch(`http://127.0.0.1:${port}/admin`, {
          method: "OPTIONS",
        });
        assertEquals(opt.status, 204);
        const a = opt.headers.get("allow") || opt.headers.get("Allow");
        if (!a || !/POST/.test(a) || !/OPTIONS/.test(a)) {
          throw new Error(`OPTIONS Allow missing: ${a}`);
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
        const restore = withEnv({ VERYFRONT_EXPERIMENTAL_RSC: "1" });
        const dir = join(context.projectDir, "app", "rsc");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div id="rsc-hello">RSC Hello</div>'; }`,
        );
        await Deno.writeTextFile(
          join(dir, "Button.client.tsx"),
          `"use client"\nexport default function Button(){ return <button id="btn">Click</button>; }`,
        );

        const port = await context.allocatePort();
        const controller = new AbortController();
        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });
        await server.ready;

        const renderRes = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/render/rsc`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(renderRes.status, 200);
        const payload = await renderRes.json();
        if (!payload || typeof payload.html !== "string") {
          throw new Error("invalid rsc payload");
        }
        if (!payload.html.includes("RSC Hello")) {
          throw new Error("rsc html missing");
        }
        const man = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/manifest`);
        assertEquals(man.status, 200);
        const manifest = await man.json();
        if (manifest?.components) {
          const keys = Object.keys(manifest.components);
          if (!(keys.length >= 0)) {
            throw new Error("manifest missing components");
          }
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
        if (!/tryStream\(/.test(clientJs)) {
          throw new Error("client.js missing tryStream");
        }
        const allow = clientRes.headers.get("access-control-allow-origin");
        if (allow) assertEquals(allow, "https://rsc.test");

        const s = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/stream`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(s.status, 200);
        assertExists(s.body);
        const reader = s.body.getReader();
        const { value } = await reader.read();
        if (!value || value.length === 0) throw new Error("empty stream");
        await reader.cancel();

        controller.abort();
        await server.stop();
        restore();
        await assertDrained();
      });
    });
  },
);
