import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteProjectAliasImports, transformImports } from "./import-transformer.ts";

describe("rewriteProjectAliasImports", () => {
  it("rewrites @/ alias to /_vf_modules/ path", () => {
    const code = `import { Foo } from "@/components/Foo";\n`;
    const result = rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/components/Foo.js"), true);
  });

  it("adds .js extension if missing", () => {
    const code = `import { Foo } from "@/components/Foo";\n`;
    const result = rewriteProjectAliasImports(code);
    assertEquals(result.includes(".js"), true);
  });

  it("does not double-add .js extension", () => {
    const code = `import { Foo } from "@/components/Foo.js";\n`;
    const result = rewriteProjectAliasImports(code);
    assertEquals(result.includes(".js.js"), false);
    assertEquals(result.includes("/_vf_modules/components/Foo.js"), true);
  });

  it("returns code unchanged when no @/ imports", () => {
    const code = `import { useState } from "react";\n`;
    assertEquals(rewriteProjectAliasImports(code), code);
  });

  it("handles deeply nested paths", () => {
    const code = `import { x } from "@/lib/utils/helpers";\n`;
    const result = rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/lib/utils/helpers.js"), true);
  });

  it("rewrites multiple @/ imports", () => {
    const code = [
      `import { A } from "@/a";`,
      `import { B } from "@/b";`,
    ].join("\n");
    const result = rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/a.js"), true);
    assertEquals(result.includes("/_vf_modules/b.js"), true);
  });
});

describe("transformImports", () => {
  it("applies import map to bare specifiers", () => {
    const code = `import { foo } from "my-lib";\n`;
    const result = transformImports(code, {
      imports: { "my-lib": "/mapped/my-lib.js" },
    });
    assertEquals(result.includes("/mapped/my-lib.js"), true);
  });

  it("strips react from import map", () => {
    const code = `import React from "react";\n`;
    const result = transformImports(code, {
      imports: { "react": "/mapped/react.js", "other": "/mapped/other.js" },
    });
    // React should NOT be rewritten
    assertEquals(result.includes("react"), true);
    assertEquals(result.includes("/mapped/react.js"), false);
  });

  it("returns code unchanged when import map has no matching entries", () => {
    const code = `import { foo } from "bar";\n`;
    const result = transformImports(code, { imports: {} });
    assertEquals(result.includes("bar"), true);
  });
});
