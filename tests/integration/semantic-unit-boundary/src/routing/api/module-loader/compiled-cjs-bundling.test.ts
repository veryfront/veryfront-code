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
  PackageTypeLookup,
  prepareDependencyFile,
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
      build.onLoad({ filter: /\.[cm]?js$/ }, async (args) => {
        if (!isDependencyFile(args.path)) return undefined;
        const contents = await readFile(args.path, "utf8");
        return {
          contents: await prepareDependencyFile({
            build,
            contents,
            logicalPath: args.path,
            resolvedPath: args.path,
            packageType: await packageTypes.of(args.path.slice(0, args.path.lastIndexOf("/"))),
            isDependencyFile,
            isFile,
            rewriteImportMeta: (source) => Promise.resolve(source),
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
): Promise<Record<string, unknown>> {
  const requiredBuiltins = new Set<string>();
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
        createCompiledBuiltinPlugin(requiredBuiltins),
        createDependencyResolvePlugin(isDependencyFile, isFile),
        dependencyFilePlugin(projectDir, isDependencyFile),
      ],
    });
    const code = prependRuntimeRequire(
      result.outputFiles?.[0]?.text ?? "",
      requiredBuiltins,
      projectDir,
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
      });
      await symlink("../packages/wsorder", `${projectDir}/node_modules/wsorder`);
      const mod = await bundleAndImport(
        projectDir,
        'import order from "order";\nimport modonly from "modonly";\nimport wsorder from "wsorder";\n' +
          "export const picked = [order.impl, order.data, modonly, wsorder];\n",
      );
      assertEquals(mod.picked, ["js", "json", "index", "js"]);
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
        String((error as Error).message).includes("Native addons are not supported"),
        String(error),
      );
    });
  });
});
