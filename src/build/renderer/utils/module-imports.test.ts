import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { EsModuleLexer } from "../../../../extensions/ext-bundler-esbuild/src/es-module-lexer.ts";
import {
  getModuleDependencies,
  parseModuleImports,
  replaceModuleImportSpecifiers,
} from "./module-imports.ts";

if (!tryResolve<ModuleLexer>("ModuleLexer")) {
  register<ModuleLexer>("ModuleLexer", new EsModuleLexer());
}

describe("build/renderer/utils/module-imports", () => {
  it("collects static, re-exported, and literal dynamic imports in source order", async () => {
    const code = [
      'import value from "./value.js";',
      'export { other } from "./other.js";',
      'const lazy = import("./lazy.js");',
    ].join("\n");

    assertEquals(
      (await parseModuleImports(code)).map(({ specifier, dynamic }) => ({
        specifier,
        dynamic,
      })),
      [
        { specifier: "./value.js", dynamic: false },
        { specifier: "./other.js", dynamic: false },
        { specifier: "./lazy.js", dynamic: true },
      ],
    );
  });

  it("ignores import-shaped text in strings, templates, and comments", async () => {
    const code = [
      "const example = 'import Missing from \"./missing.js\"';",
      'const template = `import("./also-missing.js")`;',
      '// import "./comment.js"',
      'import "./real.js";',
    ].join("\n");

    assertEquals(await getModuleDependencies(code), ["./real.js"]);
  });

  it("rewrites only parsed module literals and safely quotes replacements", async () => {
    const code = [
      "const example = 'import Child from \"./child.mdx\"';",
      'import Child from "./child.mdx";',
    ].join("\n");
    const replacement = 'file:///project/child";globalThis.injected=true;//.js';

    const rewritten = await replaceModuleImportSpecifiers(
      code,
      new Map([["./child.mdx", replacement]]),
    );

    assertStringIncludes(rewritten, 'import Child from "file:///project/child\\";');
    assertStringIncludes(rewritten, "const example = 'import Child from \"./child.mdx\"';");
    assertEquals(await getModuleDependencies(rewritten), [replacement]);
  });

  it("preserves import attributes while collecting and rewriting specifiers", async () => {
    const code = [
      'import data from "./data.json" with { type: "json" };',
      'const lazy = import("./lazy.json", { with: { type: "json" } });',
    ].join("\n");
    const rewritten = await replaceModuleImportSpecifiers(
      code,
      new Map([["./data.json", "file:///project/data.json"]]),
    );

    assertEquals(await getModuleDependencies(rewritten), [
      "file:///project/data.json",
      "./lazy.json",
    ]);
    assertStringIncludes(rewritten, 'with { type: "json" }');
    assertStringIncludes(rewritten, '{ with: { type: "json" } }');
  });

  it("does not unmask placeholder-shaped replacement text", async () => {
    const code = [
      'import remote from "https://example.com/remote.js";',
      'import local from "./local.js";',
    ].join("\n");
    const replacement = "./__VFURL_0__.js";

    const rewritten = await replaceModuleImportSpecifiers(
      code,
      new Map([["./local.js", replacement]]),
    );

    assertEquals(await getModuleDependencies(rewritten), [
      "https://example.com/remote.js",
      replacement,
    ]);
  });
});
