import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile, stat } from "#veryfront/compat/fs.ts";
import { fileURLToPath } from "node:url";

describe("ext-bundler-swc package boundary", () => {
  it("keeps SWC and reflection dependencies in the explicit extension", async () => {
    const manifest = JSON.parse(
      await readTextFile(fileURLToPath(new URL("../deno.json", import.meta.url))),
    );

    assertEquals(manifest.veryfront.activation, "explicit");
    assertEquals(manifest.veryfront.contracts.provides, ["Bundler"]);
    assertEquals(manifest.imports["@swc/wasm"], "npm:@swc/wasm@1.16.1");
    assertEquals(manifest.imports["reflect-metadata"], "npm:reflect-metadata@0.2.2");
    assertEquals(manifest.imports["class-validator"], undefined);
    assertEquals(
      manifest.imports["@veryfront/ext-bundler-esbuild"],
      "../ext-bundler-esbuild/src/index.ts",
    );
  });

  it("ships the WASM asset used by the portable transform", async () => {
    const swcModule = await import.meta.resolve("@swc/wasm");
    const packageDirectory = new URL(".", swcModule);
    const asset = await stat(fileURLToPath(new URL("wasm_bg.wasm", packageDirectory)));

    assertEquals(asset.isFile, true);
    assertEquals((asset.size ?? 0) > 1_000_000, true);
  });
});
