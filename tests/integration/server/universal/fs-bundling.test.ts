import { assert, assertEquals, assertMatch } from "@veryfront/testing/assert";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { isDeno } from "../../../../src/platform/compat/runtime.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "@std/async";

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
        // Create a simple TSX file
        const file = join(context.projectDir, "components", "Widget.tsx");
        await writeTextFile(
          file,
          [
            "import React from 'https://esm.sh/react@19.1.1'",
            "export default function Widget(){ return React.createElement('div', null, 'W') }",
            "",
          ].join("\n"),
        );

        // Create development server since /_veryfront/fs/ is only available in dev mode
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
          // Build the encoded path
          const b64 = btoa(file).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
          const url = `http://127.0.0.1:${port}/_veryfront/fs/${b64}.js`;
          const res = await fetch(url, {
            headers: { origin: "https://foo.example" },
          });
          assertEquals(res.status, 200);
          const ct = res.headers.get("content-type") || "";
          assertMatch(ct, /javascript/i);
          // Should be no-cache in dev/universal
          const cc = res.headers.get("cache-control") || "";
          assertMatch(cc, /no-cache/i);
          // CORS headers present (CSP only set when security config has CSP rules)
          const allow = res.headers.get("access-control-allow-origin");
          assert(allow === "https://foo.example" || allow === "*");
          const code = await res.text();
          assert(code.includes("export"), "should output ESM code");
        } finally {
          await server.stop();
          // Give the server time to clean up
          await delay(100);
        }
      });
    });
  },
);