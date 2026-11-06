import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type { Plugin } from "veryfront/extensions/bundler";
import {
  createCompiledBuiltinPlugin,
  prepareDependencyFile,
  prependRuntimeRequire,
} from "#veryfront/routing/api/module-loader/compiled-cjs-bundling.ts";

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const path = `${root}/${relative}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, contents);
  }
}

/** The `type` of the package.json nearest a file, as the route build reads it. */
async function packageTypeOf(filePath: string, root: string): Promise<string | undefined> {
  for (let dir = filePath.slice(0, filePath.lastIndexOf("/")); dir.startsWith(root);) {
    try {
      return JSON.parse(await Deno.readTextFile(`${dir}/package.json`)).type;
    } catch {
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
  }
  return undefined;
}

/** Prepares node_modules files the way the compiled route build does. */
function dependencyFilePlugin(projectDir: string): Plugin {
  const isDependencyFile = (path: string) => path.startsWith(`${projectDir}/node_modules/`);
  return {
    name: "test-dependency-files",
    setup(build) {
      build.onLoad({ filter: /node_modules[\\/].*\.[cm]?js$/ }, async (args) => {
        const contents = await Deno.readTextFile(args.path);
        return {
          contents: await prepareDependencyFile({
            build,
            contents,
            logicalPath: args.path,
            resolvedPath: args.path,
            packageType: await packageTypeOf(args.path, projectDir),
            isDependencyFile,
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
  try {
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      mainFields: ["main", "module"],
      conditions: ["node"],
      resolveExtensions: [".ts", ".js", ".mjs", ".json"],
      logLevel: "silent",
      stdin: {
        contents: route,
        loader: "ts",
        resolveDir: projectDir,
        sourcefile: `${projectDir}/route.ts`,
      },
      plugins: [createCompiledBuiltinPlugin(requiredBuiltins), dependencyFilePlugin(projectDir)],
    });
    const code = prependRuntimeRequire(
      result.outputFiles?.[0]?.text ?? "",
      requiredBuiltins,
      projectDir,
    );
    const file = `${projectDir}/handler.mjs`;
    await Deno.writeTextFile(file, code);
    return await import(`file://${file}`);
  } finally {
    await esbuild.stop();
  }
}

/** Runs a test in a fresh project directory, with symlinks in its path followed. */
function inProject(fn: (projectDir: string) => Promise<void>): Promise<void> {
  return withTempDir((dir) => fn(Deno.realPathSync(dir)), { prefix: "vf-cjs-bundle-" });
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
          "var outside;",
          'var hosts = ["", "etc", "hosts"].join("/");',
          "try { require(hosts); } catch (error) { outside = [error.code, error.message]; }",
          "exports.outside = outside;",
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
        outside: [
          "MODULE_NOT_FOUND",
          'Cannot find module "a path outside this project or missing"',
        ],
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
      const mod = await bundleAndImport(
        projectDir,
        'import { mode as a } from "scoped";\nimport { mode as b } from "plain";\nexport const modes = [a, b];\n',
      );
      assertEquals(mod.modes, ["undefined", "undefined"]);
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
