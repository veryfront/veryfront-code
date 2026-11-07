import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
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
  PackageTypeLookup,
  prepareDependencyFile,
  prepareDependencyJson,
  prependRuntimeRequire,
} from "#veryfront/routing/api/module-loader/compiled-cjs-bundling.ts";

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
          return { contents: prepareDependencyJson(contents, args.path), loader: "js" };
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
    const code = prependRuntimeRequire(
      result.outputFiles?.[0]?.text ?? "",
      projectDir,
      await dependencyDirectories(projectDir, hostFs),
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
        }),
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
          "let bare;",
          'try { resolve(["oth", "er"].join("")); } catch (error) { bare = error.code; }',
          "export const computedBare = bare;",
        ].join("\n"),
        "node_modules/other/package.json": JSON.stringify({ name: "other", main: "main.js" }),
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
        computedBare: "ERR_MODULE_NOT_FOUND",
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
