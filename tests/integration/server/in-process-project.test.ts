/**
 * The in-process harness must reach the same pipeline the servers serve, for
 * both modes, and leave nothing behind. Sanitizers stay on here on purpose:
 * a leak from the handler is a harness defect, not something to opt out of.
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { IN_PROCESS_ORIGIN, withInProcessProject } from "../../_helpers/in-process-project.ts";

const PAGE = `export default function Home() { return <h1>In-process home</h1>; }`;
const API = `export const GET = (ctx) => Response.json({ ok: true, q: ctx.query.get("q") });`;

describe("in-process project harness", () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("renders a page and answers an API route through the dev handler", async () => {
    await withInProcessProject("in-process-dev", {
      files: { "pages/index.tsx": PAGE, "pages/api/hello.ts": API },
    }, async (project) => {
      assertEquals(project.mode, "dev");

      const page = await project.handle("/");
      assertEquals(page.status, 200);
      assertStringIncludes(page.headers.get("content-type") ?? "", "text/html");
      assertStringIncludes(await page.text(), "In-process home");

      const api = await project.handle("/api/hello?q=one");
      assertEquals(api.status, 200);
      assertEquals(await api.json(), { ok: true, q: "one" });

      const health = await project.handle("/healthz");
      assertEquals(health.status, 200);
      assertEquals(await health.text(), "ok");
    });
  });

  it("serves the same project through the production handler", async () => {
    await withInProcessProject("in-process-prod", {
      mode: "production",
      files: {
        "pages/index.tsx": PAGE,
        "pages/api/hello.ts": API,
        "public/hello.txt": "static bytes",
      },
    }, async (project) => {
      const page = await project.handle("/");
      assertEquals(page.status, 200);
      assertStringIncludes(await page.text(), "In-process home");

      const api = await project.handle("/api/hello");
      assertEquals(api.status, 200);
      assertEquals(await api.json(), { ok: true, q: null });

      const asset = await project.handle("/hello.txt");
      assertEquals(asset.status, 200);
      assertEquals(await asset.text(), "static bytes");

      const health = await project.handle("/healthz");
      assertEquals(health.status, 200);
      assertEquals((await health.json()).status, "ok");
    });
  });

  it("accepts a prebuilt Request and a path with init", async () => {
    await withInProcessProject("in-process-request-forms", {
      files: {
        "pages/api/echo.ts": `export const GET = (ctx) =>
          Response.json({ method: ctx.request.method, header: ctx.request.headers.get("x-probe") });
        export const POST = (ctx) => Response.json({ method: ctx.request.method });`,
      },
    }, async (project) => {
      const viaPath = await project.handle("/api/echo", { headers: { "x-probe": "path" } });
      assertEquals(await viaPath.json(), { method: "GET", header: "path" });

      const viaRequest = await project.handle(
        new Request(`${IN_PROCESS_ORIGIN}/api/echo`, { headers: { "x-probe": "request" } }),
      );
      assertEquals(await viaRequest.json(), { method: "GET", header: "request" });

      // The whole handler chain is in the loop, not just the route: a POST with
      // no CSRF token is refused before project code runs.
      const forged = await project.handle("/api/echo", { method: "POST" });
      assertEquals(forged.status, 403);
      assertStringIncludes(await forged.text(), "CSRF");
    });
  });

  it("writes the config override and honours it", async () => {
    await withInProcessProject("in-process-config", {
      config: { title: "Overridden" },
      files: { "pages/index.tsx": PAGE },
    }, async (project) => {
      const config = await Deno.readTextFile(`${project.projectDir}/veryfront.config.js`);
      assert(config.includes(`"title": "Overridden"`));

      const page = await project.handle("/");
      assertEquals(page.status, 200);
      await page.body?.cancel();
    });
  });
});
