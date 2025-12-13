import { assertEquals } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { join } from "std/path/mod.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

// This is required because esbuild WASM runtime (used by API routes)
describe(
  "Universal Server API Tests",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe(
      "Universal Server - API Routes",
      {
        sanitizeResources: false,
        sanitizeOps: false,
      },
      () => {
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

          const server = await context.createProductionServer();

          const a = await fetch(`http://127.0.0.1:${server.port}/api/hello`);
          const aj = await a.json();
          assertEquals(aj.msg, "pages api");

          const b = await fetch(`http://127.0.0.1:${server.port}/api/echo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true }),
          });
          assertEquals(b.status, 200);
          const bj = await b.json();
          assertEquals(bj.youSent.ok, true);

          await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), `# Hello World`);
          await new Promise((r) => setTimeout(r, 50));
          const p = await fetch(`http://127.0.0.1:${server.port}/`);
          assertEquals(p.status, 200);
          const html = await p.text();
          if (!/Hello World/i.test(html)) throw new Error("SSR content missing");

          const m = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/manifest`);
          assertEquals(m.status, 200);
          await m.text();

          const hydr = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/hydrator.js`);
          assertEquals(hydr.status, 200);
          await hydr.text();

          const dom = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/dom.js`);
          assertEquals(dom.status, 200);
          await dom.text();

          const stream = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream`);
          assertEquals(stream.status, 200);
          const cc = stream.headers.get("cache-control") || "";
          if (!/no-cache/i.test(cc)) {
            throw new Error(`stream missing no-cache: ${cc}`);
          }
          await stream.text();

          const payload = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/payload`);
          assertEquals(payload.status, 200);
          await payload.text();
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

        const server = await context.createProductionServer();

        const g = await fetch(`http://127.0.0.1:${server.port}/post/hello`);
        const gj = await g.json();
        assertEquals(gj.slug, "hello");

        const h = await fetch(`http://127.0.0.1:${server.port}/post/hello`, {
          method: "HEAD",
        });
        assertEquals(h.status, 200);
        await h.text();

        const x = await fetch(`http://127.0.0.1:${server.port}/admin`);
        assertEquals(x.status, 405);
        const allow = x.headers.get("allow") || x.headers.get("Allow");
        if (!allow || !/POST/.test(allow)) {
          throw new Error(`Allow header missing POST: ${allow}`);
        }
        await x.text();

        const opt = await fetch(`http://127.0.0.1:${server.port}/admin`, {
          method: "OPTIONS",
        });
        assertEquals(opt.status, 204);
        const a = opt.headers.get("allow") || opt.headers.get("Allow");
        if (!a || !/POST/.test(a) || !/OPTIONS/.test(a)) {
          throw new Error(`OPTIONS Allow missing: ${a}`);
        }
        await opt.text();

        const d = await fetch(`http://127.0.0.1:${server.port}/docs/a/b/c`);
        const dj = await d.json();
        assertEquals(dj.parts, "a/b/c");

        const o = await fetch(`http://127.0.0.1:${server.port}/opt`);
        const oj = await o.json();
        assertEquals(oj.rest, "");
      });
    });
  },
);
  },
);
