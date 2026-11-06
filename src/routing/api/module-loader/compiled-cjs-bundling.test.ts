import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  builtinModuleName,
  commonJSPathPrelude,
  prependBuiltinRequire,
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

  describe("commonJSPathPrelude()", () => {
    it("declares the file's own directory and path when the file reads them", () => {
      assertEquals(
        commonJSPathPrelude("module.exports = __dirname;", "/app/node_modules/a/index.js"),
        'var __dirname = "/app/node_modules/a", __filename = "/app/node_modules/a/index.js";\n',
      );
    });

    it("adds nothing to a file that does not read them", () => {
      assertEquals(commonJSPathPrelude("module.exports = 1;", "/app/node_modules/a/i.js"), "");
    });

    it("leaves a file that declares its own binding alone", () => {
      const esm = 'import { dirname } from "path";\nconst __dirname = dirname("x");';
      assertEquals(commonJSPathPrelude(esm, "/app/node_modules/a/i.js"), "");
    });
  });

  describe("prependBuiltinRequire()", () => {
    it("keeps a hashbang on the first line", () => {
      const code = prependBuiltinRequire("#!/usr/bin/env node\nexport {};\n", ["path"]);
      assert(code.startsWith("#!/usr/bin/env node\nimport * as "), code);
    });

    it("picks helper names the bundle does not already use", () => {
      const code = prependBuiltinRequire("const __vf_builtin0 = 1;\n", ["path"]);
      assert(code.includes("import * as __vf_builtin_0 from"), code);
    });
  });
});
