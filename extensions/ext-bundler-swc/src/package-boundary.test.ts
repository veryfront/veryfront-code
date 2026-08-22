import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("ext-bundler-swc package boundary", () => {
  it("keeps SWC and reflection dependencies in the explicit extension", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
    );

    assertEquals(manifest.veryfront.activation, "explicit");
    assertEquals(manifest.veryfront.contracts.provides, ["Bundler"]);
    assertEquals(manifest.imports["@swc/wasm"], "npm:@swc/wasm@1.16.1");
    assertEquals(manifest.imports["reflect-metadata"], "npm:reflect-metadata@0.2.2");
    assertEquals(
      manifest.imports["@veryfront/ext-bundler-esbuild"],
      "../ext-bundler-esbuild/src/index.ts",
    );
  });

  it("ships the WASM asset used by the portable transform", async () => {
    const swcModule = await import.meta.resolve("@swc/wasm");
    const packageDirectory = new URL(".", swcModule);
    const asset = await Deno.stat(new URL("wasm_bg.wasm", packageDirectory));

    assertEquals(asset.isFile, true);
    assertEquals((asset.size ?? 0) > 1_000_000, true);
  });
});
