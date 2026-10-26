import { assertEquals, assertMatch } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import "../../../_helpers/log-guard.ts";

import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Production Server - Health Endpoints",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("reports ready without waiting for a page to render", async () => {
      // A cold first render can outlast the readiness budget, so readiness
      // must not depend on rendering a page. This page never finishes loading.
      await withTestContext("production-unrendered-page-ready", async (context) => {
        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "await new Promise(() => {});\n" +
            "export default function Page() { return <p>Never</p>; }\n",
        );

        const server = await context.createProductionServer();

        const ready = await fetch(`http://127.0.0.1:${server.port}/readyz`);
        assertEquals(ready.status, 200);
        await ready.body?.cancel();
      });
    });

    it("starts and serves health endpoints, 404 for others", async () => {
      await withTestContext("production-server", async (context) => {
        const server = await context.createProductionServer();
        const baseUrl = `http://127.0.0.1:${server.port}`;

        const health = await fetch(`${baseUrl}/healthz`);
        assertEquals(health.status, 200);
        assertEquals(await health.json(), { service: "veryfront-server", status: "ok" });

        const ready = await fetch(`${baseUrl}/readyz`);
        assertEquals(ready.status, 200);
        assertEquals(await ready.text(), "ready");

        const other = await fetch(`${baseUrl}/foo`);
        assertEquals(other.status, 404);
        assertMatch(other.headers.get("content-type") ?? "", /text\/html/i);
        await other.text();
      });
    });
  },
);
