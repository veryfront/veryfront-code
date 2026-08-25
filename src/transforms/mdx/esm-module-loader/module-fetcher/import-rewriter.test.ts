import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";
import { MAX_MDX_MODULE_IMPORTS_PER_FILE } from "./limits.ts";
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

  it("rewrites veryfront imports without changing earlier comments", () => {
    const code = [
      `// Previous example: from "veryfront/head"`,
      `import { Head } from "veryfront/head";`,
    ].join("\n");

    assertEquals(
      rewriteVeryfrontImports(code),
      [
        `// Previous example: from "veryfront/head"`,
        `import { Head } from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true";`,
      ].join("\n"),
    );
  });

  it("uses the unified veryfront strategy for SSR-only module overrides", () => {
    const code = `import { useWorkflow } from "veryfront/workflow";\n`;

    assertEquals(
      rewriteVeryfrontImports(code),
      `import { useWorkflow } from "/_vf_modules/_veryfront/workflow/react/index.js?ssr=true";\n`,
    );
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
    assertEquals(
      result,
      `import { foo } from "file:///app/node_modules/veryfront/utils.js";\n`,
      "a relative import resolves against the source file directory",
    );
  });

  it("rewrites side-effect imports in framework files", async () => {
    const code = `import "../_dnt.polyfills.js";\n`;
    const result = await rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");
    assertEquals(
      result,
      `import "file:///app/node_modules/veryfront/_dnt.polyfills.js";\n`,
      "a side-effect import resolves against the source file directory",
    );
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

  it("remaps a transpiled .js specifier onto the framework source file on disk", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "src/transforms/mdx/esm-module-loader/module-fetcher");
    const code = `import { rewriteDntImports } from "./import-rewriter.js";\n`;

    const result = await rewriteDntImports(code, join(sourceDir, "caller.js"));

    assertEquals(
      result,
      `import { rewriteDntImports } from "file://${join(sourceDir, "import-rewriter.ts")}";\n`,
      "a transpiled .js specifier is remapped onto the framework source file that exists on disk",
    );
  });

  it("keeps the plain absolute path when no framework candidate exists on disk", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "src/transforms/mdx/esm-module-loader/module-fetcher");
    const code = `import { missing } from "./does-not-exist.js";\n`;

    const result = await rewriteDntImports(code, join(sourceDir, "caller.js"));

    assertEquals(
      result,
      `import { missing } from "file://${join(sourceDir, "does-not-exist.js")}";\n`,
      "with no candidate on disk the plain absolute path is kept",
    );
  });

  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "dist/framework-src/react/components");
    const code = [
      `// Previous example: from "./ai/csp-nonce.js"`,
      `import { getDocumentNonce } from "./ai/csp-nonce.js";`,
    ].join("\n");

    const result = await rewriteDntImports(code, `${sourceDir}/Head.tsx.src`);
    const lines = result.split("\n");

    assertEquals(lines[0], `// Previous example: from "./ai/csp-nonce.js"`);
    assertEquals(lines[1]?.includes(`from "file://`), true);
  });

  // Side-effect imports are rewritten by their own scan, so bounding only the
  // `from "…"` scan would leave this pattern unbounded.
  it("fails closed when side-effect import collection exceeds its bound", async () => {
    const code = Array.from(
      { length: MAX_MDX_MODULE_IMPORTS_PER_FILE + 1 },
      (_, index) => `import "./polyfill-${index}.js";`,
    ).join("\n");

    await assertRejects(
      () => rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js"),
      RangeError,
      `more than ${MAX_MDX_MODULE_IMPORTS_PER_FILE} static imports`,
    );
  });

  it("rewrites side-effect imports sitting exactly on the bound", async () => {
    const code = Array.from(
      { length: MAX_MDX_MODULE_IMPORTS_PER_FILE },
      (_, index) => `import "./polyfill-${index}.js";`,
    ).join("\n");

    const result = await rewriteDntImports(code, "/app/node_modules/veryfront/dist/head.js");

    assertEquals(result.split("\n").length, MAX_MDX_MODULE_IMPORTS_PER_FILE);
    assertEquals(result.includes(`import "./polyfill-`), false);
  });
});
