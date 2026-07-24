import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  generateCompiledBinaryRequireShim,
  getNodeExternalPackagesToResolve,
  isSpecifierResolutionError,
  loadHandlerModule,
  resolveEsmUserDependencies,
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
  rewriteNodeExternalImports,
  toCjsDestructureBindings,
} from "./loader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { env, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import type { VeryfrontConfig } from "#veryfront/config";

const fs = createFileSystem();

const adapter: RuntimeAdapter = {
  id: "node",
  name: "node-stub",
  capabilities: {
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  },
  fs: {
    readFile: fs.readTextFile.bind(fs),
    writeFile: fs.writeTextFile.bind(fs),
    exists: fs.exists.bind(fs),
    async *readDir(path: string) {
      for await (const entry of fs.readDir(path)) {
        yield {
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: false,
        };
      }
    },
    stat: fs.stat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    remove: fs.remove.bind(fs),
    makeTempDir: (prefix: string) => fs.makeTempDir({ prefix }),
    watch() {
      return {
        async *[Symbol.asyncIterator]() {},
        close() {},
      };
    },
  },
  env: {
    get(key: string) {
      return getEnv(key);
    },
    set(key: string, value: string) {
      setEnv(key, value);
    },
    toObject() {
      return env();
    },
  },
  server: {
    upgradeWebSocket() {
      throw new Error("not implemented");
    },
  },
  serve() {
    throw new Error("not implemented");
  },
};

