import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type PluginBuild, stop as stopBundler, transform } from "veryfront/extensions/bundler";
import {
  builtinModuleName,
  codeString,
  createCompiledBuiltinPlugin,
  createDependencyFilePredicate,
  createDependencyResolvePlugin,
  createImportExternalsPlugin,
  createImportMetaResolve,
  createNativeAddonPlugin,
  createRuntimeRequire,
  dependencyJsonLoad,
  nodePreferredFile,
  nodeRelativeFile,
  PackageTypeLookup,
  prepareCommonJSFile,
  prepareDependencyFile,
  prepareDependencyJson,
  prepareModuleFile,
  prependRuntimeRequire,
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
  describe("codeString()", () => {
    it("writes a string literal that cannot end a script or a line", () => {
      const value = "</script><!--\u2028\u2029\"'\\";
      const literal = codeString(value);
      assert(!/[<>\u2028\u2029]/.test(literal), literal);
      assertEquals(new Function(`return ${literal};`)(), value);
    });
  });

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

    it("reads a backslash-relative require() id as relative where the host does", async () => {
      assertEquals(
        await nodePreferredFile("/d/impl.ts", ".\\impl", "/d", isFile, "\\"),
        "/d/impl.js",
      );
      // Elsewhere a backslash is part of a name, as in Node.
      assertEquals(
        await nodePreferredFile("/d/impl.ts", ".\\impl", "/d", isFile, "/"),
        "/d/impl.ts",
      );
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

    it("reads a backslash in a require() id as a separator where the host does", async () => {
      const withPackage = new Set([...files, "/d/node_modules/p/dir/package.json"]);
      const resolved: unknown[] = [];
      const hooks: ResolveHandler[] = [];
      const build = {
        onResolve: (_options: unknown, handler: ResolveHandler) => hooks.push(handler),
        onLoad: () => {},
        onDispose: () => {},
        resolve: (path: string, options: { kind: string }) => {
          resolved.push([path, options.kind]);
          return Promise.resolve({ path: "/d/node_modules/p/dir/main.js", errors: [] });
        },
      };
      createDependencyResolvePlugin(
        isDependency,
        (path) => Promise.resolve(withPackage.has(path)),
        "\\",
      ).setup(build as unknown as PluginBuild);
      const handler = hooks[1]!;
      assertEquals(await handler(args(".\\impl")), { path: "/d/node_modules/p/impl.js" });
      // A directory whose package.json decides goes to the bundler as a path.
      assertEquals(
        ((await handler(args(".\\dir"))) as { path: string }).path,
        "/d/node_modules/p/dir/main.js",
      );
      assertEquals(resolved, [["./dir", "require-call"]]);
      // An import specifier is a URL: a backslash there is part of a name.
      assertEquals(await handler({ ...args(".\\impl"), kind: "import-statement" }), undefined);
      const [, posix] = await resolveHandlers(
        createDependencyResolvePlugin(isDependency, isFile, "/"),
      );
      assertEquals(await posix!(args(".\\impl")), undefined);
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
        assertEquals(await handler!({ path: "dual/sub", kind }), {
          path: "dual/sub",
          external: true,
        });
      }
      assertEquals(await handler!({ path: "@s/p.js", kind: "import-statement" }), {
        path: "@s/p.js",
        external: true,
      });
      assertEquals(await handler!({ path: "dual", kind: "require-call" }), undefined);
      assertEquals(await handler!({ path: "dual", kind: "require-resolve" }), undefined);
    });

    it("bundles a dependency's nested copy instead of the project's external one", async () => {
      // /d/node_modules/dual links to /d/store/dual; p holds its own copy.
      const resolved: Record<string, string> = {
        "/d/src/route.ts": "/d/store/dual/index.js",
        "/d/node_modules/p/index.js": "/d/node_modules/p/node_modules/dual/index.js",
        "/d/node_modules/q/index.js": "/d/store/dual/index.js",
      };
      const registered: ResolveHandler[] = [];
      const seen: unknown[] = [];
      const build = {
        onResolve: (_options: unknown, handler: ResolveHandler) => registered.push(handler),
        onLoad: () => {},
        resolve: (path: string, options: { importer: string; pluginData: unknown }) => {
          seen.push(options.pluginData);
          const target = path === "dual/feature" || path === "dual/query"
            ? "/d/store/dual/dist/feature.js"
            : resolved[options.importer];
          return Promise.resolve(
            path === "dual/missing" || target === undefined
              ? { errors: [{ text: "Could not resolve" }] }
              : {
                path: target,
                errors: [],
                namespace: "file",
                suffix: path === "dual/query" ? "?mode=x" : "",
              },
          );
        },
      };
      await createImportExternalsPlugin(["dual"], {
        isDependencyFile: (path) => path.startsWith("/d/node_modules/"),
        nodeModules: ["/d/node_modules", "/d/node_modules"],
        realPath: (path) =>
          Promise.resolve(path === "/d/node_modules/dual" ? "/d/store/dual" : path),
      }).setup(build as unknown as PluginBuild);
      const [handler] = registered;
      const args = (importer: string, path = "dual") => ({
        path,
        importer,
        kind: "import-statement",
        resolveDir: importer.slice(0, importer.lastIndexOf("/")),
      });
      const external = { path: "dual", external: true };
      assertEquals(await handler!(args("/d/node_modules/p/index.js")), {
        path: "/d/node_modules/p/node_modules/dual/index.js",
        namespace: "file",
        suffix: "",
        sideEffects: undefined,
        pluginData: undefined,
      });
      assertEquals(await handler!(args("/d/node_modules/q/index.js")), external);
      // A subpath names the file the package's exports map it to.
      assertEquals(await handler!(args("/d/node_modules/q/index.js", "dual/feature")), {
        path: "file:///d/node_modules/dual/dist/feature.js",
        external: true,
      });
      // A target's query is part of the module's URL, as in Node.
      assertEquals(await handler!(args("/d/node_modules/q/index.js", "dual/query")), {
        path: "file:///d/node_modules/dual/dist/feature.js?mode=x",
        external: true,
      });
      // Route code and the plugin's own lookup stay as before.
      assertEquals(await handler!(args("/d/src/route.ts")), external);
      // A copy that refuses the path fails the build, as Node would fail.
      assertEquals(await handler!(args("/d/node_modules/p/index.js", "dual/missing")), {
        errors: [{ text: "Could not resolve" }],
      });
      assertEquals(
        await handler!({ ...args("/d/node_modules/p/index.js"), pluginData: seen[0] }),
        undefined,
      );
      assertEquals(seen.length, 5);
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

    it("leaves a file that reads no CommonJS names and no import.meta as it is", async () => {
      const contents = 'module.exports = require("./other");';
      for (
        const [path, type] of [["/d/a.js"], ["/d/bin/tool"], ["/d/a.cjs", "module"], ["/d/a.ts"]]
      ) {
        assertEquals(await prepareDependencyFile(input(contents, path!, type)), contents);
      }
      const esm = 'export { x } from "./other";';
      assertEquals(await prepareDependencyFile(input(esm, "/d/a.js", "module")), esm);
      assertEquals(await prepareDependencyFile(input(esm, "/d/a.mjs")), esm);
    });

    it("prepares a file with an extension Node has no loader for as CommonJS", async () => {
      // Node's require() runs it as CommonJS even in a `"type": "module"` scope.
      for (const type of [undefined, "module"]) {
        const code = await prepareDependencyFile(
          input(
            "module.exports = [__filename, arguments.length];",
            "/d/node_modules/p/entry.foo",
            type,
          ),
        );
        assert(code.includes('module.exports = ["/d/node_modules/p/entry.foo", '), code);
        assert(code.includes("return arguments;"), code);
      }
    });

    it("gives an ES module no require binding, as Node does", async () => {
      for (const [path, type] of [["/d/a.mjs"], ["/d/a.js", "module"], ["/d/a.mts"]]) {
        const code = await prepareDependencyFile(
          input("export const kind = typeof require;", path!, type),
        );
        const kind = new Function(
          "require",
          code.replace("export const kind =", "return"),
        )(() => "route");
        assertEquals(kind, "undefined", code);
      }
      // An ES module is strict: assigning the unbound name throws.
      const assigned = await prepareDependencyFile(
        input("export function swap() { require = () => 1; }", "/d/a.mjs"),
      );
      const swap = new Function(
        '"use strict";\n' + assigned.replace("export function", "return function"),
      )();
      assertThrows(() => swap(), ReferenceError);
    });

    it("loads a JSON import as require()'s module unless it has a query", () => {
      assertEquals(dependencyJsonLoad('{"a":1}', { type: "json" }).loader, "js");
      assertEquals(dependencyJsonLoad('{"a":1}').loader, "js");
      assertEquals(dependencyJsonLoad('\uFEFF{"a":1}', { type: "json" }, "?v=1"), {
        contents: '{"a":1}',
        loader: "json",
      });
      assertEquals(dependencyJsonLoad('{"a":1}', undefined, "?v=1").loader, "js");
    });

    it("turns dependency JSON into a CommonJS module and rejects bad JSON", () => {
      const module = { exports: {} };
      new Function("module", prepareDependencyJson('{"a":[1]}'))(module);
      assertEquals(module.exports, { a: [1] });
      assertThrows(() => prepareDependencyJson("{"), SyntaxError);
      const bom = { exports: {} };
      new Function("module", prepareDependencyJson('\uFEFF{"b":2}'))(bom);
      assertEquals(bom.exports, { b: 2 });
    });

    it("leaves files that are neither JavaScript nor CommonJS alone", async () => {
      // Node loads no `.tsx` file.
      const contents = "export const d = __dirname;";
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.tsx")), contents);
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

    it("rejects a POSIX file URL with a host, as Node does", () => {
      assertEquals(errorCode(() => resolve("file://remote-host/x")), "ERR_INVALID_FILE_URL_HOST");
      assertEquals(errorCode(() => resolve("//remote-host/x")), "ERR_INVALID_FILE_URL_HOST");
      assertEquals(resolve("file://localhost/x"), "file:///x");
      const windows = createImportMetaResolve(
        "file:///C:/p/i.js",
        [],
        () => undefined,
        undefined,
        "win32",
      );
      assertEquals(windows("file://server/share/x"), "file://server/share/x");
    });

    it("reports a malformed package.json instead of a missing package", () => {
      const malformed = createImportMetaResolve("file:///p/i.js", [], () => undefined, () => {
        throw Object.assign(new Error("Invalid package config"), {
          code: "ERR_INVALID_PACKAGE_CONFIG",
        });
      });
      assertEquals(errorCode(() => malformed("pkg")), "ERR_INVALID_PACKAGE_CONFIG");
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
        "exports.paths = module.paths;",
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
          "#up": "./../sibling.js",
          "#fallback": ["../invalid.js", "./base.js"],
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
      "/app/node_modules/blocked/package.json": JSON.stringify({
        exports: {
          ".": { node: null, default: "./fallback.js" },
          "./later": [null, "./later.js"],
          "./escape": "./../sibling/index.js",
          "./nested": "./node_modules/x.js",
          "./encoded": "./%2e%2e/sibling/index.js",
          "./empty": "./a//b.js",
          "./ok": { import: "./esm.mjs", node: { require: "./ok.js" } },
          "./space": "./a%20b.js",
          "./arrinvalid": ["../invalid", "./later.js"],
          "./query": "./ok.js?mode=x",
          "./fragment": "./ok.js#part",
          "./badescape": "./%E0%A4%A.js",
        },
      }),
      "/app/node_modules/blocked/a b.js": "module.exports = 'space';",
      "/app/node_modules/mixed/package.json": JSON.stringify({
        exports: { ".": "./ok.js", default: "./ok.js" },
      }),
      "/app/node_modules/mixed/ok.js": "module.exports = 'ok';",
      "/app/node_modules/pat/package.json": JSON.stringify({
        exports: { "./feature*": "./feature*.js" },
      }),
      "/app/node_modules/pat/feature.js": "module.exports = 'feature';",
      "/app/node_modules/pat/featureX.js": "module.exports = 'featureX';",
      "/app/node_modules/p/badplug/package.json": "{",
      "/app/node_modules/p/badplug/index.js": "module.exports = 'index';",
      "/app/node_modules/shadow/package.json": JSON.stringify({
        exports: { ".": "./main.js", "./sub": "./sub.js" },
      }),
      "/app/node_modules/shadow/main.js": "module.exports = 'top main';",
      "/app/node_modules/shadow/sub.js": "module.exports = 'top sub';",
      "/app/node_modules/p/node_modules/shadow/package.json": JSON.stringify({
        exports: { ".": "./main.js" },
      }),
      "/app/node_modules/p/node_modules/shadow/main.js": "module.exports = 'nested main';",
      "/app/node_modules/p/node_modules/badnested/package.json": "{",
      "/app/node_modules/badnested/package.json": JSON.stringify({ main: "index.js" }),
      "/app/node_modules/badnested/index.js": "module.exports = 'top';",
      "/app/node_modules/p/shadowed.js": "module.exports = require('shadow');",
      "/app/node_modules/p/shadow-sub.js": "require('shadow/sub');",
      "/app/node_modules/p/bad-nested.js": "require('badnested');",
      "/app/node_modules/esmtype/package.json": JSON.stringify({ type: "module" }),
      "/app/node_modules/esmtype/index.js": "export default 1;",
      "/app/node_modules/esmtype/legacy.cjs": "module.exports = 'cjs';",
      "/app/node_modules/blocked/fallback.js": "module.exports = 'fallback';",
      "/app/node_modules/blocked/later.js": "module.exports = 'later';",
      "/app/node_modules/blocked/node_modules/x.js": "module.exports = 'x';",
      "/app/node_modules/blocked/a/b.js": "module.exports = 'b';",
      "/app/node_modules/blocked/ok.js": "module.exports = 'ok';",
      "/app/node_modules/p/escape-imports.js": "require('#up');",
      "/app/node_modules/linked/index.js": "module.exports = 'linked';",
      "/app/node_modules/.store/linked/index.js": "module.exports = 'linked';",
      "/app/node_modules/bommain/package.json": '\uFEFF{"main":"main.js"}',
      "/app/node_modules/bommain/main.js": "module.exports = 'bom main';",
      "/app/node_modules/badscope/package.json": "{",
      "/app/node_modules/badscope/plugin.js": "module.exports = 'plugin';",
      "/app/node_modules/badscope/p.cjs": "module.exports = 'cjs';",
      "/app/node_modules/rootonly/package.json": JSON.stringify({ main: "main.js" }),
      "/app/node_modules/rootonly/main.js": "module.exports = 'root';",
      "/app/node_modules/p/flaky.js": "module.exports = 'read';",
      "/app/node_modules/p/shared.js": "",
      "/app/node_modules/p/fails.js": "",
      "/app/node_modules/p/typed.cts": "const n: number = 2; module.exports = n;",
      "/app/node_modules/p/typed.ts": "const t: number = 3; module.exports = t;",
      "/app/node_modules/esmtype/typed.ts": "export default 1;",
      "/app/node_modules/cond/package.json": JSON.stringify({
        exports: {
          ".": { "module-sync": "./sync.js", import: "./esm.js", require: "./cjs.js" },
          "./q": "./cjs.js?mode=x",
        },
      }),
      "/app/node_modules/cond/sync.js": "",
      "/app/node_modules/cond/esm.js": "",
      "/app/node_modules/cond/cjs.js": "module.exports = 'cjs';",
      "/app/node_modules/b/package.json": JSON.stringify({ main: "index.js" }),
      "/app/node_modules/b/index.js": "",
    };
    let reads = 0;
    let unreadable = "";
    const host: RuntimeRequireHost = {
      // Like Deno's, it knows bare prefix-only names that Node does not.
      getBuiltinModule: (id) => id === "test" ? { kind: "test" } : builtins[id],
      isFile: (path) => path in files,
      realpathSync: (path) =>
        path === "/app/link.json"
          ? "/outside.json"
          : path === "/app/node_modules/linked/index.js"
          ? "/app/node_modules/.store/linked/index.js"
          : path,
      readFileSync: (path) => {
        reads++;
        if (path === unreadable) throw new Error("EACCES");
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
      stripTypes: (source) => source.replace(/: number/g, ""),
      toFileUrl: (path) => "file://" + path,
      cwd: () => "/app/node_modules/p",
    };
    const { require, bundled, requireFrom } = createRuntimeRequire(
      host,
      "/app",
      ["test"],
      ["/app/node_modules"],
      "/app",
    );
    const asImport = { [Symbol.for("veryfront.importConditions")]: true } as {
      paths?: unknown;
    };

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

    it("keeps Node's require.resolve paths API", () => {
      const fromP = requireFrom("/app/node_modules/p");
      // A relative entry resolves from the working directory.
      assertEquals(
        fromP.resolve("nested", { paths: ["."] }),
        "/app/node_modules/p/node_modules/nested/index.js",
      );
      assertEquals(fromP.resolve("driver", { paths: ["/app"] }), "/app/node_modules/driver/cjs.js");
      assertEquals(
        errorCode(() => fromP.resolve("driver", { paths: "/app" })),
        "ERR_INVALID_ARG_VALUE",
      );
      assertEquals(
        errorCode(() => fromP.resolve("driver", { paths: [7] })),
        "ERR_INVALID_ARG_TYPE",
      );
      assertEquals(fromP.resolve.paths("fs"), null);
      assertEquals(fromP.resolve.paths("../x"), ["/app/node_modules/p"]);
      assertEquals(fromP.resolve.paths("driver"), [
        "/app/node_modules/p/node_modules",
        "/app/node_modules",
      ]);
      assertEquals(errorCode(() => fromP.resolve.paths(7)), "ERR_INVALID_ARG_TYPE");
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
        // Within the project only.
        paths: ["/app/node_modules/p/node_modules", "/app/node_modules"],
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

    it("runs a bundled file through the module cache computed requires share", () => {
      let runs = 0;
      const seen: unknown[] = [];
      const body = (exports: unknown, module: { exports: unknown }) => {
        runs++;
        // In the cache before its body runs, as in Node: a cycle sees it.
        seen.push(require.cache["/app/node_modules/p/shared.js"] === module);
        seen.push(require("/app/node_modules/p/" + "shared.js") === exports);
        module.exports = { runs };
      };
      const module = bundled("node_modules/p/shared.js", body)!;
      assertEquals(module.exports, { runs: 1 });
      assertEquals(seen, [true, true]);
      assert(bundled("node_modules/p/shared.js", body) === module);
      assert(require("/app/node_modules/p/shared.js") === module.exports);
      assertEquals(runs, 1);
      // Deleted from the cache, it runs again on its next load.
      delete require.cache["/app/node_modules/p/shared.js"];
      assertEquals(bundled("node_modules/p/shared.js", body)!.exports, { runs: 2 });
      // A body that throws leaves the cache and runs again next time.
      let fail = true;
      const flaky = () => {
        if (fail) throw new Error("boom");
      };
      assertThrows(() => bundled("node_modules/p/fails.js", flaky), Error, "boom");
      assert(!("/app/node_modules/p/fails.js" in require.cache));
      fail = false;
      assert(bundled("node_modules/p/fails.js", flaky) !== null);
      // A file a computed require loaded first is the module the bundle gets.
      const counter = require("/app/node_modules/p/counter.js");
      assert(bundled("node_modules/p/counter.js", body)!.exports === counter);
      // A link is keyed by its real path; project code is the bundler's own.
      assert(
        bundled("node_modules/linked/index.js", () => {}) ===
          require.cache["/app/node_modules/.store/linked/index.js"],
      );
      delete require.cache["/app/node_modules/.store/linked/index.js"];
      assertEquals(bundled("src/own.js", body), null);
      assertEquals(bundled(7, body), null);
    });

    it("reads Node's package config: BOMs, malformed scopes and root ids", () => {
      assertEquals(require("bommain"), "bom main");
      assertEquals(
        errorCode(() => require("/app/node_modules/badscope/plugin.js")),
        "ERR_INVALID_PACKAGE_CONFIG",
      );
      // Node reads no package type for a .cjs file.
      assertEquals(require("/app/node_modules/badscope/p.cjs"), "cjs");
      for (const id of ["rootonly/", "rootonly//", "rootonly/.", "rootonly/./"]) {
        assertEquals(require(id), "root");
      }
      assertEquals(errorCode(() => require("rootonly/../b")), "MODULE_NOT_FOUND");
      assertEquals(errorCode(() => require("./rootonly")), "MODULE_NOT_FOUND");
    });

    it("drops a module whose source cannot be read, so the next load reads it again", () => {
      unreadable = "/app/node_modules/p/flaky.js";
      assertThrows(() => require("/app/node_modules/p/flaky.js"), Error, "EACCES");
      unreadable = "";
      assertEquals(require("/app/node_modules/p/flaky.js"), "read");
    });

    it("strips TypeScript's types, as Node 24 does, and refuses a TypeScript module", () => {
      assertEquals(require("/app/node_modules/p/typed.cts"), 2);
      assertEquals(require("/app/node_modules/p/typed.ts"), 3);
      assertEquals(
        errorCode(() => require("/app/node_modules/esmtype/typed.ts")),
        "ERR_REQUIRE_ESM",
      );
      const { require: noStrip } = createRuntimeRequire(
        { ...host, stripTypes: undefined },
        "/app",
        [],
        ["/app/node_modules"],
      );
      assertEquals(
        errorCode(() => noStrip("/app/node_modules/p/typed.cts")),
        "ERR_UNKNOWN_FILE_EXTENSION",
      );
    });

    it("resolves with the import conditions for import.meta.resolve", () => {
      // require() cannot run the ES module that module-sync names.
      assertEquals(require("cond"), "cjs");
      assertEquals(require.resolve("cond"), "/app/node_modules/cond/cjs.js");
      assertEquals(require.resolve("cond", asImport), "file:///app/node_modules/cond/sync.js");
      assertEquals(require.resolve("cond/q"), "/app/node_modules/cond/cjs.js");
      assertEquals(
        require.resolve("cond/q", asImport),
        "file:///app/node_modules/cond/cjs.js?mode=x",
      );
      assertEquals(
        requireFrom("/app/node_modules/p").resolve("#own", asImport),
        "file:///app/node_modules/p/base.js",
      );
      // The import conditions apply to that call only.
      assertEquals(require.resolve("cond"), "/app/node_modules/cond/cjs.js");
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

    it("stops at a null condition and keeps package targets inside the package", () => {
      assertEquals(require("blocked/ok"), "ok");
      // In an array a null falls through to the next item, as in Node.
      assertEquals(require("blocked/later"), "later");
      // A target's escapes name the file; its query or fragment does not.
      assertEquals(require("blocked/space"), "space");
      assertEquals(require("blocked/query"), "ok");
      assertEquals(require.resolve("blocked/fragment"), "/app/node_modules/blocked/ok.js");
      // An invalid item in an array falls through too.
      assertEquals(require("blocked/arrinvalid"), "later");
      assertEquals(requireFrom("/app/node_modules/p")("#fallback"), { name: "base" });
      // Node's `*` never matches the empty string.
      assertEquals(require("pat/featureX"), "featureX");
      assertEquals(errorCode(() => require("pat/feature")), "MODULE_NOT_FOUND");
      // Nor does Node accept exports that mix subpaths and conditions. A
      // directory whose package.json is malformed is an error, not absent.
      assertEquals(errorCode(() => require("mixed")), "MODULE_NOT_FOUND");
      assertEquals(
        errorCode(() => require("/app/node_modules/p/badplug")),
        "ERR_INVALID_PACKAGE_CONFIG",
      );
      for (
        const id of ["blocked", "blocked/escape", "blocked/nested", "blocked/badescape"]
      ) {
        assertEquals(errorCode(() => require(id)), "MODULE_NOT_FOUND", id);
      }
      for (const id of ["blocked/encoded", "blocked/empty"]) {
        assertEquals(errorCode(() => require(id)), "MODULE_NOT_FOUND", id);
      }
      assertEquals(
        errorCode(() => require("/app/node_modules/p/escape-imports.js")),
        "MODULE_NOT_FOUND",
      );
    });

    it("stops at the nearest copy of a package that refuses the path", () => {
      assertEquals(require("/app/node_modules/p/shadowed.js"), "nested main");
      assertEquals(
        errorCode(() => require("/app/node_modules/p/shadow-sub.js")),
        "MODULE_NOT_FOUND",
      );
      // A malformed nearest copy is Node's config error, not a missing package.
      assertEquals(
        errorCode(() => require("/app/node_modules/p/bad-nested.js")),
        "ERR_INVALID_PACKAGE_CONFIG",
      );
      // From elsewhere the top-level copy still serves both.
      assertEquals(require("shadow/sub"), "top sub");
      assertEquals(require("badnested"), "top");
    });

    it("rejects a .js file its package declares an ES module", () => {
      assertEquals(
        errorCode(() => require("/app/node_modules/esmtype/index.js")),
        "ERR_REQUIRE_ESM",
      );
      assertEquals(require("/app/node_modules/esmtype/legacy.cjs"), "cjs");
    });

    it("resolves to the real path that keys require.cache", () => {
      const resolved = require.resolve("linked");
      assertEquals(resolved, "/app/node_modules/.store/linked/index.js");
      assertEquals(require("linked"), "linked");
      assertEquals((require.cache[resolved] as { exports: unknown }).exports, "linked");
    });

    it("gives a bundled file the require of its own directory, once per directory", () => {
      const own = requireFrom("/app/node_modules/p/dialects");
      assert(requireFrom("/app/node_modules/p/dialects") === own);
      assertEquals((own("./" + "pg") as { base: string }).base, "base");
      assertEquals(own.resolve("../" + "base"), "/app/node_modules/p/base.js");
      assertEquals(own("nested"), "nested");
      assertEquals(errorCode(() => requireFrom(7)("./pg")), "MODULE_NOT_FOUND");
    });

    it("treats a backslash-relative id as relative where the host separator is one", () => {
      const winFiles: Record<string, string> = {
        "C:\\app\\node_modules\\p\\plugin.js": "module.exports = 'plugin';",
      };
      const win: RuntimeRequireHost = {
        ...host,
        isFile: (path) => path in winFiles,
        realpathSync: (path) => path,
        readFileSync: (path) => winFiles[path]!,
        isAbsolute: (path) => /^[A-Z]:\\/.test(path),
        relative: (from, to) =>
          to.startsWith(from + "\\") ? to.slice(from.length + 1) : to === from ? "" : "..\\x",
        join: (...paths) => {
          const parts: string[] = [];
          for (const part of paths.join("\\").split(/[\\/]/)) {
            if (part === "..") parts.pop();
            else if (part !== "." && part !== "") parts.push(part);
          }
          return parts.join("\\");
        },
        dirname: (path) => path.slice(0, path.lastIndexOf("\\")),
        sep: "\\",
      };
      const { requireFrom: from } = createRuntimeRequire(win, "C:\\app", [], [
        "C:\\app\\node_modules",
      ]);
      const own = from("C:\\app\\node_modules\\p\\lib");
      assertEquals(own("..\\plugin"), "plugin");
      assertEquals(own.resolve("..\\plugin.js"), "C:\\app\\node_modules\\p\\plugin.js");
      // Nor can a backslash smuggle a path into a package name.
      assertEquals(errorCode(() => own("x\\..\\..\\plugin")), "MODULE_NOT_FOUND");
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
      for (const file of ["no-import", "escape-import", "outside-pattern"]) {
        assertEquals(
          errorCode(() => require(`/app/node_modules/p/${file}.js`)),
          "MODULE_NOT_FOUND",
          file,
        );
      }
      assertEquals(
        errorCode(() => require("/app/node_modules/p/broken-pkg.js")),
        "ERR_INVALID_PACKAGE_CONFIG",
      );
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
    // A name clash makes the bundler parse the bundle; its service must stop.
    afterEach(async () => {
      await stopBundler();
    });

    it("binds require to the runtime require with the host built-ins", async () => {
      const code = await prependRuntimeRequire("export {};\n", "/app", ["/app/node_modules"], "/w");
      assert(code.includes(createRuntimeRequire.toString()), code);
      assert(code.includes('import __vf_runtime_process from "node:process";'), code);
      assert(
        code.includes(
          '}, "/app", ["test","test/reporters","sqlite","sea"], ["/app/node_modules"], "/w");',
        ),
        code,
      );
      assert(
        code.includes(
          "const { require, bundled: __vf_runtime_bundled, requireFrom: __vf_runtime_require_from } = (",
        ),
        code,
      );
      assert(code.endsWith("\nexport {};\n"), code);
    });

    it("keeps a hashbang on the first line", async () => {
      const code = await prependRuntimeRequire(
        "#!/usr/bin/env node\nexport {};\n",
        "/app",
        [],
        "/",
      );
      assert(code.startsWith("#!/usr/bin/env node\nimport __vf_runtime_process from "), code);
    });

    it("picks helper names the bundle does not already use", async () => {
      const code = await prependRuntimeRequire("const __vf_runtime_fs = 1;\n", "/app", [], "/");
      assert(code.includes("import * as __vf_runtime___fs from"), code);
    });

    it("renames the helper calls dependency preparation wrote", async () => {
      const bundled = 'var r = __vf_require_from("/app/node_modules/p")("./x");';
      const code = await prependRuntimeRequire(bundled, "/app", [], "/");
      const body = code.slice(code.indexOf("var r = "));
      assert(!/\b__vf_require_from\b/.test(body), body);
      assert(body.includes('__vf_runtime_require_from("/app/node_modules/p")'), body);
    });

    it("keeps a route's own declaration of the helper name and still binds the helper", async () => {
      const bundled = [
        "const __vf_require_from = (id) => 'route:' + id;",
        "export const own = __vf_require_from('a');",
      ].join("\n");
      const code = await prependRuntimeRequire(bundled, "/app", [], "/");
      // It must parse: a clashing prologue binding is a redeclaration error.
      // (Bun cannot import a data URL this long, so the check parses it.)
      await transform(code, { loader: "js", format: "esm", logLevel: "silent" });
      // The route keeps its own name; the prologue binds the helper elsewhere.
      const text = code.replaceAll('"', "'");
      assert(text.includes("const __vf_require_from = (id) => 'route:' + id;"));
      assert(text.includes("own = __vf_require_from('a')"), text);
      assert(/requireFrom: (\w+)/.exec(text)?.[1] !== "__vf_require_from");
    });

    // esbuild 0.28 prints its CommonJS helper like this.
    const helper = (inner: string, error = "e") =>
      [
        `var __commonJS = (cb, mod) => function ${inner}() {`,
        "  try {",
        "    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;",
        `  } catch (${error}) {`,
        `    throw mod = 0, ${error};`,
        "  }",
        "};",
      ].join("\n");

    it("runs bundled CommonJS files through the runtime module cache", async () => {
      // A direct eval in the bundle makes the bundler rename the helper's locals.
      for (const [inner, error] of [["__require", "e"], ["__require2", "e2"]]) {
        const code = await prependRuntimeRequire(helper(inner!, error) + "\n", "/app", [], "/w");
        assert(code.includes(`  } catch (${error}) {\n    throw mod = 0, ${error};`), code);
        assert(code.includes(`var __commonJS = (cb, mod) => function ${inner}() {`), code);
        assert(code.includes("const managed = __vf_runtime_bundled(key, cb[key]);"), code);
        // A file the runtime does not manage keeps the bundler's own cache.
        assert(code.includes("return mod || (0, cb[key])((mod = { exports: {} })"), code);
      }
    });

    it("fails the build on a CommonJS helper it does not know", async () => {
      await assertRejects(
        () =>
          prependRuntimeRequire(
            "var __commonJS = (cb, mod) => () => mod || cb();\n",
            "/app",
            [],
            "/",
          ),
        Error,
        "unexpected CommonJS helper",
      );
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
      it("gives top-level arguments Node's five wrapper arguments", async () => {
        const code = await prepareCommonJSFile(
          [
            '"use strict";',
            "exports.req = arguments[1];",
            "exports.rest = [arguments.length, arguments[3], arguments[4]];",
            "exports.inner = (function () { return arguments[0]; })('own');",
            "exports.arrow = (() => arguments[2] === module)();",
          ].join("\n"),
          "/d/p/index.js",
          undefined,
          () => Promise.resolve(null),
        );
        assert(code !== null);
        assert(code.startsWith('"use strict";\nvar __vf_arguments_'), code);
        const module = { exports: {} as Record<string, unknown> };
        const requireFrom = (directory: string) => ({ directory });
        new Function("exports", "module", "__vf_require_from", code)(
          module.exports,
          module,
          requireFrom,
        );
        assertEquals(module.exports, {
          req: { directory: "/d/p" },
          rest: [5, "/d/p/index.js", "/d/p"],
          inner: "own",
          arrow: true,
        });
      });

      it("throws a SyntaxError when a file Node parses as CommonJS has ES module syntax", async () => {
        const esm = "export const a = __dirname;";
        for (const [path, type] of [["/d/p/a.cjs"], ["/d/p/a.js", "commonjs"], ["/d/p/a.cts"]]) {
          const code = await prepareCommonJSFile(esm, path!, type, () => Promise.resolve(null));
          assert(code !== null, path);
          assertThrows(() => new Function(code)(), SyntaxError, "uses ES module syntax", path);
        }
        // Without a declared type, the syntax decides, as Node's detection does.
        assertEquals(
          await prepareCommonJSFile(esm, "/d/p/a.js", undefined, () => Promise.resolve(null)),
          null,
        );
      });

      it("binds __dirname and __filename and resolves require.resolve literals", async () => {
        const code = await prepareCommonJSFile(
          [
            "exports.d = __dirname;",
            "exports.f = __filename;",
            'exports.a = require.resolve("./a");',
            'exports.b = require.resolve("fs");',
            'exports.c = require.resolve("missing");',
            "exports.e = require.resolve(name);",
            'exports.g = require("./g");',
            "exports.h = require(`./h`);",
            'exports.i = require("./dialects/" + name);',
            "exports.j = typeof require;",
            "exports.k = function (require) { return require(name); };",
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
            'exports.c = (__vf_require_from("/d/p", module)).resolve("missing");',
            'exports.e = (__vf_require_from("/d/p", module)).resolve(name);',
            'exports.g = require("./g");',
            'exports.h = require("./h");',
            'exports.i = (__vf_require_from("/d/p", module))("./dialects/" + name);',
            'exports.j = typeof (__vf_require_from("/d/p", module));',
            "return require2(name);",
          ]
        ) {
          assert(code.includes(part), code);
        }
      });

      it("declares the CommonJS names in a file a direct eval may read", async () => {
        const code = await prepareCommonJSFile(
          [
            '"use strict";',
            'exports.p = eval("require")("./p");',
            'exports.s = require("./s");',
            'exports.d = eval("__dirname");',
          ].join("\n"),
          "/d/p/index.cjs",
          undefined,
          resolveRelative,
        );
        assert(code !== null);
        assert(
          code.startsWith(
            '"use strict";\nvar require = (__vf_require_from("/d/p", module)), __dirname = "/d/p", ' +
              '__filename = "/d/p/index.cjs";\n',
          ),
          code,
        );
        assert(code.includes('exports.s = require("./s");'), code);
        const hashbang = await prepareCommonJSFile(
          '#!/usr/bin/env node\neval("x");',
          "/d/p/bin.cjs",
          undefined,
          resolveRelative,
        );
        assert(hashbang?.startsWith("#!/usr/bin/env node\nvar require = "), String(hashbang));
        // Every direct spelling counts; the indirect ones see globals in Node too.
        for (const direct of ['(eval)("require")', 'eval /* c */ ("__dirname")', "((eval))(x)"]) {
          const spelled = await prepareCommonJSFile(
            `module.exports = ${direct};`,
            "/d/p/index.cjs",
            undefined,
            resolveRelative,
          );
          assert(spelled?.startsWith("var require = "), String(spelled));
        }
        for (const indirect of ['(0, eval)("x")', 'eval?.("x")', 'obj.eval("x")']) {
          const spelled = await prepareCommonJSFile(
            `module.exports = [${indirect}, __filename];`,
            "/d/p/index.cjs",
            undefined,
            resolveRelative,
          );
          assert(!spelled?.includes("var require = "), String(spelled));
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

      it("prepares a .ts file by its package type and syntax, as Node 24 loads it", async () => {
        const commonJS = await prepareCommonJSFile(
          "const n: number = 1;\nexports.d = __dirname + n;",
          "/d/p/index.ts",
          undefined,
          resolveRelative,
        );
        assert(commonJS?.includes('exports.d = "/d/p" + n;'), String(commonJS));
        assertEquals(
          await prepareCommonJSFile(
            "exports.d = __dirname;",
            "/d/p/index.ts",
            "module",
            resolveRelative,
          ),
          null,
        );
        assertEquals(
          await prepareCommonJSFile(
            "export const d: string = __dirname;",
            "/d/p/esm.ts",
            undefined,
            resolveRelative,
          ),
          null,
        );
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
          // Node's shape: a null prototype, its keys in order, `main` false.
          /const (__vf_import_meta_resolve_\w+)_meta = \{ __proto__: null, dirname: "\/d\/p", filename: "\/d\/p\/cli\.ts", main: false, resolve: \1, url: "file:\/\/\/d\/p\/cli\.ts" \};/
            .test(code),
          code,
        );
      });
    });

    describe("prepareDependencyFile()", () => {
      const resolved: Record<
        string,
        { path?: string; external?: boolean; errors?: unknown[]; suffix?: string }
      > = {
        "./a": { path: "/d/node_modules/p/a.js" },
        "pkg/q": { path: "/d/node_modules/pkg/q.js", suffix: "?mode=x" },
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
            '(__vf_require_from("/d/node_modules/p", module)).resolve("ext");',
            '(__vf_require_from("/d/node_modules/p", module)).resolve("project");',
            '(__vf_require_from("/d/node_modules/p", module)).resolve("broken");',
          ]
        ) {
          assert(code.includes(part), code);
        }
        const unresolved = await prepareDependencyFile(
          input('require.resolve("./a");', "/d/node_modules/p/index.js", false),
        );
        assert(
          unresolved.includes('(__vf_require_from("/d/node_modules/p", module)).resolve("./a");'),
          unresolved,
        );
      });

      it("parses a file whose only CommonJS name is a computed require", async () => {
        const computed = await prepareDependencyFile(
          input('module.exports = require("./dialects/" + name);', "/d/node_modules/p/index.js"),
        );
        assert(
          computed.includes(
            '(__vf_require_from("/d/node_modules/p", module))("./dialects/" + name)',
          ),
          computed,
        );
        // A direct eval may read a name the text never spells out.
        const evaluated = await prepareDependencyFile(
          input('exports.d = eval("__dir" + "name");', "/d/node_modules/p/index.js"),
        );
        assert(evaluated.includes('__dirname = "/d/node_modules/p"'), evaluated);
        const parenthesized = await prepareDependencyFile(
          input('exports.d = (eval)("__dir" + "name");', "/d/node_modules/p/index.js"),
        );
        assert(parenthesized.includes('__dirname = "/d/node_modules/p"'), parenthesized);
        // An assignment to require keeps the name, which stays a valid target.
        const assigned = await prepareDependencyFile(
          input(
            'require = require("esm")(module);\nmodule.exports = require(name);',
            "/d/node_modules/p/index.js",
          ),
        );
        // The file assigns its own binding, never the route's.
        assert(assigned.includes('require = require("esm")(module);'), assigned);
        assert(assigned.includes("module.exports = require(name);"), assigned);
        assert(
          assigned.includes('var require = (__vf_require_from("/d/node_modules/p", module));'),
          assigned,
        );
        for (const operator of ["||=", "&&=", "??=", "+="]) {
          const compound = await prepareDependencyFile(
            input(`require ${operator} wrap(require);`, "/d/node_modules/p/index.js"),
          );
          assert(compound.includes("var require = "), compound);
        }
        // A comparison is not an assignment.
        const compared = await prepareDependencyFile(
          input("module.exports = require == null;", "/d/node_modules/p/index.js"),
        );
        assert(!compared.includes("var require = "), compared);
        // A file that reads only `arguments`, or a CommonJS file with only
        // ES module syntax, is parsed too.
        const args = await prepareDependencyFile(
          input("module.exports = arguments.length;", "/d/node_modules/p/index.js"),
        );
        assert(args.includes("return arguments;"), args);
        const forced = await prepareDependencyFile(
          input("export default 1;", "/d/node_modules/p/index.cjs"),
        );
        assert(forced.includes("SyntaxError"), forced);
        // Literal calls alone leave nothing for runtime, so nothing is parsed.
        const literal = "module.exports = [require(\"./a\"), require( 'b' )];";
        assertEquals(
          await prepareDependencyFile(input(literal, "/d/node_modules/p/index.js")),
          literal,
        );
      });

      it("resolves import.meta.resolve literals in an ESM file", async () => {
        const code = await prepareDependencyFile(
          input(
            ["fs", "./x.js", "https://e.test/m.js", "pkg", "ext", "pkg/q"].map((id) =>
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
            // A package target's query stays in the URL, as in Node.
            '"file:///d/node_modules/pkg/q.js?mode=x";',
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
