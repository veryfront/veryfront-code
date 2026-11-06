import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type { Plugin } from "veryfront/extensions/bundler";
import {
  commonJSPathPrelude,
  createCompiledBuiltinPlugin,
  prependBuiltinRequire,
} from "#veryfront/routing/api/module-loader/compiled-cjs-bundling.ts";

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const path = `${root}/${relative}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, contents);
  }
}

/** Defines __dirname/__filename for node_modules files, as the route build does. */
const pathPreludePlugin: Plugin = {
  name: "test-path-prelude",
  setup(build) {
    build.onLoad({ filter: /node_modules[\\/].*\.c?js$/ }, async (args) => {
      const contents = await Deno.readTextFile(args.path);
      return { contents: commonJSPathPrelude(contents, args.path) + contents, loader: "js" };
    });
  },
};

/** Bundles a route the way the compiled binary does and imports the result. */
async function bundleAndImport(
  projectDir: string,
  route: string,
): Promise<Record<string, unknown>> {
  const requiredBuiltins = new Set<string>();
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
    plugins: [createCompiledBuiltinPlugin(requiredBuiltins), pathPreludePlugin],
  });
  const code = prependBuiltinRequire(result.outputFiles?.[0]?.text ?? "", requiredBuiltins);
  const file = `${projectDir}/handler.mjs`;
  await Deno.writeTextFile(file, code);
  return await import(`file://${file}`);
}

// The compiled binary bundles a route's CommonJS dependencies (inbox#4177).
describe("compiled-binary route bundling of CommonJS dependencies", () => {
  describe("bundling a route's CommonJS dependency", () => {
    it("runs exports maps, built-in and JSON requires, __dirname and optional requires", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-cjs-bundle-" });
      try {
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
      } finally {
        await esbuild.stop();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a native addon at build time", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-cjs-bundle-" });
      try {
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
      } finally {
        await esbuild.stop();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});
