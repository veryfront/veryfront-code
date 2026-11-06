import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PluginBuild } from "veryfront/extensions/bundler";
import {
  builtinModuleName,
  createCompiledBuiltinPlugin,
  createDependencyFilePredicate,
  createDependencyResolvePlugin,
  nodePreferredFile,
  nodeRelativeFile,
  PackageTypeLookup,
  prepareDependencyFile,
  prependRuntimeRequire,
} from "./compiled-cjs-bundling.ts";

type ResolveHandler = (args: Record<string, unknown>) => unknown;

/** The onResolve handlers a plugin registers, in order. */
async function resolveHandlers(
  plugin: { setup(build: PluginBuild): void | Promise<void> },
): Promise<ResolveHandler[]> {
  const handlers: ResolveHandler[] = [];
  const build = {
    onResolve: (_options: unknown, handler: ResolveHandler) => handlers.push(handler),
    onLoad: () => {},
    onDispose: () => {},
  };
  await plugin.setup(build as unknown as PluginBuild);
  return handlers;
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

  describe("createDependencyFilePredicate()", () => {
    const links: Record<string, string> = {
      "/app": "/real/app",
      "/real/app/node_modules/linked": "/real/app/packages/linked",
      "/real/app/node_modules/@s/w": "/real/app/packages/w",
      "/real/app/node_modules/out": "/elsewhere/out",
      "/real/app/node_modules/self": "/real/app",
      "/real/app/node_modules/inner": "/real/app/node_modules/plain",
    };
    const entries: Record<string, { name: string; isDirectory: boolean; isSymlink?: boolean }[]> = {
      "/real/app/node_modules": [
        { name: "linked", isDirectory: false, isSymlink: true },
        { name: "@s", isDirectory: true, isSymlink: false },
        { name: "plain", isDirectory: true, isSymlink: false },
        { name: "out", isDirectory: false },
        { name: "self", isDirectory: false, isSymlink: true },
        { name: "inner", isDirectory: false, isSymlink: true },
        { name: "dead", isDirectory: false, isSymlink: true },
      ],
      "/real/app/node_modules/@s": [{ name: "w", isDirectory: false, isSymlink: true }],
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
    it("keeps built-ins external and records the ones required", async () => {
      const required = new Set<string>();
      const [builtins, native] = await resolveHandlers(createCompiledBuiltinPlugin(required));
      assertEquals(builtins!({ path: "fs", kind: "require-call" }), {
        path: "fs",
        external: true,
      });
      assertEquals(builtins!({ path: "path", kind: "import-statement" }), {
        path: "node:path",
        external: true,
      });
      assertEquals(builtins!({ path: "left-pad", kind: "require-call" }), undefined);
      assertEquals([...required], ["fs"]);
      assertEquals(native!({ path: "./build/addon.node" }), {
        errors: [{ text: 'Native addons are not supported in API routes: "./build/addon.node"' }],
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
      const [handler] = await resolveHandlers(createDependencyResolvePlugin(isDependency, isFile));
      assertEquals(await handler!(args("./impl")), { path: "/d/node_modules/p/impl.js" });
      assertEquals(await handler!(args("./missing")), undefined);
      assertEquals(await handler!(args("./impl", "/d/pages/api/route.ts")), undefined);
    });

    it("rejects a native addon found by Node's extension order", async () => {
      const [handler] = await resolveHandlers(createDependencyResolvePlugin(isDependency, isFile));
      assertEquals(await handler!(args("./addon")), {
        errors: [{ text: 'Native addons are not supported in API routes: "./addon"' }],
      });
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
      rewriteImportMeta: (source: string, url: string) => Promise.resolve(`${url}|${source}`),
    });

    it("returns a file that reads no CommonJS names and no import.meta unchanged", async () => {
      const contents = 'module.exports = require("./other");';
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.js")), contents);
    });

    it("points import.meta at the file's own URL in an ESM file", async () => {
      assertEquals(
        await prepareDependencyFile(input("export const u = import.meta.url;", "/d/a.mjs")),
        "file:///d/a.mjs|export const u = import.meta.url;",
      );
      assertEquals(
        await prepareDependencyFile(
          input("const d = __dirname; import.meta.url;", "/d/b.js", "module"),
        ),
        "file:///d/b.js|const d = __dirname; import.meta.url;",
      );
    });

    it("leaves files that are neither JavaScript nor CommonJS alone", async () => {
      const contents = "export const d = __dirname;";
      assertEquals(await prepareDependencyFile(input(contents, "/d/a.ts")), contents);
    });
  });

  describe("prependRuntimeRequire()", () => {
    it("binds required built-ins and fails closed for anything else", async () => {
      const code = prependRuntimeRequire(
        "export const load = (id) => require(id);\nexport const resolve = (id) => require.resolve(id);\n",
        ["node:path"],
        "/app",
      );
      const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
      assertEquals(typeof mod.load("node:path").join, "function");
      assertEquals(mod.resolve("fs"), "fs");
      assertEquals(mod.resolve("node:test"), "node:test");
      for (const id of ["left-pad", "./relative.json", 42]) {
        let code: unknown;
        try {
          mod.load(id);
        } catch (error) {
          code = (error as { code?: unknown }).code;
        }
        assertEquals(code, "MODULE_NOT_FOUND", String(id));
      }
      let unresolved: unknown;
      try {
        mod.resolve("test");
      } catch (error) {
        unresolved = (error as { code?: unknown }).code;
      }
      assertEquals(unresolved, "MODULE_NOT_FOUND");
    });

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
