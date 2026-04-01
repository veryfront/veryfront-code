import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createBareExternalPlugin } from "./esbuild-plugins.ts";

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
    plugins: [createBareExternalPlugin({ importMapImports })],
  });

  return result.outputFiles?.[0]?.text ?? "";
}

describe("server/handlers/dev/files/esbuild-plugins", () => {
  afterEach(async () => {
    const esbuild = await import("esbuild");
    esbuild.stop();
  });

  it("keeps exact import-map specifiers when values are empty sentinels", async () => {
    const output = await bundleWithPlugin(
      'import React from "react"; console.log(React);',
      { react: "" },
    );

    assertEquals(output.includes('from "react"'), true);
    assertEquals(output.includes("esm.sh/react"), false);
  });
});
