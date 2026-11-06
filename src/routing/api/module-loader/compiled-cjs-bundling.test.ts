import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type PluginBuild, stop as stopBundler } from "veryfront/extensions/bundler";
import {
  builtinModuleName,
  createCompiledBuiltinPlugin,
  createDependencyFilePredicate,
  createDependencyResolvePlugin,
  createImportExternalsPlugin,
  createImportMetaResolve,
  createNativeAddonPlugin,
  createRuntimeRequire,
  nodePreferredFile,
  nodeRelativeFile,
  PackageTypeLookup,
  prepareCommonJSFile,
  prepareDependencyFile,
  prepareDependencyJson,
  prepareModuleFile,
  prependRuntimeRequire,
  registerBundledModule,
  resolveLiteralCalls,
  rewriteImportSpecifiers,
  type RuntimeRequireHost,
} from "./compiled-cjs-bundling.ts";

type ResolveHandler = (args: Record<string, unknown>) => unknown;
type Plugin = { setup(build: PluginBuild): void | Promise<void> };

/** The onResolve or onLoad handlers a plugin registers, in order. */
async function handlers(plugin: Plugin, hook: "onResolve" | "onLoad"): Promise<ResolveHandler[]> {
  const registered: ResolveHandler[] = [];
  const register = (_options: unknown, handler: ResolveHandler) => registered.push(handler);
  const build = {
    onResolve: hook === "onResolve" ? register : () => {},
    onLoad: hook === "onLoad" ? register : () => {},
    onDispose: () => {},
  };
  await plugin.setup(build as unknown as PluginBuild);
  return registered;
}

const resolveHandlers = (plugin: Plugin) => handlers(plugin, "onResolve");

