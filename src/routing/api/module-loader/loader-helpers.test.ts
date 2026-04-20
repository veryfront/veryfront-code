import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  FILE_EXTENSIONS,
  getLoaderForFile,
  resolveExportEntry,
  toCjsDestructureBindings,
  validateModulePath,
} from "./loader-helpers.ts";

describe("routing/api/module-loader helpers", () => {
  it("validates module paths stay within the project directory", () => {
    validateModulePath("/tmp/project/pages/api/test.ts", "/tmp/project");
    assertThrows(
      () => validateModulePath("/tmp/project/../escape.ts", "/tmp/project"),
      Error,
      "module path escapes project directory",
    );
  });

  it("resolves export entries from strings and nested export objects", () => {
    assertEquals(resolveExportEntry("./dist/index.js"), "./dist/index.js");
    assertEquals(resolveExportEntry({ import: "./esm.js" }), "./esm.js");
    assertEquals(resolveExportEntry({ default: { default: "./nested.js" } }), "./nested.js");
    assertEquals(resolveExportEntry({ require: "./cjs.js" }), undefined);
  });

  it("converts CJS destructuring bindings", () => {
    assertEquals(
      toCjsDestructureBindings("{ parse as parsePdf, version }"),
      "{ parse: parsePdf, version }",
    );
    assertEquals(toCjsDestructureBindings("{ foo, bar }"), "{ foo, bar }");
    assertEquals(toCjsDestructureBindings("{   }"), "{}");
  });

  it("returns the expected file loaders and extensions", () => {
    assertEquals(FILE_EXTENSIONS, ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
    assertEquals(getLoaderForFile("file.tsx"), "tsx");
    assertEquals(getLoaderForFile("file.ts"), "ts");
    assertEquals(getLoaderForFile("file.json"), "json");
    assertEquals(getLoaderForFile("file.mjs"), "js");
  });
});
