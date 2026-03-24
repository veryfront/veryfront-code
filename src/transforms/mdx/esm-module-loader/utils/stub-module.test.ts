import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractNamedImports, generateStubCode } from "./stub-module.ts";

describe("extractNamedImports", () => {
  it("extracts named imports from import statement", () => {
    const code = `import { foo, bar } from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.includes("foo"), true);
    assertEquals(result.includes("bar"), true);
  });

  it("handles aliased imports (extracts original name)", () => {
    const code = `import { foo as f, bar as b } from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.includes("foo"), true);
    assertEquals(result.includes("bar"), true);
  });

  it("returns empty for default-only imports", () => {
    const code = `import mod from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.length, 0);
  });

  it("handles single named import", () => {
    const code = `import { useState } from "react";`;
    const result = extractNamedImports(code, `from "react"`);
    assertEquals(result, ["useState"]);
  });
});

describe("generateStubCode", () => {
  it("generates stub with default export", () => {
    const result = generateStubCode("/path/to/module.js");
    assertEquals(result.includes("export default"), true);
    assertEquals(result.includes("Proxy"), true);
  });

  it("generates stub with named exports", () => {
    const result = generateStubCode("/path/to/module.js", ["foo", "bar"]);
    assertEquals(result.includes("export const foo"), true);
    assertEquals(result.includes("export const bar"), true);
  });

  it("includes module path in error messages", () => {
    const result = generateStubCode("/my/module.js");
    assertEquals(result.includes("/my/module.js"), true);
    assertEquals(result.includes("MissingModuleError"), true);
  });

  it("handles empty named imports", () => {
    const result = generateStubCode("/mod.js", []);
    assertEquals(result.includes("export default"), true);
    // No named exports when array is empty
    assertEquals(result.includes("export const"), false);
  });
});
