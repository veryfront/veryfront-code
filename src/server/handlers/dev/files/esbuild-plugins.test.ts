import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createBareExternalPlugin, createHttpExternalPlugin } from "./esbuild-plugins.ts";

async function bundleWithPlugin(
  contents: string,
  importMapImports: Record<string, string>,
): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents,
      loader: "js",
      sourcefile: "/project/app/page.js",
      resolveDir: "/project/app",
    },
    plugins: [createBareExternalPlugin({ importMapImports }), createHttpExternalPlugin()],
  });

  return result.outputFiles?.[0]?.text ?? "";
}

describe(
  "server/handlers/dev/files/esbuild-plugins",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterEach(async () => {
      const esbuild = await import("esbuild");
      await esbuild.stop();
    });

    it("keeps exact import-map specifiers when values are empty sentinels", async () => {
      const output = await bundleWithPlugin(
        'import React from "react"; console.log(React);',
        { react: "" },
      );

      assertEquals(output.includes('from "react"'), true);
      assertEquals(output.includes("esm.sh/react"), false);
    });

    it("keeps explicit https imports external for browser execution", async () => {
      const output = await bundleWithPlugin(
        'import React from "https://esm.sh/react@19"; console.log(React);',
        {},
      );

      assertEquals(output.includes('from "https://esm.sh/react@19"'), true);
    });
  },
);
