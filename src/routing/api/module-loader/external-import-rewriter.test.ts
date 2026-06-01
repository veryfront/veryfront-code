import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateCompiledBinaryRequireShim,
  getNodeExternalPackagesToResolve,
  NODE_BUILTINS,
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
} from "./external-import-rewriter.ts";

describe("external-import-rewriter", () => {
  describe("getNodeExternalPackagesToResolve", () => {
    it("always includes zod even with no user deps", () => {
      assertEquals(getNodeExternalPackagesToResolve(new Map()), ["zod"]);
    });

    it("appends user dependency names after zod", () => {
      const deps = new Map([["lodash", "^4"], ["dayjs", "^1"]]);
      assertEquals(getNodeExternalPackagesToResolve(deps), ["zod", "lodash", "dayjs"]);
    });

    it("does not duplicate zod when it is also a user dependency", () => {
      const deps = new Map([["zod", "^3"], ["lodash", "^4"]]);
      assertEquals(getNodeExternalPackagesToResolve(deps), ["zod", "lodash"]);
    });
  });

  describe("rewriteCompiledBinaryVeryfrontImports", () => {
    it("rewrites bare veryfront static imports to the runtime mjs", () => {
      const out = rewriteCompiledBinaryVeryfrontImports(`import { x } from "veryfront";`);
      assertStringIncludes(out, `from "./_vf_runtime.mjs"`);
    });

    it("rewrites bare veryfront dynamic imports", () => {
      const out = rewriteCompiledBinaryVeryfrontImports(`const m = import("veryfront");`);
      assertStringIncludes(out, `import("./_vf_runtime.mjs")`);
    });

    it("rewrites veryfront subpath imports flattening slashes to underscores", () => {
      const out = rewriteCompiledBinaryVeryfrontImports(
        `import { Head } from "veryfront/react/head";`,
      );
      assertStringIncludes(out, `from "./_vf_react_head.mjs"`);
    });

    it("rewrites veryfront subpath dynamic imports", () => {
      const out = rewriteCompiledBinaryVeryfrontImports(`import("veryfront/agent");`);
      assertStringIncludes(out, `import("./_vf_agent.mjs")`);
    });

    it("leaves non-veryfront imports untouched", () => {
      const code = `import React from "react";\nimport x from "./local.ts";`;
      assertEquals(rewriteCompiledBinaryVeryfrontImports(code), code);
    });

    it("does not rewrite package names that merely start with 'veryfront'", () => {
      const code = `import x from "veryfront-plugin";`;
      assertEquals(rewriteCompiledBinaryVeryfrontImports(code), code);
    });
  });

  describe("rewriteCompiledBinaryUserDependencyImports", () => {
    const deps = new Map([["lodash", "^4"]]);

    it("rewrites a default import to interop require", () => {
      const out = rewriteCompiledBinaryUserDependencyImports(
        `import _ from "lodash";`,
        deps,
      );
      assertEquals(out, `const _ = __vf_interopDefault(require("lodash"));`);
    });

    it("rewrites a namespace import to require", () => {
      const out = rewriteCompiledBinaryUserDependencyImports(
        `import * as _ from "lodash";`,
        deps,
      );
      assertEquals(out, `const _ = require("lodash");`);
    });

    it("rewrites a named import to a destructuring require", () => {
      const out = rewriteCompiledBinaryUserDependencyImports(
        `import { merge } from "lodash";`,
        deps,
      );
      assertStringIncludes(out, `= require("lodash")`);
      assertStringIncludes(out, "merge");
    });

    it("rewrites a dynamic import to a resolved require promise", () => {
      const out = rewriteCompiledBinaryUserDependencyImports(
        `const m = import("lodash");`,
        deps,
      );
      assertStringIncludes(out, `Promise.resolve(require("lodash"))`);
    });

    it("rewrites a subpath import including the subpath in require", () => {
      const out = rewriteCompiledBinaryUserDependencyImports(
        `import merge from "lodash/merge";`,
        deps,
      );
      assertStringIncludes(out, `require("lodash/merge")`);
    });

    it("leaves imports for packages not in userDeps untouched", () => {
      const code = `import x from "react";`;
      assertEquals(rewriteCompiledBinaryUserDependencyImports(code, deps), code);
    });
  });

  describe("rewriteDenoNodeBuiltinImports", () => {
    it("prefixes bare node builtin static imports with node:", () => {
      const out = rewriteDenoNodeBuiltinImports(`import { readFile } from "fs";`);
      assertStringIncludes(out, `from "node:fs"`);
    });

    it("prefixes bare node builtin dynamic imports with node:", () => {
      const out = rewriteDenoNodeBuiltinImports(`const p = import("path");`);
      assertStringIncludes(out, `import("node:path")`);
    });

    it("leaves an already-prefixed node: import untouched", () => {
      const code = `import { readFile } from "node:fs";`;
      assertEquals(rewriteDenoNodeBuiltinImports(code), code);
    });

    it("does not touch non-builtin package imports", () => {
      const code = `import express from "express";`;
      assertEquals(rewriteDenoNodeBuiltinImports(code), code);
    });
  });

  describe("generateCompiledBinaryRequireShim", () => {
    it("emits a self-contained CJS require shim referencing the project dir", () => {
      const shim = generateCompiledBinaryRequireShim("/srv/app");
      // Declares the require shim and embeds the project package.json path.
      assertStringIncludes(shim, "__vf_createRequire");
      assertStringIncludes(shim, "/srv/app/package.json");
      // Embeds the node builtin set used for routing builtin requires.
      assertStringIncludes(shim, JSON.stringify(NODE_BUILTINS));
      // Defines a require function and an interop helper.
      assertStringIncludes(shim, "var require = function(id)");
      assertStringIncludes(shim, "__vf_interopDefault");
      assert(shim.length > 0);
    });
  });
});
