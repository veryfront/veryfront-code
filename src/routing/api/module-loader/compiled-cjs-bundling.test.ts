import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  builtinModuleName,
  isCommonJSFile,
  prependRuntimeRequire,
  rewriteStaticRequireResolve,
  wrapCommonJSPaths,
} from "./compiled-cjs-bundling.ts";

describe("routing/api/module-loader/compiled-cjs-bundling (inbox#4177)", () => {
  describe("builtinModuleName()", () => {
    it("names built-ins with or without the node: prefix, including subpaths", () => {
      assertEquals(builtinModuleName("fs"), "fs");
      assertEquals(builtinModuleName("node:fs"), "fs");
      assertEquals(builtinModuleName("fs/promises"), "fs/promises");
      assertEquals(builtinModuleName("left-pad"), undefined);
    });

    it("treats prefix-only built-ins as npm packages without the prefix", () => {
      assertEquals(builtinModuleName("test"), undefined);
      assertEquals(builtinModuleName("node:test"), "test");
    });
  });

  describe("isCommonJSFile()", () => {
    const file = "/app/node_modules/a/index.js";

    it("follows Node's rule for extensions and the package type", async () => {
      assertEquals(
        await isCommonJSFile("module.exports = 1;", "/app/node_modules/a/i.cjs", "module"),
        true,
      );
      assertEquals(
        await isCommonJSFile("export default 1;", "/app/node_modules/a/i.mjs", undefined),
        false,
      );
      assertEquals(await isCommonJSFile("module.exports = 1;", file, undefined), true);
      assertEquals(await isCommonJSFile("module.exports = 1;", file, "commonjs"), true);
      assertEquals(await isCommonJSFile("globalThis.x = typeof __dirname;", file, "module"), false);
    });

    it("treats a .js file with ESM syntax as ESM, as esbuild bundles it", async () => {
      assertEquals(await isCommonJSFile('import x from "x";\nx();', file, undefined), false);
      assertEquals(await isCommonJSFile("export const a = 1;", file, undefined), false);
      assertEquals(await isCommonJSFile("const u = import.meta.url;", file, undefined), false);
      assertEquals(await isCommonJSFile('const m = import("x");', file, undefined), true);
    });
  });

  describe("wrapCommonJSPaths()", () => {
    const file = "/app/node_modules/a/index.js";

    it("leaves a file that does not read the wrapper bindings unchanged", () => {
      assertEquals(wrapCommonJSPaths("module.exports = 1;", file), "module.exports = 1;");
    });

    it("passes both bindings, so a file's own declaration shadows only its own name", () => {
      const wrapped = wrapCommonJSPaths(
        "var __dirname = 'custom'; module.exports = [__dirname, __filename];",
        file,
      );
      const module = { exports: [] as string[] };
      new Function("module", wrapped)(module);
      assertEquals(module.exports, ["custom", file]);
    });

    it("keeps a hashbang first and a directive prologue in effect", () => {
      const wrapped = wrapCommonJSPaths(
        '#!/usr/bin/env node\n"use strict";\nmodule.exports = [__dirname, (function () { return this; })()];',
        file,
      );
      assert(
        wrapped.startsWith("#!/usr/bin/env node\n(function (__dirname, __filename) {"),
        wrapped,
      );
      const module = { exports: [] as unknown[] };
      new Function("module", wrapped.slice(wrapped.indexOf("\n") + 1))(module);
      assertEquals(module.exports, ["/app/node_modules/a", undefined]);
    });
  });

  describe("rewriteStaticRequireResolve()", () => {
    it("replaces resolvable literals and leaves the rest for runtime", async () => {
      const source = [
        'const a = require.resolve("./asset.json");',
        "const b = require.resolve('optional-missing');",
        'const c = require.resolve("fs");',
        'const d = notrequire.resolve("./asset.json");',
      ].join("\n");
      const out = await rewriteStaticRequireResolve(
        source,
        (specifier) =>
          Promise.resolve(specifier === "./asset.json" ? "/app/node_modules/a/asset.json" : null),
      );
      assertEquals(
        out,
        [
          'const a = "/app/node_modules/a/asset.json";',
          "const b = require.resolve('optional-missing');",
          'const c = "fs";',
          'const d = notrequire.resolve("./asset.json");',
        ].join("\n"),
      );
    });
  });

  describe("prependRuntimeRequire()", () => {
    it("keeps a hashbang on the first line", () => {
      const code = prependRuntimeRequire("#!/usr/bin/env node\nexport {};\n", ["path"], "/app");
      assert(code.startsWith("#!/usr/bin/env node\nimport * as "), code);
    });

    it("picks helper names the bundle does not already use", () => {
      const code = prependRuntimeRequire("const __vf_builtin0 = 1;\n", ["path"], "/app");
      assert(code.includes("import * as __vf_builtin_0 from"), code);
    });
  });
});
