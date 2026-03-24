import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";

describe("rewriteVeryfrontImports", () => {
  it("rewrites veryfront/ bare specifiers to /_vf_modules/ paths", () => {
    const code = `import { Head } from "veryfront/head";\n`;
    const result = rewriteVeryfrontImports(code);
    assertEquals(result.includes("/_vf_modules/_veryfront/"), true);
    assertEquals(result.includes("?ssr=true"), true);
  });

  it("returns code unchanged when no veryfront imports", () => {
    const code = `import { useState } from "react";\n`;
    assertEquals(rewriteVeryfrontImports(code), code);
  });

  it("handles multiple veryfront imports", () => {
    const code = [
      `import { Head } from "veryfront/head";`,
      `import { Link } from "veryfront/routing";`,
    ].join("\n");
    const result = rewriteVeryfrontImports(code);
    const matches = result.match(/\?ssr=true/g);
    assertEquals(matches !== null && matches.length === 2, true);
  });

  it("does not rewrite non-veryfront bare specifiers", () => {
    const code = `import { z } from "zod";\n`;
    assertEquals(rewriteVeryfrontImports(code), code);
  });
});

describe("rewriteDntImports", () => {
  it("returns code unchanged for non-framework files", () => {
    const code = `import { foo } from "./bar.ts";\n`;
    const result = rewriteDntImports(code, "/user/project/src/app.ts");
    assertEquals(result, code);
  });

  it("rewrites relative imports in node_modules files to absolute file:// paths", () => {
    const code = `import { foo } from "../utils.js";\n`;
    const result = rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result.includes("file://"), true);
    assertEquals(result.includes("../"), false);
  });

  it("rewrites side-effect imports in framework files", () => {
    const code = `import "../_dnt.polyfills.js";\n`;
    const result = rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result.includes("file://"), true);
  });

  it("does not rewrite non-relative imports", () => {
    const code = `import { useState } from "react";\n`;
    const result = rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result, code);
  });
});
