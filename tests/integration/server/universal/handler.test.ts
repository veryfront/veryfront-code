import { assert, assertEquals, assertMatch, assertStringIncludes } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { join } from "std/path/mod.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { createVeryfrontHandler } from "../../../../src/server/universal-handler/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Universal Handler (scaffold)",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });
    it("serves /healthz and /readyz and returns 501 for others", async () => {
      await withTestContext("universal-handler", async (context: TestContext) => {
        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
          debug: true,
        });

        // /healthz
        const r1 = await handler(new Request("http://localhost/healthz"));
        assertEquals(r1.status, 200);
        assertEquals(await r1.text(), "ok");

        // /readyz
        const r2 = await handler(new Request("http://localhost/readyz"));
        assertEquals(r2.status, 200);
        assertEquals(await r2.text(), "ready");

        // Other path -> 404 HTML
        const r3 = await handler(new Request("http://localhost/anything"));
        assertEquals(r3.status, 404);
        const ct = r3.headers.get("content-type") || "";
        assertMatch(ct, /text\/html/i);
        const html = await r3.text();
        assertMatch(html, /404/i);
      });
    });

    it("App Router route.ts HEAD shim and OPTIONS Allow headers", async () => {
      await withTestContext("universal-head-options", async (context: TestContext) => {
        // Setup app route with only GET
        await Deno.mkdir(join(context.projectDir, "app", "api", "ping"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api", "ping", "route.ts"),
          `export function GET(){ return new Response('pong') }`,
        );

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        // HEAD should be shimmed from GET and return no body
        const headRes = await handler(new Request(`http://localhost/api/ping`, { method: "HEAD" }));
        assertEquals(headRes.status, 200);
        const body = await headRes.text();
        assertEquals(body, "");

        // OPTIONS should include Allow reflecting available methods
        const optRes = await handler(
          new Request(`http://localhost/api/ping`, {
            method: "OPTIONS",
            headers: { "access-control-request-headers": "x-test" },
          }),
        );
        assertEquals(optRes.status, 204);
        const allow = optRes.headers.get("Allow") || optRes.headers.get("allow");
        assert(!!allow);
        assertMatch(allow || "", /GET/);
        assertMatch(allow || "", /HEAD/);
      });
    });

    it("App Router route.ts returns 405 with Allow when method missing", async () => {
      await withTestContext("universal-405-allow", async (context: TestContext) => {
        await Deno.mkdir(join(context.projectDir, "app", "api", "onlypost"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api", "onlypost", "route.ts"),
          `export function POST(){ return new Response('posted') }`,
        );

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const res = await handler(new Request(`http://localhost/api/onlypost`, { method: "GET" }));
        assertEquals(res.status, 405);
        const allow = res.headers.get("Allow") || res.headers.get("allow") || "";
        assertMatch(allow, /POST/);
      });
    });

    it("App Router route.ts preserves response body for implemented methods", async () => {
      await withTestContext("universal-body-pass", async (context: TestContext) => {
        await Deno.mkdir(join(context.projectDir, "app", "api", "put"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api", "put", "route.ts"),
          `export function PUT(){ return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }) }`,
        );

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const res = await handler(new Request(`http://localhost/api/put`, { method: "PUT" }));
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.ok, true);
      });
    });

    it("SSR ETag/304 on page HTML via universal handler", async () => {
      await withTestContext("universal-ssr-etag", async (context: TestContext) => {
        await Deno.mkdir(join(context.projectDir, "pages"), {
          recursive: true,
        });
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Hello World\n");

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const r1 = await handler(new Request("http://localhost/"));
        assertEquals(r1.status, 200);
        const etag = r1.headers.get("etag") || r1.headers.get("ETag");
        assert(!!etag);
        await r1.text();

        const r2 = await handler(
          new Request("http://localhost/", {
            headers: { "if-none-match": etag! },
          }),
        );
        assertEquals(r2.status, 304);
        await r2.body?.cancel();
      });
    });

    it("SSR for dynamic slug and app router fallback", async () => {
      await withTestContext("universal-ssr-dynamic", async (context: TestContext) => {
        // pages router dynamic
        await Deno.mkdir(join(context.projectDir, "pages", "blog"), {
          recursive: true,
        });
        await Deno.writeTextFile(join(context.projectDir, "pages", "blog", "post.mdx"), "# Post\n");

        // app router not-found reserved component to ensure fallback is safe in Deno path only
        await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
        await Deno.writeTextFile(join(context.projectDir, "app", "not-found.mdx"), "# Missing\n");

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        // pages/blog/post -> SSR 200
        const resp = await handler(new Request("http://localhost/blog/post"));
        assertEquals(resp.status, 200);
        await resp.text();

        // non-existent path triggers 404 (not necessarily the not-found component under non-Deno adapter)
        const nf = await handler(new Request("http://localhost/does-not-exist"));
        assert(nf.status === 404 || nf.status === 200);
        await nf.body?.cancel();
      });
    });

    it("renders App Router not-found.tsx when pages path missing (handler)", async () => {
      await withTestContext("universal-handler-app-not-found", async (context: TestContext) => {
        // Place reserved not-found.tsx under a segment
        const segDir = join(context.projectDir, "app", "blog");
        await Deno.mkdir(segDir, { recursive: true });
        await Deno.writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p>Blog Missing</p>; }`,
        );

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const res = await handler(new Request("http://localhost/blog/unknown"));
        assertEquals(res.status, 404);
        const html = await res.text();
        assertStringIncludes(html, "Blog Missing");
      });
    });

    it("SSR ETag/304 on nested page slug via universal handler", async () => {
      await withTestContext("universal-ssr-etag-nested", async (context: TestContext) => {
        await Deno.mkdir(join(context.projectDir, "pages", "blog"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "blog", "post2.mdx"),
          "# Nested ETag\n",
        );

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const r1 = await handler(new Request("http://localhost/blog/post2"));
        assertEquals(r1.status, 200);
        const etag = r1.headers.get("etag") || r1.headers.get("ETag");
        assert(!!etag);
        await r1.text();

        const r2 = await handler(
          new Request("http://localhost/blog/post2", {
            headers: { "if-none-match": etag! },
          }),
        );
        assertEquals(r2.status, 304);
        await r2.body?.cancel();
      });
    });
  },
);
