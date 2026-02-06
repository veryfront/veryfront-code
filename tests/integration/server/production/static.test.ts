import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import "../../../_helpers/log-guard.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe(
  "Production Server - Static Files",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("serves static files from public/ and exposes metrics and CORS", async () => {
      await withTestContext(
        "production-server-static",
        async (context: TestContext) => {
          await writeTextFile(`${context.projectDir}/public/hello.txt`, "hi");
          const server = await context.createProductionServer();

          const origin = "http://example.com";
          const baseUrl = `http://127.0.0.1:${server.port}`;

          const res = await fetch(`${baseUrl}/hello.txt`, {
            headers: { origin },
          });

          assertEquals(res.status, 200);
          assertEquals(await res.text(), "hi");

          const cors = res.headers.get("access-control-allow-origin");
          if (cors) assertEquals(cors, origin);

          const etag = res.headers.get("etag");
          if (etag) {
            const notMod = await fetch(`${baseUrl}/hello.txt`, {
              headers: { "if-none-match": etag },
            });
            assertEquals(notMod.status, 304);
            await notMod.body?.cancel();
          }

          const m = await fetch(`${baseUrl}/_metrics`, {
            headers: { origin },
          });

          assertEquals(m.status, 200);

          const json = await m.json();
          if (!json?.counters) throw new Error("missing counters in metrics");

          const metricsCors = m.headers.get("access-control-allow-origin");
          if (metricsCors) assertEquals(metricsCors, origin);
        },
      );
    });
  },
);
