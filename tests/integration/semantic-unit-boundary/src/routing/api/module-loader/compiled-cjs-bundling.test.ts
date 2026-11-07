import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type { Plugin } from "veryfront/extensions/bundler";
import {
  COMPILED_RESOLVE_OPTIONS,
  createCompiledBuiltinPlugin,
  createDependencyFilePredicate,
  createDependencyResolvePlugin,
  createImportExternalsPlugin,
  createNativeAddonPlugin,
  dependencyDirectories,
  dependencyJsonLoad,
  PackageTypeLookup,
  prepareDependencyFile,
  prependRuntimeRequire,
} from "#veryfront/routing/api/module-loader/compiled-cjs-bundling.ts";
import { dependencyTarget } from "#veryfront/routing/api/module-loader/loader.ts";

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const path = `${root}/${relative}`;
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, contents);
  }
}

const isFile = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false; // expected: no such file
  }
};

const hostFs = {
  realPath: (path: string) => realpath(path),
  async *readDir(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      yield {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  },
};

/** Prepares dependency files the way the compiled route build does. */
function dependencyFilePlugin(
  projectDir: string,
  isDependencyFile: (path: string) => boolean,
): Plugin {
  const packageTypes = new PackageTypeLookup(async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null; // expected: no package.json here
    }
  }, projectDir);
  return {
    name: "test-dependency-files",
    setup(build) {
      // Every dependency file, as the route build's boundary loads them.
      build.onLoad({ filter: /.*/ }, async (args) => {
        if (!isDependencyFile(args.path)) return undefined;
        const contents = await readFile(args.path, "utf8");
        if (args.path.endsWith(".json")) {
          return dependencyJsonLoad(contents, args.with, args.suffix);
        }
        return {
          contents: await prepareDependencyFile({
            build,
            contents,
            logicalPath: args.path,
            resolvedPath: args.path,
            packageType: await packageTypes.of(args.path.slice(0, args.path.lastIndexOf("/"))),
            isDependencyFile,
            isFile,
            suffix: args.suffix,
          }),
          loader: "js",
        };
      });
    },
  };
}

/** Bundles a route the way the compiled binary does and imports the result. */
async function bundleAndImport(
  projectDir: string,
  route: string,
  importExternals: string[] = [],
): Promise<Record<string, unknown>> {
  const isDependencyFile = await createDependencyFilePredicate(projectDir, hostFs);
  try {
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      ...COMPILED_RESOLVE_OPTIONS,
      logLevel: "silent",
      stdin: {
        contents: route,
        loader: "ts",
        resolveDir: projectDir,
        sourcefile: `${projectDir}/route.ts`,
      },
      plugins: [
        createNativeAddonPlugin(),
        createCompiledBuiltinPlugin(isDependencyFile),
        createDependencyResolvePlugin(isDependencyFile, isFile),
        createCompiledBuiltinPlugin(() => true),
        createImportExternalsPlugin(importExternals, {
          isDependencyFile,
          nodeModules: [`${projectDir}/node_modules`],
          realPath: async (path) => {
            try {
              return await realpath(path);
            } catch {
              return null; // expected: no such package
            }
          },
        }),
        dependencyFilePlugin(projectDir, isDependencyFile),
      ],
    });
    const code = await prependRuntimeRequire(
      result.outputFiles?.[0]?.text ?? "",
      projectDir,
      await dependencyDirectories(projectDir, hostFs),
      // The bundler names files relative to its working directory.
      process.cwd(),
    );
    const file = `${projectDir}/handler.mjs`;
    await writeFile(file, code);
    return await import(pathToFileURL(file).href);
  } finally {
    await esbuild.stop();
  }
}

/** Runs a test in a fresh project directory, with symlinks in its path followed. */
function inProject(fn: (projectDir: string) => Promise<void>): Promise<void> {
  return withTempDir(async (dir) => fn(await realpath(dir)), { prefix: "vf-cjs-bundle-" });
}

