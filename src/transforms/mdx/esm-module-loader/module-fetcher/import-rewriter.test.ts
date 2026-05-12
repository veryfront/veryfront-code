import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";
import { FRAMEWORK_ROOT } from "../constants.ts";
import { join } from "#veryfront/compat/path";

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
  it("returns code unchanged for non-framework files", async () => {
    const code = `import { foo } from "./bar.ts";\n`;
    const result = await rewriteDntImports(code, "/user/project/src/app.ts");
    assertEquals(result, code);
  });

  it("rewrites relative imports in node_modules files to absolute file:// paths", async () => {
    const code = `import { foo } from "../utils.js";\n`;
    const result = await rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result.includes("file://"), true);
    assertEquals(result.includes("../"), false);
  });

  it("rewrites side-effect imports in framework files", async () => {
    const code = `import "../_dnt.polyfills.js";\n`;
    const result = await rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result.includes("file://"), true);
  });

  it("does not rewrite non-relative imports", async () => {
    const code = `import { useState } from "react";\n`;
    const result = await rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(result, code);
  });

  it("rewrites transpiled framework .js imports to absolute framework file targets", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "dist/framework-src/react/components");
    const code = `import { getDocumentNonce } from "./ai/csp-nonce.js";\n`;
    const result = await rewriteDntImports(code, `${sourceDir}/Head.tsx.src`);
    const rewrittenSpecifier = result.match(/file:\/\/([^"\n]+)/)?.[1] ?? "";
    assertEquals(result.includes(`from "file://`), true);
    assertEquals(result.includes(`from "./ai/csp-nonce.js"`), false);
    assertEquals(/\/ai\/csp-nonce\./.test(rewrittenSpecifier), true);
  });
});