/** Throws the code of the error `fn` throws, or undefined. */
function errorCode(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
}

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

    it("walks up from a path under the canonical root as well", async () => {
      const both = new PackageTypeLookup(
        (path) =>
          Promise.resolve(
            path === "/real/app/node_modules/esm/package.json"
              ? JSON.stringify({ type: "module" })
              : null,
          ),
        ["/app", "/real/app"],
      );
      assertEquals(await both.of("/real/app/node_modules/esm/lib/deep"), "module");
    });

    it("stops at node_modules, as Node does, so a package without a manifest is CommonJS", async () => {
      assertEquals(await lookup().of("/app/node_modules/bare/lib"), undefined);
      assertEquals(await lookup().of("/app/node_modules/@scope/bare"), undefined);
    });
  });

  describe("nodePreferredFile()", () => {
    const files = new Set(["/d/impl.js", "/d/lib/index.js", "/d/data.json", "/d/entry.js"]);
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
      // Node checks the exact path before adding an extension.
      assertEquals(await nodePreferredFile("/d/entry", "./entry", "/d", isFile), "/d/entry");
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

  describe("createDependencyFilePredicate()", () => {
    const links: Record<string, string> = {
      "/app": "/real/app",
      "/real/app/node_modules/linked": "/real/app/packages/linked",
      "/real/app/node_modules/@s/w": "/real/app/packages/w",
      "/real/app/node_modules/@ls": "/real/app/packages/ls",
      "/real/app/node_modules/out": "/elsewhere/out",
      "/real/app/node_modules/self": "/real/app",
      "/real/app/node_modules/inner": "/real/app/node_modules/plain",
    };
    const entries: Record<string, { name: string; isDirectory: boolean; isSymlink?: boolean }[]> = {
      "/real/app/node_modules": [
        { name: "linked", isDirectory: false, isSymlink: true },
        { name: "@s", isDirectory: true, isSymlink: false },
        { name: "@ls", isDirectory: false, isSymlink: true },
        { name: "plain", isDirectory: true, isSymlink: false },
        { name: "out", isDirectory: false },
        { name: "self", isDirectory: false, isSymlink: true },
        { name: "inner", isDirectory: false, isSymlink: true },
        { name: "dead", isDirectory: false, isSymlink: true },
      ],
      "/real/app/node_modules/@s": [{ name: "w", isDirectory: false, isSymlink: true }],
      "/real/app/node_modules/@ls": [{ name: "pkg", isDirectory: true, isSymlink: false }],
    };
    const fs = {
      realPath(path: string) {
        if (path.endsWith("/dead")) return Promise.reject(new Error("dangling"));
        return Promise.resolve(links[path] ?? path);
      },
      async *readDir(path: string) {
        const listed = entries[path];
        if (!listed) throw new Error("no such directory");
        yield* listed;
      },
    };

    it("counts node_modules under both roots and in-project workspace links", async () => {
      const isDependency = await createDependencyFilePredicate("/app", fs);
      assert(isDependency("/app/node_modules/x/index.js"));
      assert(isDependency("/real/app/node_modules/x/index.js"));
      assert(isDependency("/real/app/packages/linked/index.js"));
      assert(isDependency("/real/app/packages/w/index.js"));
      // A linked scope directory holds plain package directories.
      assert(isDependency("/real/app/packages/ls/pkg/index.js"));
    });

    it("never counts project code, the project root or targets outside the project", async () => {
      const isDependency = await createDependencyFilePredicate("/app", fs);
      assert(!isDependency("/real/app/pages/api/route.ts"));
      assert(!isDependency("/real/app/package.json"));
      assert(!isDependency("/elsewhere/out/index.js"));
      assert(!isDependency(""));
    });

    it("uses the given root when the project has no host directory", async () => {
      const isDependency = await createDependencyFilePredicate("/virtual", {
        realPath: () => Promise.reject(new Error("no host directory")),
        readDir: fs.readDir,
      });
      assert(isDependency("/virtual/node_modules/x/index.js"));
      assert(!isDependency("/virtual/pages/index.ts"));
    });
  });

  describe("createCompiledBuiltinPlugin()", () => {
    it("keeps built-ins external, with a required id unchanged", async () => {
      const [builtins] = await resolveHandlers(createCompiledBuiltinPlugin(() => true));
      assertEquals(builtins!({ path: "fs", kind: "require-call", importer: "/d/a.js" }), {
        path: "fs",
        external: true,
      });
      assertEquals(builtins!({ path: "path", kind: "import-statement", importer: "/d/a.js" }), {
        path: "node:path",
        external: true,
      });
      assertEquals(
        builtins!({ path: "left-pad", kind: "require-call", importer: "/d/a.js" }),
        undefined,
      );
    });

    it("leaves other importers to the resolvers after it", async () => {
      const [builtins] = await resolveHandlers(
        createCompiledBuiltinPlugin((importer) => importer.includes("/node_modules/")),
      );
      assertEquals(
        builtins!({ path: "fs", kind: "import-statement", importer: "/d/src/route.ts" }),
        undefined,
      );
      assertEquals(
        builtins!({ path: "fs", kind: "import-statement", importer: "/d/node_modules/p/a.js" }),
        { path: "node:fs", external: true },
      );
    });
  });

  describe("createNativeAddonPlugin()", () => {
    it("rejects a native addon once it is loaded, naming only the file", async () => {
      assertEquals(await resolveHandlers(createNativeAddonPlugin()), []);
      const [native] = await handlers(createNativeAddonPlugin(), "onLoad");
      assertEquals(native!({ path: "/srv/app/node_modules/x/build/addon.node" }), {
        errors: [{ text: 'Native addons are not supported in API routes: "addon.node"' }],
      });
    });
  });

  describe("createDependencyResolvePlugin()", () => {
    const files = new Set(["/d/node_modules/p/impl.js", "/d/node_modules/p/addon.node"]);
    const isFile = (path: string) => Promise.resolve(files.has(path));
    const isDependency = (path: string) => path.startsWith("/d/node_modules/");
    const args = (path: string, importer = "/d/node_modules/p/index.js") => ({
      path,
      importer,
      resolveDir: importer.slice(0, importer.lastIndexOf("/")),
      kind: "require-call",
    });

    it("resolves a dependency's relative import in Node's order", async () => {
      const [, handler] = await resolveHandlers(
        createDependencyResolvePlugin(isDependency, isFile),
      );
      assertEquals(await handler!(args("./impl")), { path: "/d/node_modules/p/impl.js" });
      assertEquals(await handler!(args("./missing")), undefined);
      assertEquals(await handler!(args("./impl", "/d/pages/api/route.ts")), undefined);
    });

    it("leaves a native addon found by Node's extension order to the loader", async () => {
      const [, handler] = await resolveHandlers(
        createDependencyResolvePlugin(isDependency, isFile),
      );
      assertEquals(await handler!(args("./addon")), { path: "/d/node_modules/p/addon.node" });
    });

    it("resolves a linked workspace package's package imports from its node_modules", async () => {
      const calls: unknown[] = [];
      const build = {
        onResolve: (options: { filter: RegExp }, handler: ResolveHandler) => {
          filters.push(options.filter);
          registered.push(handler);
        },
        onLoad: () => {},
        resolve: (path: string, options: Record<string, unknown>) => {
          calls.push({ path, ...options });
          // Only /d/node_modules exists, as the bundler needs.
          return Promise.resolve(
            path === "missing" || options.resolveDir !== "/d/node_modules"
              ? { errors: [{ text: "Could not resolve" }] }
              : { path: "/d/node_modules/pg/index.js", errors: [], suffix: "?q" },
          );
        },
      };
      const registered: ResolveHandler[] = [];
      const filters: RegExp[] = [];
      const workspace = (path: string) => path.startsWith("/d/packages/") || isDependency(path);
      await createDependencyResolvePlugin(workspace, isFile).setup(
        build as unknown as PluginBuild,
      );
      const [bare] = registered;
      // A package's own `#import` resolves from its package.json, as before.
      assertEquals(["pg", "@s/p", "#own", "./x", "/x"].map((id) => filters[0]!.test(id)), [
        true,
        true,
        false,
        false,
        false,
      ]);
      const result = await bare!({ ...args("pg", "/d/packages/w/index.js") });
      assertEquals((result as { path: string }).path, "/d/node_modules/pg/index.js");
      assertEquals((result as { suffix: string }).suffix, "?q");
      const tried = (path: string, ...dirs: string[]) =>
        dirs.map((resolveDir) => ({
          path,
          kind: "require-call",
          importer: "/d/packages/w/index.js",
          resolveDir,
          pluginData: { vfFromNodeModules: true },
        }));
      assertEquals(
        calls,
        tried("pg", "/d/packages/w/node_modules", "/d/packages/node_modules", "/d/node_modules"),
      );
      calls.length = 0;
      assertEquals(await bare!({ ...args("missing", "/d/packages/w/index.js") }), {
        errors: [{ text: "Could not resolve" }],
      });
      // Its own second resolution, files in node_modules, project code and
      // built-ins resolve as before.
      assertEquals(
        await bare!({
          ...args("pg", "/d/packages/w/index.js"),
          pluginData: { vfFromNodeModules: true },
        }),
        undefined,
      );
      assertEquals(await bare!(args("pg")), undefined);
      assertEquals(await bare!(args("pg", "/d/pages/api/route.ts")), undefined);
      assertEquals(await bare!(args("fs", "/d/packages/w/index.js")), undefined);
      assertEquals(
        await bare!(args("data:text/javascript,1", "/d/packages/w/index.js")),
        undefined,
      );
      assertEquals(
        calls,
        tried(
          "missing",
          "/d/packages/w/node_modules",
          "/d/packages/node_modules",
          "/d/node_modules",
          "/node_modules",
        ),
      );
    });
  });

  describe("createImportExternalsPlugin()", () => {
    it("keeps imports of the packages external and leaves require() to the bundler", async () => {
      const [handler] = await resolveHandlers(createImportExternalsPlugin(["dual", "@s/p.js"]));
      for (const kind of ["import-statement", "dynamic-import"]) {
        assertEquals(handler!({ path: "dual/sub", kind }), { path: "dual/sub", external: true });
      }
      assertEquals(handler!({ path: "@s/p.js", kind: "import-statement" }), {
        path: "@s/p.js",
        external: true,
      });
      assertEquals(handler!({ path: "dual", kind: "require-call" }), undefined);
      assertEquals(handler!({ path: "dual", kind: "require-resolve" }), undefined);
    });

    it("registers nothing without packages", async () => {
      assertEquals(await resolveHandlers(createImportExternalsPlugin([])), []);
    });
  });

  describe("prepareDependencyFile() without parsing", () => {
    const input = (contents: string, logicalPath: string, packageType?: string) => ({
      build: {} as PluginBuild,
      contents,
      logicalPath,
      resolvedPath: logicalPath,
      packageType,
      isDependencyFile: () => true,
      isFile: () => Promise.resolve(false),
    });

    it("registers a file that reads no CommonJS names and no import.meta, unparsed", async () => {
      const contents = 'module.exports = require("./other");';
      assertEquals(
        await prepareDependencyFile(input(contents, "/d/a.js")),
        registerBundledModule(contents, "/d/a.js"),
      );
      assertEquals(
        await prepareDependencyFile(input(contents, "/d/bin/tool")),
        registerBundledModule(contents, "/d/bin/tool"),
      );
      assertEquals(
        await prepareDependencyFile(input(contents, "/d/a.cjs", "module")),
        registerBundledModule(contents, "/d/a.cjs"),
      );
      // An ES module has no `module` to register.
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.js", "module")), contents);
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.mjs")), contents);
    });

    it("registers a module object by its path after the module's own code", () => {
      const code = registerBundledModule("module.exports = 1;", '/d/"q".js');
      const registered: unknown[] = [];
      new Function("module", "__vf_register_bundled_module", code)(
        { exports: 2 },
        (path: string, module: unknown) => registered.push([path, module]),
      );
      assertEquals(registered, [['/d/"q".js', { exports: 1 }]]);
      // Outside a CommonJS module, or without the registry, it does nothing.
      const bare = registerBundledModule("", "/d/esm.js");
      new Function("module", "__vf_register_bundled_module", bare)(undefined, () => {
        throw new Error("registered");
      });
      new Function("module", bare)(null);
      new Function("module", code)({ exports: 0 });
    });

    it("turns dependency JSON into a module that registers itself and rejects bad JSON", () => {
      const code = prepareDependencyJson('{"a":[1]}', "/d/data.json");
      const registered: Array<{ exports: unknown }> = [];
      const module = { exports: {} };
      new Function("module", "__vf_register_bundled_module", code)(
        module,
        (_path: string, value: { exports: unknown }) => registered.push(value),
      );
      assertEquals(module.exports, { a: [1] });
      assert(registered[0] === module);
      assertThrows(() => prepareDependencyJson("{", "/d/bad.json"), SyntaxError);
      const bom = { exports: {} };
      new Function("module", prepareDependencyJson('\uFEFF{"b":2}', "/d/bom.json"))(bom);
      assertEquals(bom.exports, { b: 2 });
    });

    it("leaves files that are neither JavaScript nor CommonJS alone", async () => {
      const contents = "export const d = __dirname;";
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.ts")), contents);
    });
  });

  describe("rewriteImportSpecifiers()", () => {
    it("rewrites parsed imports and leaves strings that read like imports", async () => {
      const code = [
        'import a from "fs";',
        'const later = () => import("fs");',
        "const text = 'from \"fs\"';",
        "const call = 'import(\"fs\")';",
        'export * from "dep/sub";',
      ].join("\n");
      const probes: string[] = [];
      const rewritten = await rewriteImportSpecifiers(code, (probe) => {
        probes.push(probe);
        return Promise.resolve(
          probe.replaceAll('"fs"', '"node:fs"').replaceAll('"dep/sub"', '"file:///d/sub.js"'),
        );
      });
      assertEquals(probes, ['export * from "fs";\nexport * from "dep/sub";']);
      assertEquals(
        rewritten,
        [
          'import a from "node:fs";',
          'const later = () => import("node:fs");',
          "const text = 'from \"fs\"';",
          "const call = 'import(\"fs\")';",
          'export * from "file:///d/sub.js";',
        ].join("\n"),
      );
    });

    it("skips a module without imports and fails closed on a lost import", async () => {
      assertEquals(
        await rewriteImportSpecifiers("export const a = 1;", () => Promise.reject()),
        "export const a = 1;",
      );
      const error = await rewriteImportSpecifiers('import "fs";', () => Promise.resolve("")).then(
        () => null,
        (caught: Error) => caught.message,
      );
      assertEquals(error, "[API] handler build failed: import specifiers could not be rewritten");
    });
  });

  describe("resolveLiteralCalls()", () => {
    it("replaces resolved literal calls once per specifier and keeps the rest", async () => {
      const asked: string[] = [];
      const code = await resolveLiteralCalls(
        `M("./a"); M('./a'); M("missing"); M(name); const r = M; M("x\\"y");`,
        "M",
        (specifier) => {
          asked.push(specifier);
          return Promise.resolve(specifier === "./a" ? "/d/a.js" : null);
        },
      );
      assertEquals(
        code,
        `"/d/a.js"; "/d/a.js"; M("missing"); M(name); const r = M; M("x\\"y");`,
      );
      assertEquals(asked, ["./a", "missing"]);
    });
  });

  describe("createImportMetaResolve()", () => {
    const resolve = createImportMetaResolve(
      "file:///app/node_modules/p/index.js",
      ["test"],
      (id) => (id === "fs" || id === "test" ? {} : undefined),
    );

    it("resolves URLs and relative paths against the module", () => {
      assertEquals(resolve("./data.json"), "file:///app/node_modules/p/data.json");
      assertEquals(resolve("../q"), "file:///app/node_modules/q");
      assertEquals(resolve("/etc/x"), "file:///etc/x");
      assertEquals(resolve("node:path"), "node:path");
      assertEquals(resolve("https://example.com/a"), "https://example.com/a");
    });

    it("gives built-ins their node: id and rejects package names", () => {
      assertEquals(resolve("fs"), "node:fs");
      assertEquals(errorCode(() => resolve("test")), "ERR_MODULE_NOT_FOUND");
      assertEquals(errorCode(() => resolve("left-pad")), "ERR_MODULE_NOT_FOUND");
    });
  });

  describe("createRuntimeRequire()", () => {
    const builtins: Record<string, unknown> = {
      fs: { kind: "fs" },
      "node:fs": { kind: "fs" },
      "vf-state": { loads: 0 },
    };
    const files: Record<string, string> = {
      "/app/data.json": '{"a":1}',
      "/app/link.json": "", // a link to /outside.json
      "/app/code.js": "module.exports = 'project';",
      "/app/node_modules/p/dialects/pg.js": [
        "exports.base = require('../base').name;",
        "exports.fs = require('fs').kind;",
        "exports.file = __filename;",
        "exports.self = this === exports;",
      ].join("\n"),
      "/app/node_modules/p/base.js": "#!/usr/bin/env node\nexports.name = 'base';",
      "/app/node_modules/p/dir/index.json": '{"dir":true}',
      "/app/node_modules/p/cycle-a.js":
        "exports.early = 1; exports.b = require('./cycle-b').seen; exports.late = 2;",
      "/app/node_modules/p/cycle-b.js": "exports.seen = require('./cycle-a').early;",
      "/app/node_modules/p/throws.js": "throw new Error('boom');",
      "/app/node_modules/p/bare.js": "require('lodash');",
      "/app/node_modules/p/dialects/mysql.js": [
        "exports.driver = require('driver').name;",
        "exports.sub = require('driver/extra').name;",
        "exports.scoped = require('@s/conds');",
        "exports.mainOnly = require('mainonly');",
        "exports.local = require('nested');",
      ].join("\n"),
      "/app/node_modules/driver/package.json": JSON.stringify({
        exports: {
          ".": { import: "./esm.mjs", require: "./cjs.js" },
          "./extra": "./extra.js",
        },
      }),
      "/app/node_modules/driver/cjs.js": "exports.name = 'driver';",
      "/app/node_modules/driver/extra.js": "exports.name = 'extra';",
      "/app/node_modules/@s/conds/package.json": JSON.stringify({
        exports: [{ browser: "./browser.js", default: "./node.js" }],
      }),
      "/app/node_modules/@s/conds/node.js": "module.exports = 'conds';",
      "/app/node_modules/mainonly/package.json": JSON.stringify({ main: "lib/entry" }),
      "/app/node_modules/mainonly/lib/entry.js": "module.exports = 'main';",
      "/app/node_modules/p/node_modules/nested/index.js": "module.exports = 'nested';",
      "/app/node_modules/p/sealed.js": "require('driver/hidden');",
      "/app/node_modules/p/split.js":
        "require.ensure(['./base'], function (r) { exports.base = r('./base').name; });",
      "/app/node_modules/p/meta.js": [
        "exports.id = module.id;",
        "exports.filename = module.filename;",
        "exports.path = module.path;",
        "exports.loadedDuring = module.loaded;",
        "exports.ownRequire = module.require === require;",
        "exports.cached = require.cache[__filename] === module;",
      ].join("\n"),
      "/app/node_modules/p/counter.js":
        "var state = require('vf-state'); state.loads++; module.exports = state.loads;",
      "/app/node_modules/p/addon.node": "",
      "/app/node_modules/p/esm.mjs": "export {};",
      "/app/node_modules/p/patterns.js": [
        "exports.feature = require('patterned/feature/a');",
        "exports.longest = require('patterned/feature/deep/b');",
        "exports.exact = require('patterned/exact');",
        "exports.own = require('#own');",
        "exports.ownPattern = require('#lib/x');",
        "exports.ownPackage = require('#dep');",
      ].join("\n"),
      "/app/node_modules/p/package.json": JSON.stringify({
        imports: {
          "#own": "./base.js",
          "#lib/*": "./lib/*.js",
          "#dep": "driver/extra",
          "#outside": "../escape.js",
        },
      }),
      "/app/node_modules/p/lib/x.js": "module.exports = 'lib x';",
      "/app/node_modules/p/no-import.js": "require('#missing');",
      "/app/node_modules/p/escape-import.js": "require('#outside');",
      "/app/node_modules/patterned/package.json": JSON.stringify({
        exports: {
          "./feature/*": "./features/*.js",
          "./feature/deep/*": { node: "./deep/*.js" },
          "./exact": "./exact.js",
          "./*.js": null,
        },
      }),
      "/app/node_modules/patterned/features/a.js": "module.exports = 'feature a';",
      "/app/node_modules/patterned/deep/b.js": "module.exports = 'deep b';",
      "/app/node_modules/patterned/exact.js": "module.exports = 'exact';",
      "/app/node_modules/p/broken-pkg.js": "require('broken');",
      "/app/node_modules/broken/package.json": "{",
      "/app/node_modules/broken/index.js": "module.exports = 'broken';",
      "/app/node_modules/p/outside-pattern.js": "require('patterned/feature/../../escape');",
      "/app/node_modules/p/bom.json": '\uFEFF{"bom":true}',
      "/app/node_modules/p/plugin/package.json": JSON.stringify({ main: "lib/main" }),
      "/app/node_modules/p/plugin/lib/main.js": "module.exports = 'plugin main';",
      "/app/node_modules/p/plugin/index.js": "module.exports = 'plugin index';",
      "/app/node_modules/p/dirmain/package.json": JSON.stringify({ main: "lib" }),
      "/app/node_modules/p/dirmain/lib/index.js": "module.exports = 'main dir index';",
      "/app/node_modules/p/badmain/package.json": JSON.stringify({ main: "missing" }),
      "/app/node_modules/p/badmain/index.js": "module.exports = 'fallback index';",
      "/app/node_modules/p/binding.node": "",
      "/app/node_modules/sibling.js": "module.exports = 'file beside the package';",
      "/app/node_modules/sibling/index.js": "module.exports = 'package';",
    };
    let reads = 0;
    const host: RuntimeRequireHost = {
      // Like Deno's, it knows bare prefix-only names that Node does not.
      getBuiltinModule: (id) => id === "test" ? { kind: "test" } : builtins[id],
      isFile: (path) => path in files,
      realpathSync: (path) => path === "/app/link.json" ? "/outside.json" : path,
      readFileSync: (path) => {
        reads++;
        return files[path]!;
      },
      compile: (source) =>
        new Function(
          "exports",
          "require",
          "module",
          "__filename",
          "__dirname",
          source,
        ) as ReturnType<
          RuntimeRequireHost["compile"]
        >,
      isAbsolute: (path) => path.startsWith("/"),
      relative: (from, to) =>
        to.startsWith(from + "/") ? to.slice(from.length + 1) : to === from ? "" : "../" + to,
      join: (...paths) => {
        const parts: string[] = [];
        for (const part of paths.join("/").split("/")) {
          if (part === "..") parts.pop();
          else if (part !== "." && part !== "") parts.push(part);
        }
        return "/" + parts.join("/");
      },
      dirname: (path) => path.slice(0, path.lastIndexOf("/")),
      sep: "/",
    };
    const { require, register } = createRuntimeRequire(
      host,
      "/app",
      ["test"],
      ["/app/node_modules"],
    );

    it("serves any built-in, including a computed id", () => {
      assertEquals(require("fs"), { kind: "fs" });
      assertEquals(require("node:" + "fs"), { kind: "fs" });
      assertEquals(require.resolve("fs"), "fs");
    });

    it("treats a bare prefix-only name as a package", () => {
      assertEquals(errorCode(() => require("test")), "MODULE_NOT_FOUND");
      assertEquals(errorCode(() => require.resolve("test")), "MODULE_NOT_FOUND");
    });

    it("loads project JSON once and resolves existing project paths", () => {
      const first = require("/app/data.json");
      assertEquals(first, { a: 1 });
      assert(require("/app/data.json") === first);
      assertEquals(reads, 1);
      assertEquals(require.resolve("/app/code.js"), "/app/code.js");
      assertEquals(require.resolve("/app/data"), "/app/data.json");
      assertEquals(require("/app/node_modules/p/dir"), { dir: true });
    });

    it("runs a dependency's JavaScript as CommonJS, once, with its own require", () => {
      const dialect = require("/app/node_modules/p/dialects/" + "pg");
      assertEquals(dialect, {
        base: "base",
        fs: "fs",
        file: "/app/node_modules/p/dialects/pg.js",
        self: true,
      });
      assert(require("/app/node_modules/p/dialects/pg.js") === dialect);
    });

    it("runs a require.ensure callback at once, at the top and in a loaded module", () => {
      let ensured: unknown;
      require.ensure([], (inner) => {
        ensured = inner("fs");
      });
      assertEquals(ensured, { kind: "fs" });
      assertEquals(require("/app/node_modules/p/split.js"), { base: "base" });
    });

    it("looks a package up from a loaded module, as Node's require() does", () => {
      assertEquals(require("/app/node_modules/p/dialects/mysql.js"), {
        driver: "driver",
        sub: "extra",
        scoped: "conds",
        mainOnly: "main",
        local: "nested",
      });
      for (const file of ["bare", "sealed"]) {
        assertEquals(
          errorCode(() => require(`/app/node_modules/p/${file}.js`)),
          "MODULE_NOT_FOUND",
          file,
        );
      }
    });

    it("hands a cycle the exports so far, as Node does", () => {
      assertEquals(require("/app/node_modules/p/cycle-a.js"), { early: 1, b: 1, late: 2 });
    });

    it("forgets a module whose body throws", () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let message: unknown;
        try {
          require("/app/node_modules/p/throws.js");
        } catch (error) {
          message = (error as Error).message;
        }
        assertEquals(message, "boom");
      }
    });

    it("fails closed for packages, project code and paths outside the project", () => {
      for (
        const id of [
          "left-pad",
          "./missing.json",
          42,
          "/app/code.js",
          "/app/link.json",
          "/app",
          "/app/node_modules/p/bare.js",
        ]
      ) {
        assertEquals(errorCode(() => require(id)), "MODULE_NOT_FOUND", String(id));
      }
      assertEquals(errorCode(() => require.resolve("/app/missing.js")), "MODULE_NOT_FOUND");
    });

    it("resolves a relative id from the project root", () => {
      assert(require("./data.json") === require("/app/data.json"));
      assertEquals(require.resolve("./data"), "/app/data.json");
      assertEquals(require.resolve("driver"), "/app/node_modules/driver/cjs.js");
    });

    it("gives each module Node's module object and shares one cache", () => {
      const meta = require("/app/node_modules/p/meta.js");
      assertEquals(meta, {
        id: "/app/node_modules/p/meta.js",
        filename: "/app/node_modules/p/meta.js",
        path: "/app/node_modules/p",
        loadedDuring: false,
        ownRequire: true,
        cached: true,
      });
      const cached = require.cache["/app/node_modules/p/meta.js"] as unknown as { loaded: boolean };
      assertEquals(cached.loaded, true);
    });

    it("reloads a module deleted from require.cache", () => {
      const first = require("/app/node_modules/p/counter.js");
      assertEquals(require("/app/node_modules/p/counter.js"), first);
      delete require.cache["/app/node_modules/p/counter.js"];
      assertEquals(require("/app/node_modules/p/counter.js"), (first as number) + 1);
    });

    it("returns a module the bundle registered, so both loads share it", () => {
      const bundled = { exports: { bundled: true } };
      register("/app/node_modules/p/registered.js", bundled);
      register("/app/node_modules/p/registered.js", { exports: { second: true } });
      // A path through a link is keyed by its real path.
      const linked = { exports: { linked: true } };
      register("/app/link.json", linked);
      assert(require.cache["/outside.json"] === linked);
      delete require.cache["/outside.json"];
      files["/app/node_modules/p/registered.js"] = "module.exports = { evaluated: true };";
      assert(require("/app/node_modules/p/" + "registered.js") === bundled.exports);
    });

    it("takes Node's paths option in require.resolve", () => {
      assertEquals(
        require.resolve("driver", { paths: ["/app/node_modules/p", 7, "relative"] }),
        "/app/node_modules/driver/cjs.js",
      );
      assertEquals(
        require.resolve("nested", { paths: ["/app/node_modules/p"] }),
        "/app/node_modules/p/node_modules/nested/index.js",
      );
      assertEquals(
        errorCode(() => require.resolve("nested", { paths: ["/app"] })),
        "MODULE_NOT_FOUND",
      );
      assertEquals(
        require.resolve("./base", { paths: ["/app/node_modules/p"] }),
        "/app/node_modules/p/base.js",
      );
    });

    it("loads a directory and an extension as Node does", () => {
      assertEquals(require("/app/node_modules/p/bom.json"), { bom: true });
      assertEquals(require("/app/node_modules/p/" + "plugin"), "plugin main");
      assertEquals(require("/app/node_modules/p/dirmain"), "main dir index");
      assertEquals(require("/app/node_modules/p/badmain"), "fallback index");
      assertEquals(errorCode(() => require("/app/node_modules/p/binding")), "ERR_DLOPEN_FAILED");
      assertEquals(
        require.resolve("/app/node_modules/p/binding"),
        "/app/node_modules/p/binding.node",
      );
      // A file named like the package comes first, as in Node.
      assertEquals(require("sibling"), "file beside the package");
    });

    it("rejects a native addon and an ES module with Node's codes", () => {
      assertEquals(errorCode(() => require("/app/node_modules/p/addon.node")), "ERR_DLOPEN_FAILED");
      assertEquals(errorCode(() => require("/app/node_modules/p/esm.mjs")), "ERR_REQUIRE_ESM");
    });

    it("matches exports patterns and the package's own imports", () => {
      assertEquals(require("/app/node_modules/p/patterns.js"), {
        feature: "feature a",
        longest: "deep b",
        exact: "exact",
        own: { name: "base" },
        ownPattern: "lib x",
        ownPackage: { name: "extra" },
      });
      for (const file of ["no-import", "escape-import", "broken-pkg", "outside-pattern"]) {
        assertEquals(
          errorCode(() => require(`/app/node_modules/p/${file}.js`)),
          "MODULE_NOT_FOUND",
          file,
        );
      }
    });

    it("names a project path relative to the project and hides any other", () => {
      const message = (id: string) => {
        try {
          require(id);
        } catch (error) {
          return (error as Error).message;
        }
      };
      assertEquals(message("/app/code.js"), 'Cannot find module "code.js"');
      assertEquals(
        message("/app/link.json"),
        'Cannot find module "a path outside this project or missing"',
      );
    });
  });

  describe("prependRuntimeRequire()", () => {
    it("binds require to the runtime require with the host built-ins", () => {
      const code = prependRuntimeRequire("export {};\n", "/app", ["/app/node_modules"]);
      assert(code.includes(createRuntimeRequire.toString()), code);
      assert(code.includes('import __vf_runtime_process from "node:process";'), code);
      assert(
        code.includes(
          '}, "/app", ["test","test/reporters","sqlite","sea"], ["/app/node_modules"]);',
        ),
        code,
      );
      assert(
        code.includes("const { require, register: __vf_register_bundled_module } = ("),
        code,
      );
      assert(code.endsWith("\nexport {};\n"), code);
    });

    it("keeps a hashbang on the first line", () => {
      const code = prependRuntimeRequire("#!/usr/bin/env node\nexport {};\n", "/app", []);
      assert(code.startsWith("#!/usr/bin/env node\nimport __vf_runtime_process from "), code);
    });

    it("picks helper names the bundle does not already use", () => {
      const code = prependRuntimeRequire("const __vf_runtime_fs = 1;\n", "/app", []);
      assert(code.includes("import * as __vf_runtime___fs from"), code);
    });
  });

  describe("parsing dependency files", () => {
    // The bundler parses each file; its service process must not outlive a test.
    afterEach(async () => {
      await stopBundler();
    });

    const resolveRelative = (specifier: string) =>
      Promise.resolve(specifier.startsWith("./") ? "/d/p/" + specifier.slice(2) + ".js" : null);

    describe("prepareCommonJSFile()", () => {
      it("binds __dirname and __filename and resolves require.resolve literals", async () => {
        const code = await prepareCommonJSFile(
          [
            "exports.d = __dirname;",
            "exports.f = __filename;",
            'exports.a = require.resolve("./a");',
            'exports.b = require.resolve("fs");',
            'exports.c = require.resolve("missing");',
            "exports.e = require.resolve(name);",
          ].join("\n"),
          "/d/p/index.cjs",
          "module",
          resolveRelative,
        );
        assert(code !== null);
        for (
          const part of [
            'exports.d = "/d/p";',
            'exports.f = "/d/p/index.cjs";',
            'exports.a = "/d/p/a.js";',
            'exports.b = "fs";',
            'exports.c = require.resolve("missing");',
            "exports.e = require.resolve(name);",
          ]
        ) {
          assert(code.includes(part), code);
        }
      });

      it("prepares an extensionless file and a .js file outside a module package", async () => {
        const entry = await prepareCommonJSFile(
          "exports.d = __dirname;",
          "/d/p/entry",
          "module",
          resolveRelative,
        );
        assert(entry?.includes('exports.d = "/d/p";'), String(entry));
        const js = await prepareCommonJSFile(
          "exports.d = __dirname;",
          "/d/p/a.js",
          undefined,
          resolveRelative,
        );
        assert(js?.includes('exports.d = "/d/p";'), String(js));
      });

      it("prepares a .jsx file as Node's .js loader would", async () => {
        const code = await prepareCommonJSFile(
          "exports.d = __dirname;",
          "/d/p/view.jsx",
          undefined,
          resolveRelative,
        );
        assert(code?.includes('exports.d = "/d/p";'), String(code));
      });

      it("prepares a .cts file as CommonJS TypeScript", async () => {
        const code = await prepareCommonJSFile(
          "const d: string = __dirname;\nexports.d = d;",
          "/d/p/index.cts",
          "module",
          resolveRelative,
        );
        assert(code?.includes('const d = "/d/p";'), String(code));
      });

      it("leaves files Node loads as ESM alone", async () => {
        const source = "export const d = typeof __dirname;";
        assertEquals(
          await prepareCommonJSFile(source, "/d/p/a.js", "module", resolveRelative),
          null,
        );
        assertEquals(
          await prepareCommonJSFile(source, "/d/p/a.js", undefined, resolveRelative),
          null,
        );
        assertEquals(
          await prepareCommonJSFile(source, "/d/p/entry", undefined, resolveRelative),
          null,
        );
        assertEquals(
          await prepareCommonJSFile(source, "/d/p/a.mjs", undefined, resolveRelative),
          null,
        );
      });
    });

    describe("prepareModuleFile()", () => {
      it("makes import.meta locations constants and resolves literals", async () => {
        const code = await prepareModuleFile(
          'export const u = import.meta.url;\nexport const f = import.meta.filename;\nexport const d = import.meta.dirname;\nexport const a = import.meta.resolve("./a");\n',
          "/d/p/index.mjs",
          resolveRelative,
        );
        for (
          const part of [
            'u = "file:///d/p/index.mjs"',
            'f = "/d/p/index.mjs"',
            'd = "/d/p"',
            'a = "/d/p/a.js"',
          ]
        ) {
          assert(code.includes(part), code);
        }
        assert(!code.includes("function __vf_import_meta_resolve_"), code);
      });

      it("yields the same output for the same file", async () => {
        const source = "export const r = import.meta.resolve(name);\n";
        assertEquals(
          await prepareModuleFile(source, "/d/p/a.mjs", resolveRelative),
          await prepareModuleFile(source, "/d/p/a.mjs", resolveRelative),
        );
      });

      it("binds other uses to a resolver of the file, after any hashbang", async () => {
        const code = await prepareModuleFile(
          "#!/usr/bin/env node\nconst meta = import.meta;\nexport const r = import.meta.resolve(name);\nexport const m = meta;\n",
          "/d/p/cli.ts",
          resolveRelative,
        );
        assert(code.startsWith("#!/usr/bin/env node\nfunction __vf_import_meta_resolve_"), code);
        assert(code.includes(createImportMetaResolve.toString()), code);
        assert(
          /const __vf_import_meta_resolve_\w+_meta = \{ url: "file:\/\/\/d\/p\/cli\.ts"/.test(code),
          code,
        );
      });
    });

    describe("prepareDependencyFile()", () => {
      const resolved: Record<string, { path?: string; external?: boolean; errors?: unknown[] }> = {
        "./a": { path: "/d/node_modules/p/a.js" },
        pkg: { path: "/d/node_modules/pkg/main.js" },
        ext: { path: "ext", external: true },
        project: { path: "/d/src/project.js" },
        broken: { errors: [{ text: "x" }] },
      };
      const build = {
        resolve: (specifier: string) => Promise.resolve(resolved[specifier] ?? { errors: [{}] }),
      } as unknown as PluginBuild;
      const input = (contents: string, logicalPath: string, withResolve = true) => ({
        build: withResolve ? build : ({} as PluginBuild),
        contents,
        logicalPath,
        resolvedPath: logicalPath,
        packageType: undefined,
        isDependencyFile: (path: string) => path.startsWith("/d/node_modules/"),
        isFile: () => Promise.resolve(false),
      });

      it("resolves require.resolve literals only to dependency files", async () => {
        const code = await prepareDependencyFile(
          input(
            ["./a", "ext", "project", "broken"].map((id) =>
              `require.resolve(${JSON.stringify(id)});`
            )
              .join("\n"),
            "/d/node_modules/p/index.js",
          ),
        );
        for (
          const part of [
            '"/d/node_modules/p/a.js";',
            'require.resolve("ext");',
            'require.resolve("project");',
            'require.resolve("broken");',
          ]
        ) {
          assert(code.includes(part), code);
        }
        const unresolved = await prepareDependencyFile(
          input('require.resolve("./a");', "/d/node_modules/p/index.js", false),
        );
        assert(unresolved.includes('require.resolve("./a");'), unresolved);
      });

      it("resolves import.meta.resolve literals in an ESM file", async () => {
        const code = await prepareDependencyFile(
          input(
            ["fs", "./x.js", "https://e.test/m.js", "pkg", "ext"].map((id) =>
              `import.meta.resolve(${JSON.stringify(id)});`
            ).join("\n"),
            "/d/node_modules/p/index.mjs",
          ),
        );
        for (
          const part of [
            '"node:fs";',
            '"file:///d/node_modules/p/x.js";',
            '"https://e.test/m.js";',
            '"file:///d/node_modules/pkg/main.js";',
            "_resolve_",
          ]
        ) {
          assert(code.includes(part), code);
        }
      });

      it("leaves an ESM file that reads no import.meta unchanged", async () => {
        const contents = "export const d = typeof __dirname;";
        assertEquals(
          await prepareDependencyFile(input(contents, "/d/node_modules/p/a.mjs")),
          contents,
        );
      });
    });
  });
});