// The compiled binary bundles a route's CommonJS dependencies (inbox#4177).
describe("compiled-binary route bundling of CommonJS dependencies", () => {
  it("runs exports maps, built-in and JSON requires, __dirname and optional requires", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/legacy/package.json": JSON.stringify({
          name: "legacy",
          // The node condition must win over default, as it does in Node.
          exports: { ".": { node: "./lib/index.js", default: "./lib/missing.js" } },
        }),
        "node_modules/legacy/lib/index.js": [
          '"use strict";',
          'var fs = require("fs");',
          'var path = require("node:path");',
          'var data = require("./data");',
          "var optional;",
          'try { optional = require("not-installed"); } catch (error) { optional = error.code; }',
          "exports.name = data.name;",
          "exports.ownFile = path.basename(__filename);",
          'exports.readsSibling = fs.existsSync(path.join(__dirname, "data.json"));',
          "exports.optional = optional;",
        ].join("\n"),
        "node_modules/legacy/lib/data.json": JSON.stringify({ name: "legacy-data" }),
      });
      const mod = await bundleAndImport(
        projectDir,
        'const require = (id: string) => "route:" + id;\n' +
          'export const routeRequire = require("x");\n' +
          'import legacy from "legacy";\nexport { legacy };\n',
      );
      assertEquals(mod.legacy, {
        name: "legacy-data",
        ownFile: "index.js",
        readsSibling: true,
        optional: "MODULE_NOT_FOUND",
      });
      // esbuild renames a route's own `require`, so the prologue cannot clash.
      assertEquals(mod.routeRequire, "route:x");
    });
  });

  it("serves require.resolve and computed requires left for runtime", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/assets/package.json": JSON.stringify({ name: "assets", main: "index.js" }),
        "node_modules/assets/data/en.json": JSON.stringify({ hello: "world" }),
        "node_modules/assets/index.js": [
          'var path = require("path");',
          'exports.asset = require.resolve("./data/en.json");',
          'exports.own = require.resolve("assets/package.json");',
          'exports.builtin = require.resolve("fs");',
          "var missing;",
          'try { require.resolve("optional-native"); } catch (error) { missing = error.code; }',
          "exports.missing = missing;",
          'var computed = path.join(__dirname, "data", "en.json");',
          "exports.computedPath = require.resolve(computed);",
          "exports.computed = require(computed).hello;",
          "exports.cached = require(computed) === require(computed);",
          "var outside;",
          'var hosts = ["", "etc", "hosts"].join("/");',
          "try { require(hosts); } catch (error) { outside = [error.code, error.message]; }",
          "exports.outside = outside;",
          "var prefixOnly;",
          'try { require.resolve("test"); } catch (error) { prefixOnly = error.code; }',
          "exports.prefixOnly = prefixOnly;",
          // A computed built-in id is never seen by the bundler.
          'var fsId = ["f", "s"].join("");',
          "exports.computedBuiltin = typeof require(fsId).readFileSync;",
          'exports.computedPrefixed = typeof require("node:" + "events");',
          "exports.computedResolve = require.resolve(fsId);",
          "var bareTest;",
          'try { require(["te", "st"].join("")); } catch (error) { bareTest = error.code; }',
          "exports.bareTest = bareTest;",
        ].join("\n"),
      });
      const mod = await bundleAndImport(
        projectDir,
        'import assets from "assets";\nexport { assets };\n',
      );
      const asset = `${projectDir}/node_modules/assets/data/en.json`;
      assertEquals(mod.assets, {
        asset,
        own: `${projectDir}/node_modules/assets/package.json`,
        builtin: "fs",
        missing: "MODULE_NOT_FOUND",
        computedPath: asset,
        computed: "world",
        cached: true,
        outside: [
          "MODULE_NOT_FOUND",
          'Cannot find module "a path outside this project or missing"',
        ],
        prefixOnly: "MODULE_NOT_FOUND",
        computedBuiltin: "function",
        computedPrefixed: "function",
        computedResolve: "fs",
        bareTest: "MODULE_NOT_FOUND",
      });
    });
  });

  it("gives ESM dependency files no CommonJS bindings", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/scoped/package.json": JSON.stringify({
          name: "scoped",
          type: "module",
          main: "index.js",
        }),
        "node_modules/scoped/index.js": "export const mode = typeof __dirname;\n",
        "node_modules/plain/package.json": JSON.stringify({ name: "plain", module: "index.js" }),
        "node_modules/plain/index.js": "export const mode = typeof __filename;\n",
      });
      await bundleAndImport(
        projectDir,
        'import { mode as a } from "scoped";\nimport { mode as b } from "plain";\nexport const modes = [a, b];\n',
      );
      // Checked in the bundle, not at runtime: Bun defines both names in ESM too.
      const code = await readFile(`${projectDir}/handler.mjs`, "utf8");
      assert(code.includes("typeof __dirname") && code.includes("typeof __filename"), code);
    });
  });

  it("parses a CommonJS file instead of matching its text", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/parsed/package.json": JSON.stringify({ name: "parsed", main: "index.js" }),
        "node_modules/parsed/data.json": "{}",
        "node_modules/parsed/index.js": [
          "var text = 'require.resolve(\"./data.json\")';",
          "/*",
          "export default 1",
          "*/",
          "var __filename = 'own';",
          "exports.text = text;",
          "exports.dir = __dirname;",
          "exports.file = __filename;",
          "exports.firstArgument = arguments[0] === exports;",
        ].join("\n"),
      });
      const mod = await bundleAndImport(
        projectDir,
        'import parsed from "parsed";\nexport { parsed };\n',
      );
      assertEquals(mod.parsed, {
        text: 'require.resolve("./data.json")',
        dir: `${projectDir}/node_modules/parsed`,
        file: "own",
        // No wrapper of ours: arguments are the bundler's CommonJS wrapper's.
        firstArgument: true,
      });
    });
  });

  it("bundles a workspace package that node_modules links to", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "packages/linked/package.json": JSON.stringify({ name: "linked", main: "index.js" }),
        "packages/linked/index.js":
          'exports.dir = __dirname;\nexports.self = require.resolve("./index.js");',
      });
      await mkdir(`${projectDir}/node_modules`, { recursive: true });
      await symlink("../packages/linked", `${projectDir}/node_modules/linked`);
      const mod = await bundleAndImport(
        projectDir,
        'import linked from "linked";\nexport { linked };\n',
      );
      assertEquals(mod.linked, {
        dir: `${projectDir}/packages/linked`,
        self: `${projectDir}/packages/linked/index.js`,
      });
    });
  });

  it("resolves inside dependencies in Node's order", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/order/package.json": JSON.stringify({ name: "order", main: "index.js" }),
        "node_modules/order/index.js":
          'exports.impl = require("./impl");\nexports.data = require("./data");',
        "node_modules/order/data.mjs": 'export default "mjs";',
        "node_modules/order/data.json": '"json"',
        // A workspace package resolves outside node_modules, where the
        // bundler's own order would pick the TypeScript sibling.
        "packages/wsorder/package.json": JSON.stringify({ name: "wsorder", main: "index.js" }),
        "packages/wsorder/index.js": 'module.exports = require("./impl");',
        "packages/wsorder/impl.js": 'module.exports = "js";',
        "packages/wsorder/impl.ts": 'export default "ts";',
        "node_modules/order/impl.js": 'module.exports = "js";',
        "node_modules/order/impl.ts": 'export default "ts";',
        "node_modules/modonly/package.json": JSON.stringify({ name: "modonly", module: "esm.js" }),
        "node_modules/modonly/index.js": 'module.exports = "index";',
        "node_modules/modonly/esm.js": 'export default "module";',
        // An extensionless main and a default index pick .js over .ts too.
        "node_modules/mainpkg/package.json": JSON.stringify({ name: "mainpkg", main: "impl" }),
        "node_modules/mainpkg/impl.js": 'module.exports = "js";',
        "node_modules/mainpkg/impl.ts": 'export default "ts";',
        "node_modules/idxpkg/package.json": JSON.stringify({ name: "idxpkg" }),
        "node_modules/idxpkg/index.js": 'module.exports = "js";',
        "node_modules/idxpkg/index.ts": 'export default "ts";',
      });
      await symlink("../packages/wsorder", `${projectDir}/node_modules/wsorder`);
      const mod = await bundleAndImport(
        projectDir,
        'import order from "order";\nimport modonly from "modonly";\nimport wsorder from "wsorder";\n' +
          'import mainpkg from "mainpkg";\nimport idxpkg from "idxpkg";\n' +
          "export const picked = [order.impl, order.data, modonly, wsorder, mainpkg, idxpkg];\n",
      );
      assertEquals(mod.picked, ["js", "json", "index", "js", "js", "js"]);
    });
  });

  it("keeps a route's own require binding when nothing is bundled", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "helper.ts": 'export const require = (id: string) => "helper:" + id;\n',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import { require } from "./helper.ts";\nexport const value = require("q");\n',
      );
      assertEquals(mod.value, "helper:q");
    });
  });

  it("runs a dependency file a computed path requires", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/dialects/package.json": JSON.stringify({
          name: "dialects",
          main: "index.js",
        }),
        "node_modules/dialects/index.js": [
          'var path = require("path");',
          "exports.load = function (name) {",
          '  return require(path.join(__dirname, "dialects", name + ".js"));',
          "};",
        ].join("\n"),
        "node_modules/dialects/dialects/pg.js": [
          'var base = require("../base");',
          'exports.name = base.prefix + "pg";',
          'exports.sep = require("path").sep;',
          // Never seen by the bundler: only this computed load reaches it.
          'exports.driver = require("driver");',
        ].join("\n"),
        "node_modules/driver/package.json": JSON.stringify({
          name: "driver",
          exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
        }),
        "node_modules/driver/index.cjs": 'module.exports = "driver";',
        "node_modules/dialects/base.js": 'exports.prefix = "dialect:";',
        "src/secret.js": 'module.exports = "project code";',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import dialects from "dialects";\n' +
          "export const pg = dialects.load('pg');\n" +
          "export const again = dialects.load('pg') === pg;\n" +
          "let project;\n" +
          'try { dialects.load("../../../src/secret"); } catch (error) { project = (error as { code?: string }).code; }\n' +
          "export { project };\n",
      );
      assertEquals(mod.pg, { name: "dialect:pg", sep: "/", driver: "driver" });
      assertEquals(mod.again, true);
      assertEquals(mod.project, "MODULE_NOT_FOUND");
    });
  });

  it("bundles a direct-eval dependency beside one that imports an external package", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/usesub/package.json": JSON.stringify({ name: "usesub", main: "index.js" }),
        "node_modules/usesub/index.js": 'exports.load = () => import("esmsub/feature");',
        "node_modules/esmsub/package.json": JSON.stringify({
          name: "esmsub",
          type: "module",
          exports: { ".": "./index.js", "./feature": "./dist/feature.js" },
        }),
        "node_modules/esmsub/index.js": 'export default "root";',
        "node_modules/esmsub/dist/feature.js": 'export default "feature";',
        "node_modules/evaler/package.json": JSON.stringify({ name: "evaler", main: "index.js" }),
        "node_modules/evaler/index.js": [
          '"use strict";',
          'exports.plugin = eval("require")("./plugin").name;',
        ].join("\n"),
        "node_modules/evaler/plugin.js": 'exports.name = "plugin";',
      });
      const mod = await bundleAndImport(
        projectDir,
        [
          'import u from "usesub";',
          'import e from "evaler";',
          "export const evaler = e.plugin;",
          "export const feature = (await u.load()).default;",
        ].join("\n"),
        ["esmsub"],
      );
      assertEquals({ ...mod }, { evaler: "plugin", feature: "feature" });
    });
  });

  it("shares one module cache with computed requires while modules load", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/cyc/package.json": JSON.stringify({ name: "cyc", main: "a.js" }),
        "node_modules/cyc/counter.js": "module.exports = { a: 0, c: 0 };",
        "node_modules/cyc/a.js": [
          'require("./counter").a++;',
          "exports.early = true;",
          // b requires this file by a computed path while it is still loading.
          'exports.sawPartial = require("./b").sawPartial;',
          'exports.runs = require("./counter").a;',
          "exports.reload = () => {",
          '  delete require.cache[require.resolve("./c")];',
          '  return require("./c");',
          "};",
          'exports.first = require("./c");',
          'exports.early2 = require(["./early", "js"].join(".")) === require("./early");',
        ].join("\n"),
        "node_modules/cyc/b.js": [
          'var path = require("path");',
          'var a = require(path.join(__dirname, "a" + ".js"));',
          "exports.sawPartial = a.early === true && a.runs === undefined;",
        ].join("\n"),
        "node_modules/cyc/c.js": 'module.exports = { n: ++require("./counter").c };',
        // A top-level return leaves early; the module is still cached.
        "node_modules/cyc/early.js": "exports.x = 1;\nif (exports.x) return;\nexports.y = 2;",
      });
      const mod = await bundleAndImport(
        projectDir,
        'import cyc from "cyc";\nexport const result = cyc;\n',
      );
      const cyc = mod.result as Record<string, unknown> & { reload(): { n: number } };
      assertEquals(cyc.sawPartial, true);
      assertEquals(cyc.runs, 1);
      assertEquals(cyc.first, { n: 1 });
      assertEquals(cyc.early2, true);
      // Deleted from require.cache, the bundled file runs again, as in Node.
      assertEquals(cyc.reload(), { n: 2 });
    });
  });

  it("runs dependency files the way Node 24 loads them", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/node24/package.json": JSON.stringify({ name: "node24", main: "index.js" }),
        "node_modules/node24/index.js": [
          'var path = require("path");',
          "exports.wrapper = [arguments.length, typeof arguments[1], path.basename(arguments[3])];",
          'exports.sync = require("dual").kind;',
          'try { require("./forced.cjs"); } catch (error) { exports.forced = error.name; }',
          'try { exports.typed = require(["./typed", "cts"].join(".")); } catch (error) { exports.typed = error.code; }',
          'exports.bom = require("./bom/x.js");',
        ].join("\n"),
        "node_modules/node24/forced.cjs": "export default 1;",
        "node_modules/node24/typed.cts": "const n: number = 2;\nmodule.exports = n;",
        // A byte order mark does not make a package.json malformed.
        "node_modules/node24/bom/package.json": '\uFEFF{"type":"module"}',
        "node_modules/node24/bom/x.js": "export const kind = 'esm';",
        "node_modules/dual/package.json": JSON.stringify({
          name: "dual",
          exports: { ".": { "module-sync": "./sync.mjs", require: "./legacy.cjs" } },
        }),
        "node_modules/dual/sync.mjs": 'export const kind = "sync";',
        "node_modules/dual/legacy.cjs": 'exports.kind = "legacy";',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import node24 from "node24";\nexport const result = node24;\n',
      );
      const result = mod.result as Record<string, unknown>;
      assertEquals(result.wrapper, [5, "function", "index.js"]);
      assertEquals(result.sync, "sync");
      assertEquals(result.forced, "SyntaxError");
      // Deno, which the compiled binary runs on, strips types as Node 24 does; a
      // runtime without the stripper refuses the file instead of running it.
      const strips = typeof (await import("node:module")).stripTypeScriptTypes === "function";
      assertEquals(result.typed, strips ? 2 : "ERR_UNKNOWN_FILE_EXTENSION");
      assertEquals((result.bom as { kind: string }).kind, "esm");
    });
  });

  it("keeps Node's CommonJS scoping rules for dependency files", async () => {
    await inProject(async (projectDir) => {
      // A `paths` entry relative to the working directory.
      const vendor = relative(process.cwd(), `${projectDir}/vendor`);
      await writeFiles(projectDir, {
        "package.json": JSON.stringify({ imports: { "#config": "./config.json" } }),
        "config.json": '{"from":"project"}',
        "vendor/node_modules/vended/index.js": "module.exports = 'vended';",
        "node_modules/scopes/package.json": JSON.stringify({ name: "scopes", main: "index.js" }),
        "node_modules/scopes/index.js": [
          // A wrapper parameter the file replaces, here with a compound assignment.
          'require &&= require("./swap")(require);',
          "exports.swapped = require.swapped;",
          'exports.custom = require("./mod");',
          'exports.jsonData = require("esmod/data.json");',
          'exports.self = require(["self", "ref"].join("-"));',
          // A file with no package.json of its own: its scope ends at node_modules.
          'try { require("loose/x.js"); } catch (error) { exports.loose = error.code; }',
          `exports.vended = require.resolve("vended", { paths: [${JSON.stringify(vendor)}] });`,
          'try { require.resolve("vended", { paths: "x" }); } catch (error) { exports.badPaths = error.code; }',
          'try { require.resolve("vended", { paths: [7] }); } catch (error) { exports.badEntry = error.code; }',
          "exports.lookups = [",
          '  require.resolve.paths("fs"),',
          '  require.resolve.paths("./a"),',
          '  require.resolve.paths("x")[0],',
          "];",
        ].join("\n"),
        "node_modules/scopes/swap.js": [
          "module.exports = function (original) {",
          "  var swapped = function (id) { return original(id); };",
          "  swapped.resolve = original.resolve;",
          "  swapped.swapped = true;",
          "  return swapped;",
          "};",
        ].join("\n"),
        // Node runs a file with an unknown extension as CommonJS, even in a
        // `"type": "module"` scope.
        "node_modules/scopes/mod/package.json": JSON.stringify({
          type: "module",
          main: "entry.foo",
        }),
        "node_modules/scopes/mod/entry.foo":
          "module.exports = [require('path').basename(__filename), arguments.length];",
        "node_modules/loose/x.js": 'module.exports = require("#config");',
        "node_modules/self-ref/package.json": JSON.stringify({
          name: "self-ref",
          exports: { ".": "./outer.js" },
        }),
        "node_modules/self-ref/outer.js":
          'exports.which = "outer";\nexports.self = require(["self", "ref"].join("-")).which;',
        "node_modules/self-ref/node_modules/self-ref/package.json": JSON.stringify({
          name: "self-ref",
          main: "inner.js",
        }),
        "node_modules/self-ref/node_modules/self-ref/inner.js": 'exports.which = "inner";',
        "node_modules/esmod/package.json": JSON.stringify({
          name: "esmod",
          type: "module",
          main: "index.js",
          imports: { "#not-built": "./dist/later.js" },
        }),
        "node_modules/esmod/index.js": [
          'import data from "./data.json" with { type: "json" };',
          'import queried from "./data.json?v=1" with { type: "json" };',
          "export { data, queried };",
          "export const req = typeof require;",
          'export const missing = import.meta.resolve(["#not", "built"].join("-"));',
        ].join("\n"),
        "node_modules/esmod/data.json": '{"kind":"json"}',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import scopes from "scopes";\nimport * as esmod from "esmod";\nexport const result = { scopes, esmod: { ...esmod } };\n',
      );
      const { scopes, esmod } = mod.result as Record<string, Record<string, unknown>>;
      assertEquals(scopes!.swapped, true);
      assertEquals(scopes!.custom, ["entry.foo", 5]);
      assertEquals(scopes!.self, { which: "outer", self: "outer" });
      assertEquals(scopes!.loose, "MODULE_NOT_FOUND");
      assertEquals(scopes!.vended, `${projectDir}/vendor/node_modules/vended/index.js`);
      assertEquals(scopes!.badPaths, "ERR_INVALID_ARG_VALUE");
      assertEquals(scopes!.badEntry, "ERR_INVALID_ARG_TYPE");
      assertEquals(scopes!.lookups, [
        null,
        [`${projectDir}/node_modules/scopes`],
        `${projectDir}/node_modules/scopes/node_modules`,
      ]);
      // Node 24 gives a JSON import the module require() caches; one with a
      // query is a module of its own.
      assertEquals(esmod!.data, { kind: "json" });
      assert(esmod!.data === scopes!.jsonData);
      assertEquals(esmod!.queried, { kind: "json" });
      assert(esmod!.queried !== esmod!.data);
      assertEquals(esmod!.req, "undefined");
      assertEquals(
        esmod!.missing,
        pathToFileURL(`${projectDir}/node_modules/esmod/dist/later.js`).href,
      );
    });
  });

  it("keeps Node's module graph, package scopes and import.meta", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/graph/package.json": JSON.stringify({
          name: "graph",
          main: "index.js",
          exports: { ".": "./index.js", "./*": "./*" },
          imports: { "#own": "./a.js" },
        }),
        "node_modules/graph/index.js": [
          'var path = require("path");',
          "var name = (m) => m && path.basename(m.filename);",
          'var a = require("./a.js");',
          'var b = require(["./b", "js"].join("."));',
          "var children = module.children.map(name);",
          // JSON a computed require loads first gets a complete cache entry.
          'var json = require.resolve("./data.json");',
          "require([json].join(''));",
          "var entry = require.cache[json];",
          "var badscope = require(path.join(__dirname, '..', 'badscope', 'a.cjs'));",
          "module.exports = {",
          "  children: children,",
          "  aParent: name(require.cache[require.resolve('./a.js')].parent),",
          "  cParent: name(require.cache[require.resolve('./c.js')].parent),",
          "  bChildren: require.cache[require.resolve('./b.js')].children.map(name),",
          "  json: [entry.loaded, name(entry), typeof entry.require, name(entry.parent)],",
          // The caller's own package resolves before any paths.
          "  scoped: [",
          '    path.basename(require.resolve("graph", { paths: [] })),',
          '    path.basename(require.resolve("#own", { paths: ["/"] })),',
          "    path.basename(require.resolve(__filename, { paths: [] })),",
          "  ],",
          "  badscope: badscope,",
          "};",
        ].join("\n"),
        "node_modules/graph/a.js": "module.exports = 'a';",
        "node_modules/graph/b.js": "module.exports = require(['./c', 'js'].join('.'));",
        "node_modules/graph/c.js": "module.exports = 'c';",
        "node_modules/graph/data.json": '{"d":1}',
        // A malformed scope lets its `.cjs` file run, but no id resolves from it.
        "node_modules/badscope/package.json": "{bad",
        "node_modules/badscope/a.cjs": [
          "var codes = [];",
          'for (var id of ["#x", "./b.cjs", "graph"]) {',
          "  try { require([id].join('')); codes.push('loaded'); } catch (e) { codes.push(e.code); }",
          "}",
          'codes.push(typeof require("path").join);',
          "module.exports = codes;",
        ].join("\n"),
        "node_modules/badscope/b.cjs": "module.exports = 'b';",
        "node_modules/meta/package.json": JSON.stringify({
          name: "meta",
          type: "module",
          main: "index.js",
        }),
        "node_modules/meta/index.js": [
          "const meta = import.meta;",
          "export const shape = [Object.getPrototypeOf(meta), meta.main, Object.keys(meta)];",
          "const code = (f) => { try { f(); return 'ok'; } catch (e) { return e.code ?? e.name; } };",
          'export const hosts = [code(() => import.meta.resolve("file://remote-host/x")), code(() => import.meta.resolve(["//remote-host", "x"].join("/"))), code(() => import.meta.resolve("file://localhost/x"))];',
          "export const assign = code(() => { require = () => 1; });",
        ].join("\n"),
      });
      const mod = await bundleAndImport(
        projectDir,
        'import graph from "graph";\nimport * as meta from "meta";\nexport const result = { graph, meta: { ...meta } };\n',
      );
      const { graph, meta } = mod.result as Record<string, Record<string, unknown>>;
      assertEquals(graph!.children, ["a.js", "b.js"]);
      assertEquals(graph!.aParent, "index.js");
      assertEquals(graph!.cParent, "b.js");
      assertEquals(graph!.bChildren, ["c.js"]);
      assertEquals(graph!.json, [true, "data.json", "function", "index.js"]);
      assertEquals(graph!.scoped, ["index.js", "a.js", "index.js"]);
      assertEquals(graph!.badscope, [
        "ERR_INVALID_PACKAGE_CONFIG",
        "ERR_INVALID_PACKAGE_CONFIG",
        "ERR_INVALID_PACKAGE_CONFIG",
        "function",
      ]);
      assertEquals(meta!.shape, [null, false, ["dirname", "filename", "main", "resolve", "url"]]);
      assertEquals(meta!.hosts, [
        "ERR_INVALID_FILE_URL_HOST",
        "ERR_INVALID_FILE_URL_HOST",
        "ok",
      ]);
      assertEquals(meta!.assign, "ReferenceError");
    });
  });

  it("keeps a module's own require, failed loads and malformed packages as Node does", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/later/package.json": JSON.stringify({ name: "later", main: "index.js" }),
        "node_modules/later/index.js": [
          'var path = require("path");',
          "var name = (m) => m && path.basename(m.filename);",
          "var codes = [];",
          // A failed load leaves no child behind, bundled or computed.
          'try { require("./throws.js"); } catch (e) { codes.push(e.message); }',
          "try { require(['./throws2', 'js'].join('.')); } catch (e) { codes.push(e.message); }",
          'for (var id of ["bad", "./baddir", "bad/index.js"]) {',
          "  try { require([id].join('')); codes.push('loaded'); } catch (e) { codes.push(e.code); }",
          "}",
          // A direct eval in another spelling still sees the file's own require.
          'var viaEval = (eval)("require")("./plugin.js");',
          "exports.codes = codes;",
          "exports.viaEval = viaEval;",
          // A require made after the body ran still names this module.
          "exports.load = function () {",
          "  var loaded = require(['./lazy', 'js'].join('.'));",
          "  return [name(require.cache[require.resolve('./lazy.js')].parent), module.children.map(name)];",
          "};",
        ].join("\n"),
        "node_modules/later/throws.js": "throw new Error('bundled');",
        "node_modules/later/throws2.js": "throw new Error('computed');",
        "node_modules/later/lazy.js": "module.exports = 'lazy';",
        "node_modules/later/plugin.js": "module.exports = 'plugin';",
        "node_modules/later/baddir/package.json": "{bad",
        "node_modules/later/baddir/index.js": "module.exports = 1;",
        "node_modules/bad/package.json": "{bad",
        "node_modules/bad/index.js": "module.exports = 1;",
        "node_modules/badmeta/package.json": JSON.stringify({
          name: "badmeta",
          type: "module",
          main: "index.js",
        }),
        "node_modules/badmeta/index.js": [
          "let code;",
          'try { import.meta.resolve(["bad"].join("")); code = "ok"; } catch (e) { code = e.code; }',
          "export { code };",
        ].join("\n"),
      });
      const mod = await bundleAndImport(
        projectDir,
        'import later from "later";\nimport { code } from "badmeta";\nexport const result = { later, lazy: later.load(), code };\n',
      );
      const result = mod.result as {
        later: Record<string, unknown>;
        lazy: unknown;
        code: unknown;
      };
      assertEquals(result.later.codes, [
        "bundled",
        "computed",
        "ERR_INVALID_PACKAGE_CONFIG",
        "ERR_INVALID_PACKAGE_CONFIG",
        "ERR_INVALID_PACKAGE_CONFIG",
      ]);
      assertEquals(result.later.viaEval, "plugin");
      assertEquals(result.lazy, ["index.js", ["plugin.js", "lazy.js"]]);
      assertEquals(result.code, "ERR_INVALID_PACKAGE_CONFIG");
    });
  });

  it("binds a dependency's later literal requires and computed imports to the dependency", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/deferred/package.json": JSON.stringify({
          name: "deferred",
          main: "index.js",
        }),
        "node_modules/deferred/index.js": [
          'var path = require("path");',
          "var name = (m) => m && path.basename(m.filename);",
          // A literal require made after the body ran: bundled, yet still this
          // module's child.
          "exports.lazy = function () {",
          '  require("./lazy.js");',
          "  return [name(require.cache[require.resolve('./lazy.js')].parent), module.children.map(name)];",
          "};",
          // Node checks the argument before any lookup.
          "exports.codes = function () {",
          "  var codes = [];",
          "  for (var value of [7, undefined, {}]) {",
          "    try { require(value); codes.push('loaded'); } catch (e) { codes.push(e.name + ' ' + e.code); }",
          "    try { require.resolve(value); codes.push('resolved'); } catch (e) { codes.push(e.name + ' ' + e.code); }",
          "  }",
          "  try { require(''); } catch (e) { codes.push(e.name + ' ' + e.code); }",
          "  return codes;",
          "};",
          // Imports the bundler cannot follow resolve from this file.
          "exports.load = function (id) { return import(id); };",
        ].join("\n"),
        "node_modules/deferred/lazy.js": "module.exports = 'lazy';",
        "node_modules/deferred/plugin.mjs": "export default 'plugin';",
        "node_modules/deferred/node_modules/inner/package.json": JSON.stringify({
          name: "inner",
          type: "module",
          exports: "./main.js",
        }),
        "node_modules/deferred/node_modules/inner/main.js": "export default 'inner';",
      });
      const mod = await bundleAndImport(
        projectDir,
        'import deferred from "deferred";\nexport { deferred };\n',
      );
      const deferred = mod.deferred as {
        lazy: () => unknown;
        codes: () => unknown;
        load: (id: unknown) => Promise<{ default: unknown }>;
      };
      assertEquals(deferred.lazy(), ["index.js", ["lazy.js"]]);
      assertEquals(deferred.codes(), [
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_TYPE",
        "TypeError ERR_INVALID_ARG_VALUE",
      ]);
      assertEquals((await deferred.load("./plugin.mjs")).default, "plugin");
      assertEquals((await deferred.load("inner")).default, "inner");
      // One that does not resolve rejects, as Node's import() does.
      const missing = deferred.load("missing-package");
      assert(missing instanceof Promise);
      const error = await missing.then(() => null, (reason) => reason);
      assertEquals((error as { code?: unknown }).code, "ERR_MODULE_NOT_FOUND");
    });
  });

  it("stops a linked workspace package's lookup at the copy that refuses an id", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "packages/linked/package.json": JSON.stringify({ name: "linked", main: "index.js" }),
        "packages/linked/index.js": 'module.exports = require("q/sub");',
        // The nearest copy does not export `./sub`; the project's would.
        "packages/linked/node_modules/q/package.json": JSON.stringify({
          name: "q",
          exports: { ".": "./index.js" },
        }),
        "packages/linked/node_modules/q/index.js": "module.exports = 'nearest';",
        "node_modules/q/package.json": JSON.stringify({ name: "q" }),
        "node_modules/q/sub.js": "module.exports = 'project';",
      });
      await symlink("../packages/linked", `${projectDir}/node_modules/linked`);
      await assertRejects(() =>
        bundleAndImport(projectDir, 'import linked from "linked";\nexport { linked };\n')
      );
    });
  });

  it("shares one module between a bundled require and a computed one", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/plugins/package.json": JSON.stringify({ name: "plugins", main: "index.js" }),
        "node_modules/plugins/index.js": [
          'var path = require("path");',
          'var bundled = require("./plugin");',
          'var data = require("./data.json");',
          "bundled.count++;",
          'exports.same = require(path.join(__dirname, "plugin.js")) === bundled;',
          'exports.count = require(path.join(__dirname, "plu" + "gin")).count;',
          'exports.sameJson = require(path.join(__dirname, "data.json")) === data;',
          "exports.cached = require.cache[require.resolve(path.join(__dirname, 'plugin'))].exports === bundled;",
        ].join("\n"),
        "node_modules/plugins/plugin.js": "exports.count = 0;",
        "node_modules/plugins/data.json": '{"name":"data"}',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import plugins from "plugins";\nexport { plugins };\n',
      );
      assertEquals(mod.plugins, { same: true, count: 1, sameJson: true, cached: true });
    });
  });

  it("resolves a workspace package's imports past the project's tsconfig paths", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "pg": ["./mock/pg.js"] } },
        }),
        "mock/pg.js": 'module.exports = "mock";',
        "node_modules/pg/package.json": JSON.stringify({ name: "pg", main: "index.js" }),
        "node_modules/pg/index.js": 'module.exports = "pg";',
        "packages/workspace/package.json": JSON.stringify({ name: "workspace", main: "index.js" }),
        "packages/workspace/index.js": 'module.exports = require("pg");',
      });
      await mkdir(`${projectDir}/node_modules`, { recursive: true });
      await symlink("../packages/workspace", `${projectDir}/node_modules/workspace`);
      const mod = await bundleAndImport(
        projectDir,
        'import workspace from "workspace";\nimport pg from "pg";\nexport const picked = [workspace, pg];\n',
      );
      // The route's own import still follows the project's paths.
      assertEquals(mod.picked, ["pg", "mock"]);
    });
  });

  it("keeps the query of a dependency module in its import.meta.url", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/queried/package.json": JSON.stringify({
          name: "queried",
          type: "module",
          main: "index.js",
        }),
        "node_modules/queried/index.js": 'export { url, sibling } from "./child.js?v=1";',
        "node_modules/queried/child.js": [
          "export const url = import.meta.url;",
          'export const sibling = import.meta.resolve("./other.js");',
        ].join("\n"),
      });
      const mod = await bundleAndImport(projectDir, 'export * from "queried";\n');
      const base = pathToFileURL(`${projectDir}/node_modules/queried`).href;
      assertEquals({ ...mod }, { url: `${base}/child.js?v=1`, sibling: `${base}/other.js` });
    });
  });

  it("prepares an extensionless CommonJS entry", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/bare/package.json": JSON.stringify({ name: "bare", main: "entry" }),
        "node_modules/bare/entry": [
          "exports.dir = __dirname;",
          "exports.file = __filename;",
          'exports.self = require.resolve("./entry");',
        ].join("\n"),
      });
      const mod = await bundleAndImport(projectDir, 'import bare from "bare";\nexport { bare };\n');
      const entry = `${projectDir}/node_modules/bare/entry`;
      assertEquals(mod.bare, { dir: `${projectDir}/node_modules/bare`, file: entry, self: entry });
    });
  });

  it("keeps import.meta locations of a dependency module its own", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/meta/package.json": JSON.stringify({
          name: "meta",
          type: "module",
          main: "index.js",
          // import.meta.resolve reads the import condition.
          imports: { "#worker": { import: "./worker.mjs", require: "./worker.cjs" } },
        }),
        "node_modules/meta/worker.mjs": "export {};",
        "node_modules/meta/worker.cjs": "",
        "node_modules/meta/index.js": [
          "const meta = import.meta;",
          "const resolve = import.meta.resolve;",
          'const name = ["./data", "json"].join(".");',
          "export const url = import.meta.url;",
          "export const dir = meta.dirname;",
          "export const detached = resolve(name);",
          'export const builtin = import.meta.resolve("fs");',
          'export const computedBuiltin = resolve(["node", "path"].join(":"));',
          'export const sibling = import.meta.resolve("other");',
          'export const computedBare = resolve(["oth", "er"].join(""));',
          'export const computedImport = resolve(["#work", "er"].join(""));',
          'export const suffixed = import.meta.resolve("suffixed/feature");',
          "let missing;",
          'try { resolve(["not", "installed"].join("-")); } catch (error) { missing = error.code; }',
          "export const computedMissing = missing;",
        ].join("\n"),
        "node_modules/other/package.json": JSON.stringify({ name: "other", main: "main.js" }),
        "node_modules/suffixed/package.json": JSON.stringify({
          name: "suffixed",
          exports: { "./feature": "./feature.js?mode=x" },
        }),
        "node_modules/suffixed/feature.js": "export {};",
        "node_modules/other/main.js": "module.exports = 1;",
      });
      const mod = await bundleAndImport(
        projectDir,
        'export * from "meta";\n',
      );
      const base = pathToFileURL(`${projectDir}/node_modules`).href;
      assertEquals({ ...mod }, {
        url: `${base}/meta/index.js`,
        dir: `${projectDir}/node_modules/meta`,
        detached: `${base}/meta/data.json`,
        builtin: "node:fs",
        computedBuiltin: "node:path",
        sibling: `${base}/other/main.js`,
        computedBare: `${base}/other/main.js`,
        computedImport: `${base}/meta/worker.mjs`,
        // Node keeps a package target's query.
        suffixed: `${base}/suffixed/feature.js?mode=x`,
        computedMissing: "ERR_MODULE_NOT_FOUND",
      });
    });
  });

  it("bundles a package whose name ends in .node", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/client.node/package.json": JSON.stringify({
          name: "client.node",
          main: "index.js",
        }),
        "node_modules/client.node/index.js": 'module.exports = "client";',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import client from "client.node";\nexport { client };\n',
      );
      assertEquals(mod.client, "client");
    });
  });

  it("bundles the CommonJS entry of a package it keeps external for imports", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/dual/package.json": JSON.stringify({
          name: "dual",
          exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
        }),
        "node_modules/dual/index.mjs": 'export default "esm";',
        "node_modules/dual/index.cjs": 'module.exports = "cjs";',
        "node_modules/user/package.json": JSON.stringify({ name: "user", main: "index.js" }),
        "node_modules/user/index.js": 'module.exports = require("dual");',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import user from "user";\nexport { user };\nexport const later = () => import("dual");\n',
        ["dual"],
      );
      assertEquals(mod.user, "cjs");
      const code = await readFile(`${projectDir}/handler.mjs`, "utf8");
      assert(code.includes('import("dual")'), code);
    });
  });

  it("bundles a dependency's own copy of a package the project keeps external", async () => {
    await inProject(async (projectDir) => {
      const esm = (value: string) => ({
        "package.json": JSON.stringify({ name: "esmpkg", type: "module", main: "index.js" }),
        "index.js": `export default ${JSON.stringify(value)};`,
      });
      const files: Record<string, string> = {
        "node_modules/user/package.json": JSON.stringify({
          name: "user",
          type: "module",
          main: "index.js",
        }),
        "node_modules/user/index.js": 'export { default } from "esmpkg";',
        "node_modules/other/package.json": JSON.stringify({
          name: "other",
          type: "module",
          main: "index.js",
        }),
        "node_modules/other/index.js": 'export const load = () => import("esmpkg");',
      };
      for (const [name, contents] of Object.entries(esm("top"))) {
        files[`node_modules/esmpkg/${name}`] = contents;
      }
      for (const [name, contents] of Object.entries(esm("nested"))) {
        files[`node_modules/user/node_modules/esmpkg/${name}`] = contents;
      }
      await writeFiles(projectDir, files);
      const mod = await bundleAndImport(
        projectDir,
        'import user from "user";\nexport { user };\nexport { load } from "other";\n',
        ["esmpkg"],
      );
      assertEquals(mod.user, "nested");
      const code = await readFile(`${projectDir}/handler.mjs`, "utf8");
      // The dependency without its own copy still imports the project's.
      assert(code.includes('import("esmpkg")'), code);
      assert(!code.includes('"top"'), code);
    });
  });

  it("resolves a computed relative require from the bundled file's directory", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/loader/package.json": JSON.stringify({
          name: "loader",
          main: "lib/index.js",
        }),
        "node_modules/loader/lib/index.js": [
          "var name = ['p', 'g'].join('');",
          'exports.dialect = require("./dialects/" + name).name;',
          'exports.path = require.resolve("./dialects/" + name);',
          "exports.kind = typeof require;",
          'exports.static = require("./dialects/base").name;',
        ].join("\n"),
        "node_modules/loader/lib/dialects/pg.js": 'exports.name = "pg";',
        "node_modules/loader/lib/dialects/base.js": 'exports.name = "base";',
        // A project file at the same relative path must not be picked.
        "dialects/pg.js": 'exports.name = "project";',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import loader from "loader";\nexport { loader };\n',
      );
      assertEquals(mod.loader, {
        dialect: "pg",
        path: `${projectDir}/node_modules/loader/lib/dialects/pg.js`,
        kind: "function",
        static: "base",
      });
    });
  });

  it("gives a dependency that uses direct eval its own CommonJS names", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/evaler/package.json": JSON.stringify({ name: "evaler", main: "index.js" }),
        "node_modules/evaler/index.js": [
          '"use strict";',
          'exports.plugin = eval("require")("./plugin").name;',
          'exports.dir = eval("__dirname");',
          'exports.file = eval("__filename");',
          'exports.json = require("./data.json").v;',
          "exports.strict = (function () { return this; })() === undefined;",
        ].join("\n"),
        "node_modules/evaler/plugin.js": 'exports.name = "plugin";',
        "node_modules/evaler/data.json": '{"v":1}',
        "plugin.js": 'exports.name = "project";',
      });
      const mod = await bundleAndImport(
        projectDir,
        'import evaler from "evaler";\nexport { evaler };\n',
      );
      assertEquals(mod.evaler, {
        plugin: "plugin",
        dir: `${projectDir}/node_modules/evaler`,
        file: `${projectDir}/node_modules/evaler/index.js`,
        json: 1,
        strict: true,
      });
    });
  });

  it("imports the file an external package's exports map a subpath to", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/esmpkg/package.json": JSON.stringify({
          name: "esmpkg",
          type: "module",
          exports: { ".": "./index.js", "./feature": "./dist/feature.js" },
        }),
        "node_modules/esmpkg/index.js": 'export default "root";',
        "node_modules/esmpkg/dist/feature.js": 'export default "feature";',
        "node_modules/other/package.json": JSON.stringify({
          name: "other",
          type: "module",
          main: "index.js",
        }),
        "node_modules/other/index.js": 'export const load = () => import("esmpkg/feature");',
      });
      const mod = await bundleAndImport(projectDir, 'export { load } from "other";\n', ["esmpkg"]);
      const feature = await (mod.load as () => Promise<{ default: string }>)();
      assertEquals(feature.default, "feature");
    });
  });

  it("resolves a dependency's import.meta.resolve of its own #import", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/hashed/package.json": JSON.stringify({
          name: "hashed",
          type: "module",
          main: "index.js",
          imports: { "#worker": "./worker.js" },
        }),
        "node_modules/hashed/index.js": 'export const worker = import.meta.resolve("#worker");',
        "node_modules/hashed/worker.js": "export {};",
      });
      const mod = await bundleAndImport(projectDir, 'export * from "hashed";\n');
      assertEquals(
        mod.worker,
        pathToFileURL(`${projectDir}/node_modules/hashed/worker.js`).href,
      );
    });
  });

  it("hands a project resolver's target inside a dependency to the file namespace", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/pkg/lib/index.js": "module.exports = __dirname;",
        "node_modules/pkg/data.json": "{}",
        "src/own.ts": "export {};",
      });
      const isDependencyFile = await createDependencyFilePredicate(projectDir, hostFs);
      assertEquals(
        await dependencyTarget(`${projectDir}/node_modules/pkg/lib/index`, "?v", isDependencyFile),
        { path: `${projectDir}/node_modules/pkg/lib/index.js`, suffix: "?v" },
      );
      assertEquals(
        await dependencyTarget(
          `${projectDir}/node_modules/pkg/data.json`,
          undefined,
          isDependencyFile,
        ),
        { path: `${projectDir}/node_modules/pkg/data.json` },
      );
      // Project files and missing files stay with the resolver's own namespace.
      assertEquals(
        await dependencyTarget(`${projectDir}/src/own`, undefined, isDependencyFile),
        undefined,
      );
      assertEquals(
        await dependencyTarget(
          `${projectDir}/node_modules/pkg/missing`,
          undefined,
          isDependencyFile,
        ),
        undefined,
      );
    });
  });

  it("rejects a native addon at build time", async () => {
    await inProject(async (projectDir) => {
      await writeFiles(projectDir, {
        "node_modules/native/package.json": JSON.stringify({ name: "native", main: "index.js" }),
        "node_modules/native/index.js": 'module.exports = require("./build/binding.node");',
        "node_modules/native/build/binding.node": "not a real addon",
      });
      const error = await assertRejects(() =>
        bundleAndImport(projectDir, 'import native from "native";\nexport { native };\n')
      );
      assert(
        String((error as Error).message).includes(
          'Native addons are not supported in API routes: "binding.node"',
        ),
        String(error),
      );
    });
  });
});
