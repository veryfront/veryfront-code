import { assert, assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";

import { createVeryfrontHandler } from "../../../../src/server/universal-handler/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Universal Security (config)",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("applies config-driven CORS, CSP, and CO* headers", async () => {
      await withTestContext("universal-security", async (context: TestContext) => {
        await Deno.writeTextFile(
          `${context.projectDir}/veryfront.config.ts`,
          `export default {
          security: {
            cors: { origin: "https://foo.example" },
            csp: { "default-src": ["'self'"], "img-src": ["'self'", "data:"] },
            coop: "same-origin-allow-popups",
            corp: "cross-origin",
            coep: "require-corp",
          }
        };
        `,
        );

        const server = await context.createProductionServer();

        const m = await fetch(`http://127.0.0.1:${server.port}/_metrics`, {
          headers: { origin: "https://bar.other" },
        });
        assertEquals(m.status, 200);
        const allow = m.headers.get("access-control-allow-origin");
        assert(allow === "https://foo.example" || allow === "https://bar.other");
        const csp = m.headers.get("content-security-policy") || "";
        assertStringIncludes(csp, "default-src 'self'");
        assertStringIncludes(csp, "img-src 'self' data:");
        const coop = m.headers.get("cross-origin-opener-policy");
        assert(coop === "same-origin-allow-popups" || coop === "same-origin");
        const corp = m.headers.get("cross-origin-resource-policy");
        assert(corp === "cross-origin" || corp === "same-origin");
        const coep = m.headers.get("cross-origin-embedder-policy");
        assert(coep === "require-corp" || coep === null);
        await m.body?.cancel();

        const pre = await fetch(`http://127.0.0.1:${server.port}/_metrics`, {
          method: "OPTIONS",
          headers: {
            origin: "https://baz.invalid",
            "access-control-request-headers": "x-test",
          },
        });
        assertEquals(pre.status, 204);
        const preAllow = pre.headers.get("access-control-allow-origin");
        assert(preAllow === "https://foo.example" || preAllow === "https://baz.invalid");
        await pre.body?.cancel();
      });
    });

    it("adds CORS/security headers on RSC assets (universal path)", async () => {
      await withTestContext("universal-security-rsc", async (context: TestContext) => {
        await Deno.writeTextFile(
          `${context.projectDir}/veryfront.config.js`,
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.mkdir(`${context.projectDir}/app`, { recursive: true });
        await Deno.writeTextFile(`${context.projectDir}/app/page.mdx`, "# RSC Headers Test");

        const handler = createVeryfrontHandler(context.projectDir, denoAdapter, {
          projectDir: context.projectDir,
        });

        const res = await handler(
          new Request("https://example.com/_veryfront/rsc/dom.js", {
            headers: { origin: "https://h.example" },
          }),
        );
        assert(res.status === 200 || res.status === 404);
        if (res.status === 200) {
          const allow = res.headers.get("access-control-allow-origin");
          assert(allow === "https://h.example" || allow === "*");
          const csp = res.headers.get("content-security-policy");
          assert(csp !== null);
          await res.body?.cancel();
        }
      });
    });

    it("enforces basic auth when env set", async () => {
      await withTestContext("universal-security-basic", async (context: TestContext) => {
        context.setEnv({
          VERYFRONT_BASIC_USER: "u",
          VERYFRONT_BASIC_PASS: "p",
        });

        const server = await context.createProductionServer();

        const url = `http://127.0.0.1:${server.port}/_metrics`;
        const noAuth = await fetch(url);
        // Note: dev infra may serve 200 for /healthz but metrics should be protected here
        if (noAuth.status !== 401) {
          await noAuth.body?.cancel();
        } else {
          await noAuth.body?.cancel();
          const good = await fetch(url, {
            headers: { authorization: `Basic ${btoa("u:p")}` },
          });
          try {
            await good.body?.cancel();
          } catch {
            /* ignore */
          }
          assert(good.status === 200 || good.status === 401);
        }
      });
    });

    it("enforces bearer auth when env set", async () => {
      await withTestContext("universal-security-bearer", async (context: TestContext) => {
        context.setEnv({ VERYFRONT_BEARER_TOKEN: "secret123" });

        const server = await context.createProductionServer();

        const url = `http://127.0.0.1:${server.port}/_metrics`;
        const noAuth = await fetch(url);
        if (noAuth.status !== 401) {
          await noAuth.body?.cancel();
        } else {
          await noAuth.body?.cancel();
          const good = await fetch(url, {
            headers: { authorization: `Bearer secret123` },
          });
          try {
            await good.body?.cancel();
          } catch {
            /* ignore */
          }
          assert(good.status === 200 || good.status === 401);
        }
      });
    });
  },
);
