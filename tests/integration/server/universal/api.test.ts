import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "#std/async";

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  return await res.json();
}

async function assertOkText(url: string): Promise<void> {
  const res = await fetch(url);
  assertEquals(res.status, 200);
  await res.text();
}

function getAllowHeader(headers: Headers): string | null {
  return headers.get("allow") ?? headers.get("Allow");
}

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

            const server = await context.createProductionServer();
            const url = baseUrl(server.port);

            const aj = await fetchJson(`${url}/api/hello`);
            assertEquals(aj.msg, "pages api");

            const b = await fetch(`${url}/api/echo`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ok: true }),
            });
            assertEquals(b.status, 200);
            const bj = await b.json();
            assertEquals(bj.youSent.ok, true);

            await writeTextFile(join(context.projectDir, "app", "page.mdx"), `# Hello World`);
            await delay(50);

            const p = await fetch(`${url}/`);
            assertEquals(p.status, 200);
            const html = await p.text();
            if (!/Hello World/i.test(html)) throw new Error("SSR content missing");

            await assertOkText(`${url}/_veryfront/rsc/manifest`);
            await assertOkText(`${url}/_veryfront/rsc/hydrator.js`);
            await assertOkText(`${url}/_veryfront/rsc/dom.js`);

            const stream = await fetch(`${url}/_veryfront/rsc/stream`);
            assertEquals(stream.status, 200);
            const cc = stream.headers.get("cache-control") ?? "";
            if (!/no-cache/i.test(cc)) throw new Error(`stream missing no-cache: ${cc}`);
            await stream.text();

            await assertOkText(`${url}/_veryfront/rsc/payload`);
          });
        });

        it("handles App Router params and method Allow header", async () => {
          await withTestContext(
            "universal-server-app-route-methods",
            async (context: TestContext) => {
              const postDir = join(context.projectDir, "app", "post", "[slug]");
              await mkdir(postDir, { recursive: true });
              await writeTextFile(
                join(postDir, "route.ts"),
                `export async function GET(_req: Request, { params }: any){ return Response.json({ slug: params.slug }); }`,
              );

              const adminDir = join(context.projectDir, "app", "admin");
              await mkdir(adminDir, { recursive: true });
              await writeTextFile(
                join(adminDir, "route.ts"),
                `export async function POST(_req: Request){ return new Response('ok'); }`,
              );

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

              const server = await context.createProductionServer();
              const url = baseUrl(server.port);

              const gj = await fetchJson(`${url}/post/hello`);
              assertEquals(gj.slug, "hello");

              const h = await fetch(`${url}/post/hello`, { method: "HEAD" });
              assertEquals(h.status, 200);
              await h.text();

              const x = await fetch(`${url}/admin`);
              assertEquals(x.status, 405);
              const allow = getAllowHeader(x.headers);
              if (!allow || !/POST/.test(allow)) {
                throw new Error(
                  `Allow header missing POST: ${allow}`,
                );
              }
              await x.text();

              const opt = await fetch(`${url}/admin`, { method: "OPTIONS" });
              assertEquals(opt.status, 204);
              const a = getAllowHeader(opt.headers);
              if (!a || !/POST/.test(a) || !/OPTIONS/.test(a)) {
                throw new Error(
                  `OPTIONS Allow missing: ${a}`,
                );
              }
              await opt.text();

              const dj = await fetchJson(`${url}/docs/a/b/c`);
              assertEquals(dj.parts, "a/b/c");

              const oj = await fetchJson(`${url}/opt`);
              assertEquals(oj.rest, "");
            },
          );
        });
      },
    );
  },
);
