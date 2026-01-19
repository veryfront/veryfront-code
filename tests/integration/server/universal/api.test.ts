import { assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { mkdir, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "@std/async";

// Wrap entire test suite in a describe block with sanitizers disabled
// This is required because esbuild WASM runtime (used by API routes)
// creates internal timers that cannot be cleaned up from user code
describe(
  "Universal Server API Tests",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up renderer intervals to prevent resource leaks
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
            // Enable RSC via config instead of env var
            await writeTextFile(
              join(context.projectDir, "veryfront.config.js"),
              `export default { experimental: { rsc: true } };`,
            );

            // pages/api/hello.ts
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

            // app/api/echo/route.ts
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

            const server = await context.createProductionServer();

            // pages/api
            const a = await fetch(`http://127.0.0.1:${server.port}/api/hello`);
            const aj = await a.json();
            assertEquals(aj.msg, "pages api");

            // app route POST
            const b = await fetch(`http://127.0.0.1:${server.port}/api/echo`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ok: true }),
            });
            assertEquals(b.status, 200);
            const bj = await b.json();
            assertEquals(bj.youSent.ok, true);

            // app router SSR root (write file before fetch)
            await writeTextFile(join(context.projectDir, "app", "page.mdx"), `# Hello World`);
            // Re-issue readiness (renderer caches on first call); small delay for fs
            await delay(50);
            const p = await fetch(`http://127.0.0.1:${server.port}/`);
            assertEquals(p.status, 200);
            const html = await p.text();
            if (!/Hello World/i.test(html)) throw new Error("SSR content missing");

            // minimal RSC endpoints via universal delegator
            const m = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/manifest`);
            assertEquals(m.status, 200);
            await m.text(); // Consume body

            const hydr = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/hydrator.js`);
            assertEquals(hydr.status, 200);
            await hydr.text(); // Consume body

            const dom = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/dom.js`);
            assertEquals(dom.status, 200);
            await dom.text(); // Consume body

            const stream = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream`);
            assertEquals(stream.status, 200);
            // stream should be no-cache
            const cc = stream.headers.get("cache-control") || "";
            if (!/no-cache/i.test(cc)) {
              throw new Error(`stream missing no-cache: ${cc}`);
            }
            await stream.text(); // Consume body

            const payload = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/payload`);
            assertEquals(payload.status, 200);
            await payload.text(); // Consume body
          });
        });

        it("handles App Router params and method Allow header", async () => {
          await withTestContext(
            "universal-server-app-route-methods",
            async (context: TestContext) => {
              // Create dynamic route with GET only
              const postDir = join(context.projectDir, "app", "post", "[slug]");
              await mkdir(postDir, { recursive: true });
              await writeTextFile(
                join(postDir, "route.ts"),
                `export async function GET(_req: Request, { params }: any){ return Response.json({ slug: params.slug }); }`,
              );
              // Create route with POST only
              const adminDir = join(context.projectDir, "app", "admin");
              await mkdir(adminDir, { recursive: true });
              await writeTextFile(
                join(adminDir, "route.ts"),
                `export async function POST(_req: Request){ return new Response('ok'); }`,
              );

              // Catch-all route returns joined parts
              const docsDir = join(context.projectDir, "app", "docs", "[...parts]");
              await mkdir(docsDir, { recursive: true });
              await writeTextFile(
                join(docsDir, "route.ts"),
                `export async function GET(_req: Request, { params }: any){ return Response.json({ parts: params.parts }); }`,
              );

              // Optional catch-all route
              const optDir = join(context.projectDir, "app", "opt", "[[...rest]]");
              await mkdir(optDir, { recursive: true });
              await writeTextFile(
                join(optDir, "route.ts"),
                `export async function GET(_req: Request, { params }: any){ return Response.json({ rest: params.rest ?? '' }); }`,
              );

              const server = await context.createProductionServer();

              // Dynamic param resolves
              const g = await fetch(`http://127.0.0.1:${server.port}/post/hello`);
              const gj = await g.json();
              assertEquals(gj.slug, "hello");

              // HEAD shim for GET
              const h = await fetch(`http://127.0.0.1:${server.port}/post/hello`, {
                method: "HEAD",
              });
              assertEquals(h.status, 200);
              await h.text(); // Consume body

              // 405 and Allow header for GET on POST-only route
              const x = await fetch(`http://127.0.0.1:${server.port}/admin`);
              assertEquals(x.status, 405);
              const allow = x.headers.get("allow") || x.headers.get("Allow");
              if (!allow || !/POST/.test(allow)) {
                throw new Error(`Allow header missing POST: ${allow}`);
              }
              await x.text(); // Consume body

              // OPTIONS on POST-only route includes Allow with HEAD,OPTIONS,POST
              const opt = await fetch(`http://127.0.0.1:${server.port}/admin`, {
                method: "OPTIONS",
              });
              assertEquals(opt.status, 204);
              const a = opt.headers.get("allow") || opt.headers.get("Allow");
              if (!a || !/POST/.test(a) || !/OPTIONS/.test(a)) {
                throw new Error(`OPTIONS Allow missing: ${a}`);
              }
              await opt.text(); // Consume body

              // Catch-all params
              const d = await fetch(`http://127.0.0.1:${server.port}/docs/a/b/c`);
              const dj = await d.json();
              assertEquals(dj.parts, "a/b/c");

              // Optional catch-all: no rest
              const o = await fetch(`http://127.0.0.1:${server.port}/opt`);
              const oj = await o.json();
              assertEquals(oj.rest, "");
            },
          );
        });
      },
    );
  },
);