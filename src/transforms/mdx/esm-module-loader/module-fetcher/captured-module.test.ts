import "#veryfront/schemas/_test-setup.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertLogicalCaptureImports } from "./captured-module.ts";

describe("logical capture imports", () => {
  it("allows inert file URL text and logical references", async () => {
    await assertLogicalCaptureImports(
      'const label = "file:///inert.mjs"; import "react"; import "node:fs"; import "/_vf_modules/page.js";',
      false,
    );
  });

  it("rejects raw file URLs even when relative project imports are enabled", async () => {
    for (
      const specifier of ["file:///uncaptured.mjs", "FILE:///uncaptured.mjs", "/uncaptured.mjs"]
    ) {
      await assertRejects(
        () => assertLogicalCaptureImports(`import ${JSON.stringify(specifier)};`, true),
        Error,
        "Unscoped file import",
      );
    }
  });

  it("requires a scoped module base for relative imports", async () => {
    await assertLogicalCaptureImports('export * from "../child.js";', true);
    await assertRejects(
      () => assertLogicalCaptureImports('export * from "../child.js";', false),
      Error,
      "Unscoped file import",
    );
  });
});
