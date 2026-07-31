import { delay } from "#std/async";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../_helpers/context.ts";

// Production must not expose the development-only /_veryfront/fs transport.

describe(
  "Production FS bundling restriction",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("does not expose local TSX source through the development transport", async () => {
      await withTestContext("production-fs-bundle", async (context) => {
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
        const projectSlug = "production-fs-bundle";
        const { startProductionServer } = await import(
          "../../../../src/server/production-server.ts"
        );

        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          defaultProjectSlug: projectSlug,
          defaultProjectId: context.projectId,
          localProjects: { [projectSlug]: context.projectDir },
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

          assertEquals(res.status, 404);

          // CORS is disabled by default, so no access-control-allow-origin header
          const allowOrigin = res.headers.get("access-control-allow-origin");
          assertEquals(allowOrigin, null);

          const body = await res.text();
          assertEquals(body.includes("Widget"), false);
          assertEquals(body.includes("export default"), false);
        } finally {
          await server.stop();
          await delay(100);
        }
      });
    });
  },
);