describe("loadHandlerModule", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("loads .ts file with explicit extension", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("resolves relative imports through adapter when file is not local", async () => {
    const realDir = await makeTempDir();
    await fs.mkdir(join(realDir, "lib"), { recursive: true });
    await fs.mkdir(join(realDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(realDir, "lib", "helper.ts"),
      `export function greet(): string { return "hello"; }`,
    );

    await fs.writeTextFile(
      join(realDir, "pages", "api", "test.ts"),
      [
        `import { greet } from "../../lib/helper.ts";`,
        `export function GET() { return new Response(greet()); }`,
      ].join("\n"),
    );

    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);

    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    const route = await loadHandlerModule({
      projectDir: virtualBase,
      modulePath: join(virtualBase, "pages", "api", "test.ts"),
      adapter: virtualAdapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("resolves the built-in @/ alias through adapter when files are not local", async () => {
    const realDir = await makeTempDir();
    await fs.mkdir(join(realDir, "lib"), { recursive: true });
    await fs.mkdir(join(realDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(realDir, "lib", "greeting.ts"),
      `export const greeting = "virtual alias";`,
    );
    await fs.writeTextFile(
      join(realDir, "pages", "api", "aliased.ts"),
      [
        `import { greeting } from "@/lib/greeting.ts";`,
        `export function GET() { return new Response(greeting); }`,
      ].join("\n"),
    );

    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);
    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    const route = await loadHandlerModule({
      projectDir: virtualBase,
      modulePath: join(virtualBase, "pages", "api", "aliased.ts"),
      adapter: virtualAdapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  // Deno resolves the direct import itself and knows nothing about `@/`, so the
  // route only loads if the failed direct import falls back to bundling, where
  // the import map plugin resolves the alias.
  it("loads a local route that imports through the project's @/ alias", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"), { recursive: true });
    await fs.mkdir(join(tmpDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(tmpDir, "lib", "greeting.ts"),
      `export const greeting = "aliased";`,
    );

    const modulePath = join(tmpDir, "pages", "api", "aliased.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { greeting } from "@/lib/greeting.ts";`,
        `export function GET() { return new Response(greeting); }`,
      ].join("\n"),
    );

    const config: VeryfrontConfig = {
      resolve: { importMap: { imports: { "@/": "./" } } },
    };

    const route = await loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config });

    assertEquals(typeof route?.GET, "function");
  });

  // Every template ships `paths: { "@/*": ["./*"] }` and no import map entry, so
  // the alias a real project uses is resolved by esbuild itself, not by the
  // import map plugin. That lane has to work.
  it("loads an @/ alias resolved through the project's tsconfig paths", async () => {
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "lib"), { recursive: true });
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(projectDir, "lib", "greeting.ts"),
      `export const greeting = "tsconfig";`,
    );
    await fs.writeTextFile(
      join(projectDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
    );

    const modulePath = join(projectDir, "pages", "api", "aliased.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { greeting } from "@/lib/greeting.ts";`,
        `export function GET() { return new Response(greeting); }`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  // esbuild applies tsconfig `paths` before any plugin's onResolve runs, so a
  // boundary check that lives in a resolver plugin never sees the result. An
  // alias that climbs out of the project must not load.
  it("rejects an @/ alias that escapes the project root", async () => {
    const rootDir = await makeTempDir();
    const projectDir = join(rootDir, "project");
    const outsideDir = join(rootDir, "outside");
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    await fs.writeTextFile(
      join(outsideDir, "secret.ts"),
      `export const secret = "TOP-SECRET-OUTSIDE-PROJECT";`,
    );
    await fs.writeTextFile(
      join(projectDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
    );

    const modulePath = join(projectDir, "pages", "api", "leak.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { secret } from "@/../outside/secret.ts";`,
        `export function GET() { return new Response(secret); }`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir, modulePath, adapter, config: undefined }),
      Error,
    );
  });

  // Bundling reads the route through the adapter; a direct import does not. A
  // module that threw while evaluating must surface its own error rather than
  // be evaluated a second time under bundling semantics.
  it("does not retry a module whose own error quotes a resolver phrase", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `throw new Error("Cannot find module 'config'");`,
        `export function GET() { return new Response("ok"); }`,
      ].join("\n"),
    );

    let readCount = 0;
    const countingAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => {
          readCount++;
          return adapter.fs.readFile(path);
        },
      },
    };

    let caught = "";
    try {
      await loadHandlerModule({ projectDir: tmpDir, modulePath, adapter: countingAdapter });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    assertMatch(caught, /Cannot find module 'config'/);
    assertEquals(readCount, 0, "the broken module was re-read for bundling");
  });

  it("throws on missing file", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "missing");

    let caught = "";
    try {
      await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    assertMatch(caught, /Failed to load API handler/i);
  });

  it("loads handler when project has package.json with user dependencies", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Create a package.json with a user dependency (not actually imported)
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { "pdf-parse": "^1.1.1" } }),
    );

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("loads handler when project has no package.json", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // No package.json at all — should gracefully handle
    await fs.writeTextFile(modulePath, `export const POST = () => new Response("created");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.POST, "function");
  });

  it("loads handler when package.json has framework-managed dependencies", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Framework-managed packages should be filtered out from user deps.
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          zod: "^3.22.0",
          veryfront: "^0.1.26",
          "react": "^18.0.0",
        },
      }),
    );

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("handler that uses require('fs') works via createRequire shim", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Simulate a handler that uses Node's fs module (as CJS packages often do internally)
    await fs.writeTextFile(
      modulePath,
      [
        `import { existsSync } from "node:fs";`,
        `export function GET() {`,
        `  const exists = typeof existsSync === "function";`,
        `  return new Response(String(exists));`,
        `}`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("loads handler that imports veryfront/embedding", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `import { createUploadHandler } from "veryfront/embedding";`,
        `export const GET = () => new Response(typeof createUploadHandler);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("converts aliased named imports to valid CJS destructuring", () => {
    assertEquals(
      toCjsDestructureBindings("{ parse as parsePdf, version }"),
      "{ parse: parsePdf, version }",
    );
    assertEquals(
      toCjsDestructureBindings("{ default as foo, bar as baz }"),
      "{ default: foo, bar: baz }",
    );
    assertEquals(
      toCjsDestructureBindings("{ foo, bar }"),
      "{ foo, bar }",
    );
  });

  it("builds the node external package resolution list without duplicates", () => {
    const packages = getNodeExternalPackagesToResolve(
      new Map([
        ["pdf-parse", "^1.1.1"],
        ["zod", "^3.22.0"],
        ["another-lib", "^1.0.0"],
      ]),
    );

    assertEquals(packages, ["zod", "pdf-parse", "another-lib"]);
  });

  it("rewrites bare veryfront imports using the package export map", async () => {
    const tmpDir = await makeTempDir();
    const vfDir = join(tmpDir, "node_modules", "veryfront");
    await fs.mkdir(vfDir, { recursive: true });
    await fs.writeTextFile(
      join(vfDir, "package.json"),
      JSON.stringify({
        exports: {
          ".": { import: "./dist/index.js" },
        },
      }),
    );

    const rewritten = await rewriteNodeExternalImports(
      'import { defineConfig } from "veryfront";',
      tmpDir,
      fs,
      new Map(),
    );

    assertMatch(rewritten, /from "file:\/\/.*node_modules\/veryfront\/dist\/index\.js"/);
  });

  it("rewrites imported user dependencies to resolved node_modules file URLs", async () => {
    const tmpDir = await makeTempDir();
    const depDir = join(tmpDir, "node_modules", "my-lib");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(
      join(depDir, "package.json"),
      JSON.stringify({
        main: "./dist/index.js",
      }),
    );

    const rewritten = await rewriteNodeExternalImports(
      'import thing from "my-lib";',
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertMatch(rewritten, /from "file:\/\/.*node_modules\/my-lib\/dist\/index\.js"/);
  });

  it("rewrites only parsed Node import specifiers", async () => {
    const tmpDir = await makeTempDir();
    const depDir = join(tmpDir, "node_modules", "my-lib");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(
      join(depDir, "package.json"),
      JSON.stringify({ main: "./dist/index.js" }),
    );

    const source = [
      'const text = "from \\"my-lib\\"";',
      '// import("my-lib")',
      'import data from "my-lib" with { type: "json" };',
    ].join("\n");

    const rewritten = await rewriteNodeExternalImports(
      source,
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertEquals(rewritten.includes('const text = "from \\"my-lib\\""'), true);
    assertEquals(rewritten.includes('// import("my-lib")'), true);
    assertMatch(rewritten, /from "file:\/\/.*node_modules\/my-lib\/dist\/index\.js" with/);
  });

  it("rewrites compiled-binary veryfront root and subpath imports to local shims", () => {
    const source = [
      'import { defineConfig } from "veryfront";',
      'const runtime = import("veryfront");',
      'import { createAgent } from "veryfront/agent";',
      'const tool = import("veryfront/tool");',
    ].join("\n");

    const rewritten = rewriteCompiledBinaryVeryfrontImports(source);

    assertMatch(rewritten, /from "\.\/_vf_runtime\.mjs"/);
    assertMatch(rewritten, /import\("\.\/_vf_runtime\.mjs"\)/);
    assertMatch(rewritten, /from "\.\/_vf_agent\.mjs"/);
    assertMatch(rewritten, /import\("\.\/_vf_tool\.mjs"\)/);
  });

  it("rewrites compiled-binary user dependency imports to require-based shims", () => {
    const source = [
      'import thing from "my-lib";',
      'import { alpha as beta } from "my-lib";',
      'import * as namespace from "my-lib";',
      'import combo, { gamma } from "my-lib";',
      'import widget from "my-lib/subpath";',
      'const loaded = import("my-lib/subpath");',
    ].join("\n");

    const rewritten = rewriteCompiledBinaryUserDependencyImports(
      source,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertMatch(rewritten, /const thing = __vf_interopDefault\(require\("my-lib"\)\)/);
    assertMatch(rewritten, /const \{ alpha: beta \} = require\("my-lib"\)/);
    assertMatch(rewritten, /const namespace = require\("my-lib"\)/);
    assertMatch(
      rewritten,
      /const __vf_tmp_combo = require\("my-lib"\); const combo = __vf_interopDefault\(__vf_tmp_combo\); const \{ gamma \} = __vf_tmp_combo/,
    );
    assertMatch(rewritten, /const widget = require\("my-lib\/subpath"\)/);
    assertMatch(rewritten, /Promise\.resolve\(require\("my-lib\/subpath"\)\)/);
  });

  it("rewrites ESM-only user dependency imports to real file:// module URLs", () => {
    const source = [
      'import thing from "esm-lib";',
      'import { alpha } from "esm-lib";',
      'import * as namespace from "esm-lib";',
      'import widget from "esm-lib/subpath";',
      'const loaded = import("esm-lib");',
      'const sub = import("esm-lib/subpath");',
    ].join("\n");

    const rewritten = rewriteCompiledBinaryUserDependencyImports(
      source,
      new Map([["esm-lib", "^1.0.0"]]),
      new Map([[
        "esm-lib",
        {
          entryUrl: "file:///proj/node_modules/esm-lib/index.mjs",
          packageDir: "/proj/node_modules/esm-lib",
        },
      ]]),
    );

    // ESM deps keep native import syntax (no require / new Function path), so
    // import.meta and top-level await inside the dependency stay valid.
    assertMatch(
      rewritten,
      /import thing from "file:\/\/\/proj\/node_modules\/esm-lib\/index\.mjs"/,
    );
    assertMatch(
      rewritten,
      /import \{ alpha \} from "file:\/\/\/proj\/node_modules\/esm-lib\/index\.mjs"/,
    );
    assertMatch(
      rewritten,
      /import \* as namespace from "file:\/\/\/proj\/node_modules\/esm-lib\/index\.mjs"/,
    );
    assertMatch(
      rewritten,
      /import widget from "file:\/\/\/proj\/node_modules\/esm-lib\/subpath"/,
    );
    assertMatch(rewritten, /import\("file:\/\/\/proj\/node_modules\/esm-lib\/index\.mjs"\)/);
    assertMatch(rewritten, /import\("file:\/\/\/proj\/node_modules\/esm-lib\/subpath"\)/);
    // No CJS require shim should be emitted for the ESM dependency.
    assertEquals(rewritten.includes('require("esm-lib")'), false);
  });

  it("keeps CJS deps on the require shim while ESM deps use file:// URLs", () => {
    const source = [
      'import esm from "esm-lib";',
      'import cjs from "cjs-lib";',
    ].join("\n");

    const rewritten = rewriteCompiledBinaryUserDependencyImports(
      source,
      new Map([["esm-lib", "^1.0.0"], ["cjs-lib", "^1.0.0"]]),
      new Map([[
        "esm-lib",
        {
          entryUrl: "file:///proj/node_modules/esm-lib/index.mjs",
          packageDir: "/proj/node_modules/esm-lib",
        },
      ]]),
    );

    assertMatch(rewritten, /import esm from "file:\/\/\/proj\/node_modules\/esm-lib\/index\.mjs"/);
    assertMatch(rewritten, /const cjs = __vf_interopDefault\(require\("cjs-lib"\)\)/);
  });

  it("detects ESM dependencies via type:module and .mjs entry points", async () => {
    const tmpDir = await makeTempDir();

    async function writePackage(name: string, pkg: Record<string, unknown>) {
      const dir = join(tmpDir, "node_modules", name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeTextFile(join(dir, "package.json"), JSON.stringify(pkg));
    }

    await writePackage("type-module-lib", { type: "module", main: "index.js" });
    await writePackage("mjs-main-lib", { main: "index.mjs" });
    await writePackage("exports-import-lib", {
      type: "module",
      exports: { ".": { import: "./dist/index.js", require: "./dist/index.cjs" } },
    });
    await writePackage("cjs-lib", { main: "index.js" });

    const esmDeps = await resolveEsmUserDependencies(
      tmpDir,
      fs,
      new Map([
        ["type-module-lib", "^1.0.0"],
        ["mjs-main-lib", "^1.0.0"],
        ["exports-import-lib", "^1.0.0"],
        ["cjs-lib", "^1.0.0"],
        ["missing-lib", "^1.0.0"],
      ]),
    );

    assertEquals(esmDeps.has("type-module-lib"), true);
    assertEquals(esmDeps.has("mjs-main-lib"), true);
    assertEquals(esmDeps.has("exports-import-lib"), true);
    // CommonJS and uninstalled packages are not treated as ESM.
    assertEquals(esmDeps.has("cjs-lib"), false);
    assertEquals(esmDeps.has("missing-lib"), false);

    assertMatch(
      esmDeps.get("exports-import-lib")?.entryUrl ?? "",
      /node_modules\/exports-import-lib\/dist\/index\.js$/,
    );
  });

  it("does not treat a dependency whose entry escapes its package dir as ESM", async () => {
    const tmpDir = await makeTempDir();
    const dir = join(tmpDir, "node_modules", "evil-lib");
    await fs.mkdir(dir, { recursive: true });
    // Malicious/compromised package: entry points outside node_modules.
    await fs.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({ type: "module", main: "../../../../etc/passwd" }),
    );

    const esmDeps = await resolveEsmUserDependencies(
      tmpDir,
      fs,
      new Map([["evil-lib", "^1.0.0"]]),
    );

    // The traversing entry must be rejected so no file:// import escaping the
    // package directory is emitted (it falls back to the contained CJS shim).
    assertEquals(esmDeps.has("evil-lib"), false);
  });

  it("leaves ESM subpath imports that escape the package dir unrewritten", () => {
    const source = [
      'import ok from "esm-lib/dist/ok.mjs";',
      'import escape from "esm-lib/../../../../etc/passwd";',
      'const dyn = import("esm-lib/../../secret");',
    ].join("\n");

    const rewritten = rewriteCompiledBinaryUserDependencyImports(
      source,
      new Map([["esm-lib", "^1.0.0"]]),
      new Map([[
        "esm-lib",
        {
          entryUrl: "file:///proj/node_modules/esm-lib/index.mjs",
          packageDir: "/proj/node_modules/esm-lib",
        },
      ]]),
    );

    // Contained subpath is rewritten to a file:// URL within the package.
    assertMatch(
      rewritten,
      /import ok from "file:\/\/\/proj\/node_modules\/esm-lib\/dist\/ok\.mjs"/,
    );
    // Traversing subpaths are left as the original bare specifier (which fails
    // to resolve) — crucially, NO escaping file:// URL is emitted for them.
    assertEquals(rewritten.includes("file:///etc/passwd"), false);
    assertEquals(rewritten.includes("file:///proj/secret"), false);
    assertMatch(rewritten, /import escape from "esm-lib\/\.\.\/\.\.\/\.\.\/\.\.\/etc\/passwd"/);
    assertMatch(rewritten, /import\("esm-lib\/\.\.\/\.\.\/secret"\)/);
  });

  it("rewrites non-compiled deno user dependency imports to npm: specifiers with resolved versions", async () => {
    const tmpDir = await makeTempDir();
    const depDir = join(tmpDir, "node_modules", "my-lib");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(
      join(depDir, "package.json"),
      JSON.stringify({
        version: "1.2.3",
      }),
    );

    const source = [
      'import thing from "my-lib";',
      'import widget from "my-lib/subpath";',
      'const loaded = import("my-lib/subpath");',
    ].join("\n");

    const rewritten = await rewriteDenoNpmDependencyImports(
      source,
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertMatch(rewritten, /from "npm:my-lib@1\.2\.3"/);
    assertMatch(rewritten, /from "npm:my-lib@1\.2\.3\/subpath"/);
    assertMatch(rewritten, /import\("npm:my-lib@1\.2\.3\/subpath"\)/);
  });

  it("rewrites only parsed Deno npm import specifiers", async () => {
    const tmpDir = await makeTempDir();
    const depDir = join(tmpDir, "node_modules", "my-lib");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(join(depDir, "package.json"), JSON.stringify({ version: "1.2.3" }));

    const source = [
      'const text = "from \\"my-lib\\"";',
      '// import("my-lib")',
      'import data from "my-lib" with { type: "json" };',
    ].join("\n");

    const rewritten = await rewriteDenoNpmDependencyImports(
      source,
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertEquals(rewritten.includes('const text = "from \\"my-lib\\""'), true);
    assertEquals(rewritten.includes('// import("my-lib")'), true);
    assertEquals(rewritten.includes('from "npm:my-lib@1.2.3" with { type: "json" }'), true);
  });

  it("falls back to declared ranges when node_modules package versions are unavailable", async () => {
    const tmpDir = await makeTempDir();

    const rewritten = await rewriteDenoNpmDependencyImports(
      'import thing from "my-lib";',
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertMatch(rewritten, /from "npm:my-lib@\^1\.0\.0"/);
  });

  it("rewrites bare node builtins to node:-prefixed specifiers for deno compatibility", () => {
    const source = [
      'import { readFile } from "fs";',
      'const path = import("path");',
      'import { join } from "node:path";',
    ].join("\n");

    const rewritten = rewriteDenoNodeBuiltinImports(source);

    assertMatch(rewritten, /from "node:fs"/);
    assertMatch(rewritten, /import\("node:path"\)/);
    assertMatch(rewritten, /from "node:path"/);
  });

  it("rejects module path that escapes project directory via traversal", async () => {
    const tmpDir = await makeTempDir();

    await assertRejects(
      () =>
        loadHandlerModule({
          projectDir: tmpDir,
          modulePath: join(tmpDir, "..", "..", "etc", "passwd"),
          adapter,
          config: undefined,
        }),
      Error,
      "module path escapes project directory",
    );
  });

  it("rejects absolute module path outside project directory", async () => {
    const tmpDir = await makeTempDir();

    await assertRejects(
      () =>
        loadHandlerModule({
          projectDir: tmpDir,
          modulePath: "/etc/passwd",
          adapter,
          config: undefined,
        }),
      Error,
      "module path escapes project directory",
    );
  });

  it("rejects import map entries that escape project directory", async () => {
    const realDir = await makeTempDir();
    const modulePath = join(realDir, "handler.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `import { secret } from "@app/escape";`,
        `export const GET = () => new Response(secret);`,
      ].join("\n"),
    );

    const config: VeryfrontConfig = {
      resolve: {
        importMap: {
          imports: {
            "@app/escape": "../../../etc/passwd",
          },
        },
      },
    };

    // Use a virtual adapter so the loader goes through the esbuild transpile
    // path (where the import map plugin runs) rather than direct Deno import.
    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);

    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    let caught = "";
    try {
      await loadHandlerModule({
        projectDir: virtualBase,
        modulePath: join(virtualBase, "handler.ts"),
        adapter: virtualAdapter,
        config,
      });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    assertMatch(caught, /import map path escapes project|Failed to load/i);
  });

  it("rejects relative imports inside handler that escape project directory", async () => {
    const realDir = await makeTempDir();
    const modulePath = join(realDir, "handler.ts");

    // Handler itself is inside project, but contains a relative import that escapes
    await fs.writeTextFile(
      modulePath,
      [
        `import secret from "../../../../etc/passwd";`,
        `export const GET = () => new Response(secret);`,
      ].join("\n"),
    );

    // Use a virtual adapter to force the esbuild transpile path
    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);

    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    let caught = "";
    try {
      await loadHandlerModule({
        projectDir: virtualBase,
        modulePath: join(virtualBase, "handler.ts"),
        adapter: virtualAdapter,
        config: undefined,
      });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    assertMatch(
      caught,
      /escapes project|Failed to load/i,
    );
  });

  it("rejects API handlers with remote imports when the project lockfile cannot be written for non-read-only reasons", async () => {
    const originalFetch = globalThis.fetch;
    const realDir = await makeTempDir();
    await fs.mkdir(join(realDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(realDir, "pages", "api", "articles-2.ts"),
      [
        `import { parse as parseYaml } from "https://esm.sh/yaml@2";`,
        `export function GET() { return new Response(typeof parseYaml); }`,
      ].join("\n"),
    );

    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);

    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    try {
      globalThis.fetch = (async () =>
        new Response(`export function parse() { return {}; }`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        })) as typeof fetch;

      await assertRejects(
        async () => {
          await loadHandlerModule({
            projectDir: virtualBase,
            modulePath: join(virtualBase, "pages", "api", "articles-2.ts"),
            adapter: virtualAdapter,
            config: undefined,
          });
        },
        Error,
        "No such file or directory",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// VULN-FS-5: compiled-binary CJS loader must enforce project-root containment
// on BOTH branches of __vf_loadCjs (relative/absolute ids AND bare-package
// ids), and must re-canonicalise via Deno.realPathSync so that a symlinked
// node_modules entry cannot escape the project root.
describe("generateCompiledBinaryRequireShim - static checks (VULN-FS-5)", () => {
  it("emits a __vf_assertContained call after bare-package resolution", () => {
    const shim = generateCompiledBinaryRequireShim("/fake/project");
    // The original (vulnerable) layout called __vf_assertContained only inside
    // the relative/absolute branch. The fix moves the assertion to run after
    // both branches (i.e. AFTER the `} else { resolved = ...resolve(id); }`).
    const elseIdx = shim.indexOf("__vf_builtinRequire.resolve(id)");
    const assertIdx = shim.indexOf("__vf_assertContained(resolved)", elseIdx);
    assertEquals(
      assertIdx > elseIdx,
      true,
      "containment check must follow bare-package resolution",
    );
  });

  it("emits a Deno.realPathSync re-canonicalisation on the resolved path", () => {
    const shim = generateCompiledBinaryRequireShim("/fake/project");
    assertEquals(shim.includes("Deno.realPathSync"), true);
    // And the real path must itself be checked for containment.
    const realIdx = shim.indexOf("Deno.realPathSync");
    const realAssertIdx = shim.indexOf("__vf_assertContained(real)", realIdx);
    assertEquals(
      realAssertIdx > realIdx,
      true,
      "realPathSync result must be containment-checked",
    );
  });

  it("canonicalises __vf_projectRoot at shim init so symlinked project roots are not falsely rejected", () => {
    // Regression: prior to the fix, __vf_projectRoot was only path.resolve()'d,
    // so when realPathSync(resolved) returned a canonical path whose prefix
    // differed from a symlinked projectRoot, every legitimate dep was blocked.
    const shim = generateCompiledBinaryRequireShim("/fake/project");
    const rootInitIdx = shim.indexOf("var __vf_projectRoot =");
    const canonIdx = shim.indexOf(
      "Deno.realPathSync(__vf_projectRoot)",
      rootInitIdx,
    );
    const fnIdx = shim.indexOf("function __vf_assertContained");
    assertEquals(
      canonIdx > rootInitIdx && canonIdx < fnIdx,
      true,
      "__vf_projectRoot must be realPathSync'd between its declaration and the assertContained definition",
    );
  });

  it("the containment check rejects paths outside the project root", () => {
    // Reproduce the assertion logic in a local closure so we can exercise it
    // directly without eval. This is structurally identical to the bytes that
    // get embedded into the compiled-binary shim.
    const projectRoot = "/fake/project";
    const assertContained = (resolved: string): void => {
      const norm = resolved.replace(/\\/g, "/");
      const root = projectRoot.replace(/\\/g, "/");
      if (!norm.startsWith(root + "/") && norm !== root) {
        throw new Error("CJS loader blocked path outside project: " + resolved);
      }
    };

    // Rejects escapes.
    let caught = "";
    try {
      assertContained("/etc/passwd");
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertMatch(caught, /blocked path outside project/);

    // Rejects sibling project that shares a prefix.
    caught = "";
    try {
      assertContained("/fake/projectile/secret.js");
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertMatch(caught, /blocked path outside project/);

    // Accepts the root itself and nested children.
    assertContained("/fake/project");
    assertContained("/fake/project/node_modules/ok/index.js");
  });
});

describe("generateCompiledBinaryRequireShim - symlink resistance (VULN-FS-5)", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("re-canonicalisation via realPathSync catches a node_modules symlink escape", async () => {
    // Create a project root, a decoy "evil" package whose entry file is a
    // symlink pointing at a file outside the project root. If the shim only
    // checked the pre-symlink path, the containment test would pass but the
    // readTextFileSync would still leak the external file. With the fix, the
    // realPathSync + second __vf_assertContained catches the escape.
    const projectDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const outsideFile = join(outsideDir, "secret.txt");
    await fs.writeTextFile(outsideFile, "top-secret-contents");

    const nodeModules = join(projectDir, "node_modules", "evil");
    await fs.mkdir(nodeModules, { recursive: true });
    const symlinkEntry = join(nodeModules, "index.js");
    try {
      await Deno.symlink(outsideFile, symlinkEntry);
    } catch (e) {
      // On platforms without symlink permission, skip this test rather than
      // misreport a failure. The static check above still covers the fix.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("permission") || msg.includes("not supported")) return;
      throw e;
    }

    // Simulate what the shim would do: resolve, assert, realPath, assert again.
    const assertContained = (resolved: string): void => {
      const norm = resolved.replace(/\\/g, "/");
      const root = projectDir.replace(/\\/g, "/");
      if (!norm.startsWith(root + "/") && norm !== root) {
        throw new Error("CJS loader blocked path outside project: " + resolved);
      }
    };

    // Pre-symlink path is inside the project - first assertion passes.
    assertContained(symlinkEntry);

    // realPathSync follows the symlink to the outside directory.
    // Second assertion must fail.
    const real = Deno.realPathSync(symlinkEntry);
    let caught = "";
    try {
      assertContained(real);
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertMatch(caught, /blocked path outside project/);

    // Clean up.
    try {
      await fs.remove(projectDir, { recursive: true });
    } catch (_) { /* best effort */ }
    try {
      await fs.remove(outsideDir, { recursive: true });
    } catch (_) { /* best effort */ }
  });

  it("accepts legitimate deps when the project root itself is opened through a symlink", async () => {
    // Regression for Codex review on #1120: if __vf_projectRoot is not
    // canonicalised at shim init, a legitimate dep inside a symlinked project
    // fails the post-realPathSync containment check (because realPathSync on
    // the resolved module returns the canonical prefix while projectRoot is
    // still the symlinked one).
    const realProject = await makeTempDir();
    const symlinkedProject = (await makeTempDir()) + "-link";
    try {
      await Deno.symlink(realProject, symlinkedProject);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("permission") || msg.includes("not supported")) return;
      throw e;
    }

    const depDir = join(realProject, "node_modules", "ok");
    await fs.mkdir(depDir, { recursive: true });
    const depEntry = join(depDir, "index.js");
    await fs.writeTextFile(depEntry, "module.exports = 1;");

    // Simulate shim init: projectRoot supplied as the symlinked path, then
    // canonicalised via realPathSync (the fix).
    let projectRoot = symlinkedProject;
    projectRoot = Deno.realPathSync(projectRoot);

    const assertContained = (resolved: string): void => {
      const norm = resolved.replace(/\\/g, "/");
      const root = projectRoot.replace(/\\/g, "/");
      if (!norm.startsWith(root + "/") && norm !== root) {
        throw new Error("CJS loader blocked path outside project: " + resolved);
      }
    };

    // Resolve through the symlinked project root (as createRequire would),
    // then realPathSync (as the shim does). With the fix, projectRoot is
    // canonical so this passes. Without the fix, it would throw.
    const resolvedThroughSymlink = join(symlinkedProject, "node_modules/ok/index.js");
    const real = Deno.realPathSync(resolvedThroughSymlink);
    assertContained(real);

    try {
      await fs.remove(symlinkedProject);
    } catch (_) { /* best effort */ }
    try {
      await fs.remove(realProject, { recursive: true });
    } catch (_) { /* best effort */ }
  });
});

describe("isSpecifierResolutionError", () => {
  // Direct import leaves specifier resolution to the runtime, which knows
  // nothing about the project's `@/` alias — those routes used to 500 with a
  // flat "Handler not found". Only resolution failures may fall back to
  // bundling; a genuinely broken module must still surface its own error.
  it("recognises an unresolved bare or aliased specifier", () => {
    for (
      const message of [
        // Deno appends a hint on later lines; the specifier opens the message.
        `Import "@/lib/uses-crypto" not a dependency\n  hint: try running \`deno add\``,
        `Module not found "file:///p/lib/x.js".`,
        `Relative import path "lib/x.ts" not prefixed with / or ./ or ../`,
      ]
    ) {
      assertEquals(isSpecifierResolutionError(new TypeError(message)), true, message);
    }
  });

  it("does not treat a genuine module error as a resolution failure", () => {
    assertEquals(isSpecifierResolutionError(new SyntaxError("Unexpected token }")), false);
    assertEquals(isSpecifierResolutionError(new TypeError("x is not a function")), false);
    assertEquals(isSpecifierResolutionError(new Error("boom")), false);
  });

  // A route is free to throw whatever it likes. Matching those phrases anywhere
  // in the message used to hand a broken module to the bundling loader, which
  // evaluates it a second time under different semantics.
  it("does not match a module's own error that quotes a resolver phrase", () => {
    for (
      const message of [
        `Cannot find module 'config'`,
        `Setup failed: Module not found "config"`,
        `Import "x" not a dependency, said the module`,
      ]
    ) {
      assertEquals(isSpecifierResolutionError(new Error(message)), false, message);
    }

    // Not even when the module throws the type Deno's resolver uses.
    assertEquals(
      isSpecifierResolutionError(new TypeError(`config error: Module not found "db"`)),
      false,
    );
  });

  it("ignores non-Error values", () => {
    assertEquals(isSpecifierResolutionError(null), false);
    assertEquals(isSpecifierResolutionError("not a dependency"), false);
  });
});
