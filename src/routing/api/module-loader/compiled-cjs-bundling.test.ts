import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  builtinModuleName,
  nodePreferredFile,
  nodeRelativeFile,
  PackageTypeLookup,
  prependRuntimeRequire,
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

  describe("PackageTypeLookup", () => {
    const manifests: Record<string, string> = {
      "/app/package.json": JSON.stringify({ type: "module" }),
      "/app/node_modules/typed/package.json": JSON.stringify({ type: "commonjs" }),
    };
    const lookup = () =>
      new PackageTypeLookup((path) => Promise.resolve(manifests[path] ?? null), "/app");

    it("reads the nearest package.json inside the project", async () => {
      assertEquals(await lookup().of("/app/src/lib"), "module");
      assertEquals(await lookup().of("/app/node_modules/typed/lib"), "commonjs");
    });

    it("stops at node_modules, as Node does, so a package without a manifest is CommonJS", async () => {
      assertEquals(await lookup().of("/app/node_modules/bare/lib"), undefined);
      assertEquals(await lookup().of("/app/node_modules/@scope/bare"), undefined);
    });
  });

  describe("nodePreferredFile()", () => {
    const files = new Set(["/d/impl.js", "/d/lib/index.js", "/d/data.json"]);
    const isFile = (path: string) => Promise.resolve(files.has(path));

    it("prefers Node's extensions over a TypeScript sibling the bundler probed", async () => {
      assertEquals(await nodePreferredFile("/d/impl.ts", "./impl", "/d", isFile), "/d/impl.js");
      assertEquals(
        await nodePreferredFile("/d/lib/index.tsx", "./lib", "/d", isFile),
        "/d/lib/index.js",
      );
      assertEquals(await nodePreferredFile("/d/data.mjs", "./data", "/d", isFile), "/d/data.json");
    });

    it("keeps a path the import named exactly or a package chose", async () => {
      assertEquals(await nodePreferredFile("/d/impl.ts", "./impl.ts", "/d", isFile), "/d/impl.ts");
      assertEquals(
        await nodePreferredFile("/d/node_modules/p/index.cjs", "p", "/d", isFile),
        "/d/node_modules/p/index.cjs",
      );
      assertEquals(await nodePreferredFile("/d/only.ts", "./only", "/d", isFile), "/d/only.ts");
    });
  });

  describe("nodeRelativeFile()", () => {
    const files = new Set([
      "/d/impl.js",
      "/d/impl.ts",
      "/d/exact",
      "/d/lib/index.js",
      "/d/lib/index.ts",
      "/d/pkg/package.json",
      "/d/addon.node",
    ]);
    const isFile = (path: string) => Promise.resolve(files.has(path));

    it("picks Node's candidates for an extensionless relative import", async () => {
      assertEquals(await nodeRelativeFile("./impl", "/d", isFile), "/d/impl.js");
      assertEquals(await nodeRelativeFile("./lib", "/d", isFile), "/d/lib/index.js");
      assertEquals(await nodeRelativeFile("/d/impl", "/x", isFile), "/d/impl.js");
      assertEquals(await nodeRelativeFile("./addon", "/d", isFile), "/d/addon.node");
    });

    it("leaves exact files, package directories, bare and missing imports to the bundler", async () => {
      assertEquals(await nodeRelativeFile("./impl.ts", "/d", isFile), null);
      assertEquals(await nodeRelativeFile("./exact", "/d", isFile), null);
      assertEquals(await nodeRelativeFile("./pkg", "/d", isFile), null);
      assertEquals(await nodeRelativeFile("impl", "/d", isFile), null);
      assertEquals(await nodeRelativeFile("./missing", "/d", isFile), null);
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

    it("resolves a prefix-only built-in only with its prefix", () => {
      const code = prependRuntimeRequire("export {};\n", [], "/app");
      assert(code.includes('"node:test": 1'), code);
      assert(!code.includes('"test": 1'), code);
    });
  });
});
