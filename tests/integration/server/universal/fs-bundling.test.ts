import { delay } from "#std/async";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { assert, assertEquals, assertMatch } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../_helpers/context.ts";

// Tests the universal /_veryfront/fs/<b64>.js bundling endpoint

describe(
  "Universal FS bundling endpoint",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("bundles TSX to ESM and sets no-cache", async () => {
      await withTestContext("universal-fs-bundle", async (context) => {
        const file = join(context.projectDir, "components", "Widget.tsx");

        await writeTextFile(
          file,
          [
            "import React from 'https://esm.sh/react@19.1.1'",
            "export default function Widget(){ return React.createElement('div', null, 'W') }",
            "",
          ].join("\n"),
        );

        const port = await context.allocatePort();
        const { startUniversalServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        const server = await startUniversalServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          mode: "development",
        });

        await server.ready;

        try {
          const b64 = btoa(file)
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", "");
          const url = `http://127.0.0.1:${port}/_veryfront/fs/${b64}.js`;

          const res = await fetch(url, {
            headers: { origin: "https://foo.example" },
          });

          assertEquals(res.status, 200);

          const contentType = res.headers.get("content-type") ?? "";
          assertMatch(contentType, /javascript/i);

          const cacheControl = res.headers.get("cache-control") ?? "";
          assertMatch(cacheControl, /no-cache/i);

          const allowOrigin = res.headers.get("access-control-allow-origin");
          assert(allowOrigin === "https://foo.example" || allowOrigin === "*");

          const code = await res.text();
          assert(code.includes("export"), "should output ESM code");
        } finally {
          await server.stop();
          await delay(100);
        }
      });
    });
  },
);
