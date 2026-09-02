// @veryfront-test runtime-guarded-deno
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import {
  bundlerForcesTypeScript,
  canDirectImportSpecifier,
  generateCompiledBinaryRequireShim,
  getNodeExternalPackagesToResolve,
  getUserDependencies,
  isBareModuleSpecifier,
  isSpecifierResolutionError,
  loadHandlerModule as loadHandlerModuleRaw,
  lookupImportMapEntry,
  prepareHandlerModule,
  readDenoImportMap,
  resolveEsmUserDependencies,
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
  rewriteNodeExternalImports,
  toCjsDestructureBindings,
  typeScriptBuildOptions,
} from "./loader.ts";
import { __setCompiledBinaryForTests } from "#veryfront/security/sandbox/isolation-capability.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { env, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { LoadModuleOptions } from "./types.ts";
import { executeAppRoute } from "../route-executor.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { APIRoute, AppRouteContext, AppRouteHandler } from "./types.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

const fs = createFileSystem();
const appRouteContext: AppRouteContext = { params: {}, identity: null, env: {} };
const denoIt = isDeno ? it : it.skip;

describe("canDirectImportSpecifier", () => {
  it("routes import-map-eligible bare and scoped names through the bundler", () => {
    assertEquals(canDirectImportSpecifier("remote-lib"), false);
    assertEquals(canDirectImportSpecifier("@scope/remote-lib"), false);
    assertEquals(canDirectImportSpecifier("npm:remote-lib"), true);
    assertEquals(canDirectImportSpecifier("jsr:@scope/remote-lib"), true);
    assertEquals(canDirectImportSpecifier("node:path"), true);
  });
});

describe("isBareModuleSpecifier", () => {
  it("separates names the runtime resolves through a map from paths and URLs", () => {
    for (const specifier of ["remote-lib", "@scope/remote-lib", "#internal/errors"]) {
      assertEquals(
        isBareModuleSpecifier(specifier),
        true,
        `${specifier} is resolved through the import map or an installed package`,
      );
    }
    for (const specifier of ["./local.ts", "../local.ts", "/abs/local.ts", "https://x/mod.js"]) {
      assertEquals(
        isBareModuleSpecifier(specifier),
        false,
        `${specifier} names a path or URL, which no import-map key can rewrite`,
      );
    }
  });
});

describe("readDenoImportMap", () => {
  it("reports no mappings for a project without a Deno config", async () => {
    const projectDir = await makeTempDir();

    assertEquals(
      await readDenoImportMap(fs, projectDir),
      { imports: {}, scopes: {} },
      "without a config there is no map, so a bare specifier can only reach an installed package",
    );
  });

  it("reads the mappings the project declares", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "imports": { "zod": "npm:zod@3", "@lib/": "./lib/" } }\n`,
    );

    assertEquals(
      await readDenoImportMap(fs, projectDir),
      {
        imports: { zod: "npm:zod@3", "@lib/": join(projectDir, "lib") + "/" },
        scopes: {},
      },
      "the declared mappings decide what a bare specifier resolves to",
    );
  });

  it("canonicalizes URL-like import-map keys before matching", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      JSON.stringify({
        imports: {
          "HTTPS://EXAMPLE.COM/pkg/../dep.js": "https://blocked.example/mod.js",
        },
      }),
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(
        importMap!,
        "HTTPS://EXAMPLE.COM/pkg/../dep.js",
        join(projectDir, "route.ts"),
      ),
      "https://blocked.example/mod.js",
      "scheme, host, and path normalization must match the key Deno applies at runtime",
    );
  });

  it("preserves an import-map entry named __proto__ as data", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "imports": { "__proto__": "https://blocked.example/mod.js" } }\n`,
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "__proto__", join(projectDir, "route.ts")),
      "https://blocked.example/mod.js",
      "special object property names must remain ordinary import-map keys",
    );
  });

  it("refuses to decide for a config whose mappings it cannot read in full", async () => {
    const cases: Array<[string, string]> = [
      ["unparseable", `{ "imports": { "zod": "npm:zod@3"`],
      ["a missing import-map file", `{ "importMap": "./import_map.json" }`],
      ["an import-map path outside the project", `{ "importMap": "../import_map.json" }`],
      ["a non-string import-map path", `{ "importMap": 3 }`],
      ["non-object scopes", `{ "scopes": ["./lib/"] }`],
      ["a non-string scoped mapping", `{ "scopes": { "./lib/": { "zod": 3 } } }`],
      ["non-string mapping", `{ "imports": { "zod": ["npm:zod@3"] } }`],
      ["an inherited configuration", `{ "extends": "./base.json" }`],
    ];

    for (const [label, contents] of cases) {
      const projectDir = await makeTempDir();
      await fs.writeTextFile(join(projectDir, "deno.json"), contents);

      assertEquals(
        await readDenoImportMap(fs, projectDir),
        null,
        `a config with ${label} must be undecidable rather than read as empty`,
      );
    }
  });

  it("refuses to decide when an external import map meets inline imports or scopes", async () => {
    // Deno applies its own precedence between an external `importMap` and
    // inline `imports`/`scopes`. Reading only the external file could approve
    // a direct load whose bare specifier Deno resolves through an unseen
    // inline mapping, so the combination must stay undecidable.
    for (
      const inline of [
        `"imports": { "dep": "https://blocked.example/mod.js" }`,
        `"scopes": { "./lib/": { "dep": "https://blocked.example/mod.js" } }`,
      ]
    ) {
      const projectDir = await makeTempDir();
      await fs.writeTextFile(
        join(projectDir, "deno.json"),
        `{ "importMap": "./import_map.json", ${inline} }\n`,
      );
      await fs.writeTextFile(
        join(projectDir, "import_map.json"),
        `{ "imports": { "zod": "npm:zod@3" } }\n`,
      );

      assertEquals(
        await readDenoImportMap(fs, projectDir),
        null,
        "a config declaring both mapping sources must be undecidable, not read one-sidedly",
      );
    }
  });

  it("reads a config written in the JSONC a Deno config may use", async () => {
    // Comments and trailing commas are legal in `deno.json`, and Deno resolves
    // every alias such a config declares. Reporting it as undecidable would
    // send those aliases to a bundler that never read the config, so a route
    // importing one would stop building.
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{\n  // the project's own alias\n  "imports": { "zod": "npm:zod@3", },\n}\n`,
    );

    assertEquals(
      await readDenoImportMap(fs, projectDir),
      { imports: { zod: "npm:zod@3" }, scopes: {} },
      "a commented config declares its mappings exactly as a strict-JSON one does",
    );
  });

  it("follows the separate import-map file a config names", async () => {
    // Discarding the map because it lives in its own file would strand every
    // bare specifier the project declares there.
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "importMap": "./import_map.json" }\n`,
    );
    await fs.writeTextFile(
      join(projectDir, "import_map.json"),
      `{ "imports": { "zod": "npm:zod@3" } }\n`,
    );

    assertEquals(
      await readDenoImportMap(fs, projectDir),
      { imports: { zod: "npm:zod@3" }, scopes: {} },
      "a referenced import map decides specifiers exactly as an inline one does",
    );
  });

  it("resolves a nested import map's relative targets against the map file", async () => {
    // Deno resolves a standalone map's targets against the map itself. Reading
    // `./helper.ts` as project-root-relative would vet a same-named file at the
    // root while the runtime loads the one beside the map.
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "config"), { recursive: true });
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "importMap": "./config/import_map.json" }\n`,
    );
    await fs.writeTextFile(
      join(projectDir, "config", "import_map.json"),
      `{ "imports": { "helper": "./helper.ts" }, "scopes": { "./app/": { "other": "../other.ts" } } }\n`,
    );

    assertEquals(
      await readDenoImportMap(fs, projectDir),
      {
        imports: { helper: join(projectDir, "config", "helper.ts") },
        scopes: {
          [join(projectDir, "config", "app") + "/"]: {
            other: join(projectDir, "other.ts"),
          },
        },
      },
      "a nested map's targets name the files beside the map, not their root namesakes",
    );
  });

  it("preserves referrer scopes and falls back to top-level mappings", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "imports": { "zod": "npm:zod@3", "shared": "npm:shared@1" },` +
        ` "scopes": { "./lib/": { "zod": "https://esm.sh/zod@3", "only-scoped": "npm:scoped@1" },` +
        ` "./app/": { "shared": "./shared.ts" } } }\n`,
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    if (importMap === null) return;

    assertEquals(
      lookupImportMapEntry(importMap, "zod", join(projectDir, "lib", "route.ts")),
      "https://esm.sh/zod@3",
    );
    assertEquals(
      lookupImportMapEntry(importMap, "shared", join(projectDir, "app", "route.ts")),
      join(projectDir, "shared.ts"),
    );
    assertEquals(
      lookupImportMapEntry(importMap, "zod", join(projectDir, "app", "route.ts")),
      "npm:zod@3",
      "a scope without the specifier falls back to the top-level mapping",
    );
  });

  it("resolves URL-relative scope prefixes against the import map", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "scopes": { "lib/": { "helper": "./lib/helper.ts" } } }\n`,
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "helper", join(projectDir, "lib", "route.ts")),
      join(projectDir, "lib", "helper.ts"),
      "scope prefixes without dot notation are relative to the import map URL",
    );
  });

  it("selects the local target belonging to the importing file's scope", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "scopes": { "./a/": { "helper": "./a/helper.ts" },` +
        ` "./b/": { "helper": "./b/helper.ts" } } }\n`,
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    if (importMap === null) return;

    assertEquals(
      lookupImportMapEntry(importMap, "helper", join(projectDir, "a", "route.ts")),
      join(projectDir, "a", "helper.ts"),
    );
    assertEquals(
      lookupImportMapEntry(importMap, "helper", join(projectDir, "b", "route.ts")),
      join(projectDir, "b", "helper.ts"),
    );
  });

  it("matches a file URL scope against a filesystem referrer", async () => {
    const projectDir = await makeTempDir();
    const appDir = join(projectDir, "app");
    const scopeUrl = toFileUrl(`${appDir}/`).href;
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      JSON.stringify({
        scopes: {
          [scopeUrl]: { dep: "https://blocked.example/mod.js" },
        },
      }),
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "dep", join(appDir, "route.ts")),
      "https://blocked.example/mod.js",
      "file URL scopes and local graph referrers must share one normalized representation",
    );
  });

  it("canonicalizes remote URL scope prefixes before matching", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      JSON.stringify({
        scopes: {
          "HTTPS://EXAMPLE.COM/pkg/../lib/": {
            dep: "https://blocked.example/mod.js",
          },
        },
      }),
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(Object.keys(importMap!.scopes), ["https://example.com/lib/"]);
    assertEquals(
      lookupImportMapEntry(importMap!, "dep", "https://example.com/lib/route.ts"),
      "https://blocked.example/mod.js",
      "scope lookup must use the same canonical URL form as the runtime",
    );
  });

  it("preserves encoded delimiters while matching a scope to its filesystem referrer", async () => {
    const projectDir = await makeTempDir();
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      `{ "scopes": { "./dir%3Fx/": { "dep": "https://blocked.example/mod.js" } } }\n`,
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "dep", join(projectDir, "dir?x", "route.ts")),
      "https://blocked.example/mod.js",
      "a literal question mark in a filename must not become a module URL query delimiter",
    );
  });

  it("normalizes file URL import-map targets to filesystem paths", async () => {
    const projectDir = await makeTempDir();
    const helperPath = join(projectDir, "helper.ts");
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      JSON.stringify({ imports: { dep: toFileUrl(helperPath).href } }),
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "dep", join(projectDir, "route.ts")),
      helperPath,
      "a file URL target must become the path consumed by the graph and bundler",
    );
  });

  it("normalizes file URL import-map keys for relative lookup", async () => {
    const projectDir = await makeTempDir();
    const helperPath = join(projectDir, "helper.ts");
    await fs.writeTextFile(
      join(projectDir, "deno.json"),
      JSON.stringify({
        imports: {
          [toFileUrl(helperPath).href]: "https://blocked.example/mod.js",
        },
      }),
    );

    const importMap = await readDenoImportMap(fs, projectDir);
    assertNotEquals(importMap, null);
    assertEquals(
      lookupImportMapEntry(importMap!, "./helper.ts", join(projectDir, "route.ts")),
      "https://blocked.example/mod.js",
      "a relative edge and its equivalent absolute file URL key must match",
    );
    assertEquals(
      lookupImportMapEntry(
        importMap!,
        "./helper.ts",
        toFileUrl(join(projectDir, "route.ts")).href,
      ),
      "https://blocked.example/mod.js",
      "a bundled file URL referrer must use the same local import-map key",
    );
  });
});

describe("lookupImportMapEntry", () => {
  it("prefers an exact entry over a prefix, and the longest prefix among prefixes", () => {
    const imports = {
      imports: {
        "@lib/": "./lib/",
        "@lib/vendor/": "https://esm.sh/",
        "@lib/vendor/pinned": "npm:pinned@1",
      },
      scopes: {},
    };

    assertEquals(
      lookupImportMapEntry(imports, "@lib/helper.ts"),
      "./lib/helper.ts",
      "a prefix entry carries the remaining specifier over to its target",
    );
    assertEquals(
      lookupImportMapEntry(imports, "@lib/vendor/mod.js"),
      "https://esm.sh/mod.js",
      "the longest matching prefix wins",
    );
    assertEquals(
      lookupImportMapEntry(imports, "@lib/vendor/pinned"),
      "npm:pinned@1",
      "an exact entry wins over every prefix",
    );
  });

  it("uses the longest matching referrer scope", () => {
    const projectDir = "/project";
    assertEquals(
      lookupImportMapEntry(
        {
          imports: { "@lib/": "/project/default/" },
          scopes: {
            "/project/": { "@lib/": "/project/general/" },
            "/project/app/": { "@lib/": "/project/app/lib/" },
          },
        },
        "@lib/helper.ts",
        `${projectDir}/app/route.ts`,
      ),
      "/project/app/lib/helper.ts",
    );
  });

  it("falls through matching scopes before using top-level imports", () => {
    assertEquals(
      lookupImportMapEntry(
        {
          imports: { helper: "/project/default.ts" },
          scopes: {
            "/project/": { helper: "/project/general.ts" },
            "/project/app/": { other: "/project/app/other.ts" },
          },
        },
        "helper",
        "/project/app/route.ts",
      ),
      "/project/general.ts",
      "an inner matching scope that does not map the specifier must not hide a broader scope",
    );
  });

  it("resolves relative specifiers against remote referrers before import-map lookup", () => {
    assertEquals(
      lookupImportMapEntry(
        {
          imports: {},
          scopes: {
            "https://cdn.example/": {
              "https://cdn.example/helper.js": "https://mapped.example/helper.js",
            },
          },
        },
        "./helper.js",
        "https://cdn.example/entry.js",
      ),
      "https://mapped.example/helper.js",
      "a remote referrer must retain URL semantics when resolving its relative dependency",
    );
  });

  it("resolves remote referrer query strings with URL semantics", () => {
    assertEquals(
      lookupImportMapEntry(
        {
          imports: {},
          scopes: {
            "https://cdn.example/pkg/": {
              "https://cdn.example/pkg/helper.js?version=1": "/project/local-helper.ts",
            },
          },
        },
        "./helper.js?version=1",
        "https://cdn.example/pkg/route.js",
      ),
      "/project/local-helper.ts",
      "relative imports from a remote module must retain their URL form for scope lookup",
    );
  });

  it("leaves a specifier the map does not name alone", () => {
    assertEquals(
      lookupImportMapEntry({ imports: { "@lib/": "./lib/" }, scopes: {} }, "zod"),
      null,
      "an unmapped specifier is the runtime's own package resolution to make",
    );
  });
});

async function getText(route: APIRoute | null): Promise<string | undefined> {
  const handler = route?.GET as AppRouteHandler | undefined;
  const response = await handler?.(new Request("http://x"), appRouteContext);
  return await response?.text();
}

function loadHandlerModule(options: LoadModuleOptions) {
  return loadHandlerModuleRaw({
    ...options,
    allowHostProjectCodeExecution: true,
  });
}

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

describe("TypeScript source execution selection", () => {
  it("routes local source only when the selected bundler accepts the project flags", () => {
    const off = { experimentalDecorators: false, emitDecoratorMetadata: false };
    const on = { experimentalDecorators: true, emitDecoratorMetadata: false };
    assertEquals(bundlerForcesTypeScript(undefined, off), false);
    assertEquals(bundlerForcesTypeScript({}, off), false);
    assertEquals(
      bundlerForcesTypeScript({ shouldBundleTypeScript: () => false }, on),
      false,
    );
    assertEquals(
      bundlerForcesTypeScript({
        shouldBundleTypeScript: (options) => options.experimentalDecorators,
      }, off),
      false,
    );
    assertEquals(
      bundlerForcesTypeScript({
        shouldBundleTypeScript: (options) => options.experimentalDecorators,
      }, on),
      true,
    );
  });

  it("adds a working directory only when the selected bundler handles TypeScript", () => {
    const off = { experimentalDecorators: false, emitDecoratorMetadata: false };
    assertEquals(typeScriptBuildOptions("/project", off, false), {
      typescriptDecoratorOptions: off,
    });
    assertEquals(typeScriptBuildOptions("/project", off, true), {
      typescriptDecoratorOptions: off,
      absWorkingDir: "/project",
    });
  });
});

describe("loadHandlerModule", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterAll(async () => {
    await __resetPoolForTests();
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

  it("reuses an unchanged route module so module state survives between requests", async () => {
    // Every request routes through loadHandlerModule. If each load mints a new
    // module instance, module-level state (clients, caches, pools) silently
    // resets between requests in dev while persisting in production.
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "stateful-handler.ts");

    await fs.writeTextFile(
      modulePath,
      `let count = 0;\nexport const GET = () => new Response(String(++count));`,
    );

    const load = () =>
      loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined });

    const first = await load();
    const second = await load();

    assertEquals(await getText(first), "1");
    assertEquals(
      await getText(second),
      "2",
      "a second load of an unchanged file must reuse the module, not reset its state",
    );
  });

  denoIt("picks up an edited route module instead of serving the cached one", async () => {
    // The counterpart to reuse: editing a route must still take effect without
    // restarting the dev server.
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "edited-handler.ts");

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("before");`);
    const before = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(await getText(before), "before");

    // Move mtime forward so the edit is distinguishable on coarse filesystems.
    await fs.writeTextFile(modulePath, `export const GET = () => new Response("after");`);
    await Deno.utime(modulePath, new Date(), new Date(Date.now() + 2000));

    const after = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(after),
      "after",
      "an edited route must not keep serving the previously loaded module",
    );
  });

  denoIt("picks up same-size edits when the route mtime does not change", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "same-mtime-handler.ts");
    const observableTime = new Date(1_700_000_000_000);

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("one");`);
    await Deno.utime(modulePath, observableTime, observableTime);

    const before = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(await getText(before), "one");

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("two");`);
    await Deno.utime(modulePath, observableTime, observableTime);

    const after = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(after),
      "two",
      "same-size edits with the same observable mtime must still reload",
    );
  });

  denoIt("captures a deferred local import before the validated source can change", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "deferred-handler.ts");
    const helperPath = join(tmpDir, "deferred-helper.ts");
    await fs.writeTextFile(helperPath, `export const value = "validated";`);
    await fs.writeTextFile(
      modulePath,
      `export const GET = async () => {` +
        ` const helper = await import("./deferred-helper.ts?deferred");` +
        ` return new Response(helper.value); };`,
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    await fs.writeTextFile(helperPath, `export const value = "changed-after-validation";`);

    assertEquals(
      await getText(route),
      "validated",
      "the deferred import must execute from the validated bundle, not the mutable file",
    );
  });

  it("reuses an unchanged bundled route module too", async () => {
    // A route that cannot be resolved by Deno alone falls back to bundling, and
    // that path builds its module from generated source rather than the file on
    // disk. It has to keep state across loads for the same reason the direct
    // path does, or module state resets per request for any project using an
    // alias import.
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "lib"), { recursive: true });
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(projectDir, "lib", "counter.ts"),
      `let count = 0;\nexport const bump = () => ++count;`,
    );

    const modulePath = join(projectDir, "pages", "api", "counted.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { bump } from "@/lib/counter.ts";`,
        `export function GET() { return new Response(String(bump())); }`,
      ].join("\n"),
    );

    const config: VeryfrontConfig = {
      resolve: { importMap: { imports: { "@/": "./" } } },
    };
    const load = () => loadHandlerModule({ projectDir, modulePath, adapter, config });

    const first = await load();
    const second = await load();

    assertEquals(await getText(first), "1");
    assertEquals(
      await getText(second),
      "2",
      "a bundled route must reuse its module when the generated source is unchanged",
    );
  });

  it("rebuilds a bundled route module when its source changes", async () => {
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });
    const modulePath = join(projectDir, "pages", "api", "edited.ts");
    const config: VeryfrontConfig = {
      resolve: { importMap: { imports: { "@/": "./" } } },
    };

    await fs.writeTextFile(
      join(projectDir, "pages", "api", "value.ts"),
      `export const value = "before";`,
    );
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "@/pages/api/value.ts";`,
        `export function GET() { return new Response(value); }`,
      ].join("\n"),
    );

    const before = await loadHandlerModule({ projectDir, modulePath, adapter, config });
    assertEquals(await getText(before), "before");

    await fs.writeTextFile(
      join(projectDir, "pages", "api", "value.ts"),
      `export const value = "after";`,
    );

    const after = await loadHandlerModule({ projectDir, modulePath, adapter, config });
    assertEquals(
      await getText(after),
      "after",
      "a bundled route must not keep serving a stale module after its source changes",
    );
  });

  // Hosted proxy execution resolves every project to the host runtime's shared
  // project dir and applies per-request env isolation with runWithProjectEnv.
  // Without a scope discriminator in the cache owner, a module whose top-level
  // init captured one scope's env overlay would be served from cache to a later
  // request in a different scope with matching path and generated source,
  // leaking module-level clients, secrets, and mutable state across tenants.
  it("does not reuse a bundled module across different project env overlays", async () => {
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "lib"), { recursive: true });
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(projectDir, "lib", "counter.ts"),
      `let count = 0;\nexport const bump = () => ++count;`,
    );
    const modulePath = join(projectDir, "pages", "api", "env-scoped.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { bump } from "@/lib/counter.ts";`,
        `export function GET() { return new Response(String(bump())); }`,
      ].join("\n"),
    );

    const config: VeryfrontConfig = {
      resolve: { importMap: { imports: { "@/": "./" } } },
    };
    const load = () => loadHandlerModule({ projectDir, modulePath, adapter, config });

    const tenantA = await runWithProjectEnv({ TENANT_SECRET: "a" }, load);
    assertEquals(await getText(tenantA), "1");

    const tenantB = await runWithProjectEnv({ TENANT_SECRET: "b" }, load);
    assertEquals(
      await getText(tenantB),
      "1",
      "a module initialized under one env overlay must not be reused under another",
    );

    const tenantAAgain = await runWithProjectEnv({ TENANT_SECRET: "a" }, load);
    assertEquals(
      await getText(tenantAAgain),
      "2",
      "the same env scope must keep reusing its own module",
    );
  });

  it("does not reuse a bundled module across different hosted project scopes", async () => {
    const projectDir = await makeTempDir();
    await fs.mkdir(join(projectDir, "lib"), { recursive: true });
    await fs.mkdir(join(projectDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(projectDir, "lib", "counter.ts"),
      `let count = 0;\nexport const bump = () => ++count;`,
    );
    const modulePath = join(projectDir, "pages", "api", "project-scoped.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { bump } from "@/lib/counter.ts";`,
        `export function GET() { return new Response(String(bump())); }`,
      ].join("\n"),
    );

    const config: VeryfrontConfig = {
      resolve: { importMap: { imports: { "@/": "./" } } },
    };
    const load = () => loadHandlerModule({ projectDir, modulePath, adapter, config });

    const projectOne = await runWithCacheKeyContext(
      { projectId: "project-one", mode: "production", versionId: "rel_1" },
      load,
    );
    assertEquals(await getText(projectOne), "1");

    const projectTwo = await runWithCacheKeyContext(
      { projectId: "project-two", mode: "production", versionId: "rel_1" },
      load,
    );
    assertEquals(
      await getText(projectTwo),
      "1",
      "two hosted projects sharing a path and byte-identical output must not share a module",
    );
  });

  it("rejects host loading without an explicit capability before evaluation", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "untrusted-handler.ts");
    const marker = "__vf_untrusted_host_loader_marker__";
    delete (globalThis as Record<string, unknown>)[marker];
    await fs.writeTextFile(
      modulePath,
      `globalThis.${marker} = true; export const GET = () => new Response("ok");`,
    );

    await assertRejects(
      () =>
        loadHandlerModuleRaw({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        } as never),
      TypeError,
      "explicit trusted-local execution",
    );
    assertEquals((globalThis as Record<string, unknown>)[marker], undefined);
  });

  it("prepares route source without evaluating top-level project code", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "prepared-handler.ts");
    const marker = "__vf_prepare_route_host_marker__";
    delete (globalThis as Record<string, unknown>)[marker];
    await fs.writeTextFile(
      modulePath,
      [
        `globalThis.${marker} = "evaluated";`,
        `export const GET = () => new Response("ok");`,
      ].join("\n"),
    );

    const prepared = await prepareHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals((globalThis as Record<string, unknown>)[marker], undefined);
    assertEquals(prepared.sha256.length, 64);
    assertMatch(prepared.source, /__vf_prepare_route_host_marker__/);
  });

  it("refuses to prepare an isolated handler when the runtime cannot link one", async () => {
    const projectDir = await makeTempDir();
    const modulePath = join(projectDir, "unlinkable-handler.ts");
    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    __setCompiledBinaryForTests(true);
    try {
      const error = await assertRejects(() =>
        prepareHandlerModule({
          projectDir,
          modulePath,
          adapter,
          config: undefined,
        })
      );
      // Names the linkage, not a missing transpiler.
      assertMatch(String((error as Error).message), /_vf_/);
      assertMatch(String((error as Error).message), /data:/);
    } finally {
      __setCompiledBinaryForTests(undefined);
    }
  });

  it("keeps an authenticated hosted empty remote-host policy fail-closed", async () => {
    const projectDir = await makeTempDir();
    const modulePath = join(projectDir, "hosted-handler.ts");
    await fs.writeTextFile(
      modulePath,
      `import { parse } from "https://esm.sh/yaml@2";\n` +
        `export const GET = () => new Response(typeof parse);`,
    );

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      globalThis.fetch = (() => {
        fetchCalls += 1;
        return Promise.resolve(new Response("export const parse = () => {};"));
      }) as typeof fetch;

      await assertRejects(
        () =>
          prepareHandlerModule({
            projectDir,
            modulePath,
            adapter,
            // Hosted callers supply the already authenticated and validated
            // project config. An explicit empty list means deny every host.
            config: { security: { remoteHosts: [] } },
          }),
        Error,
        "Remote import blocked by allow-list",
      );
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Execution crosses the Deno Worker boundary. The portable preparation and
  // source-hashing path is covered by the preceding test on every runtime.
  denoIt("executes prepared bundled source only inside the project worker", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "isolated-handler.ts");
    const marker = "__vf_prepared_route_worker_marker__";
    delete (globalThis as Record<string, unknown>)[marker];
    await fs.writeTextFile(
      modulePath,
      [
        `globalThis.${marker} = "worker-only";`,
        `export function GET() { return new Response(String(globalThis.${marker})); }`,
      ].join("\n"),
    );

    const prepared = await prepareHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    const response = await runWithExactSourceIntegrationPolicy(
      normalizeSourceIntegrationPolicy({ allow: {} }),
      () =>
        executeAppRoute(
          {},
          new Request("http://localhost/api/isolated"),
          { route: { pattern: "/api/isolated", page: modulePath }, params: {} },
          "/api/isolated",
          adapter,
          {
            modulePath,
            projectDir: tmpDir,
            isLocalProject: false,
            preparedModule: prepared,
            executionScopeId: `loader-test-${crypto.randomUUID()}`,
          },
        ),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "worker-only");
    assertEquals((globalThis as Record<string, unknown>)[marker], undefined);
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

  // Virtual projects rely on Deno's npm: resolution without a physical
  // node_modules tree. Node project resolution is covered by the local cases.
  denoIt("resolves npm dependencies declared by adapter-backed virtual projects", async () => {
    const realDir = await makeTempDir();
    await fs.mkdir(join(realDir, "lib"), { recursive: true });
    await fs.mkdir(join(realDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(realDir, "package.json"),
      JSON.stringify({ dependencies: { zod: "4.3.6" } }),
    );
    await fs.writeTextFile(
      join(realDir, "lib", "schema.ts"),
      [
        `import { z } from "zod";`,
        `export const result = z.object({ ok: z.boolean() }).parse({ ok: true }).ok;`,
      ].join("\n"),
    );
    await fs.writeTextFile(
      join(realDir, "pages", "api", "activity.ts"),
      [
        `import { result } from "@/lib/schema.ts";`,
        `export function GET() { return new Response(result ? "parsed" : "bad"); }`,
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
      modulePath: join(virtualBase, "pages", "api", "activity.ts"),
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
  denoIt("does not retry a module whose own error quotes a resolver phrase", async () => {
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

  it("does not collide with a Worker binding imported by a bundled route", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { "worker-package": "1.0.0" } }),
    );
    const modulePath = join(tmpDir, "handler.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { Worker } from "worker-package";`,
        `const marker = /force-bundle/;`,
        `export const GET = () => new Response(Worker.name + marker.source);`,
      ].join("\n"),
    );

    const prepared = await prepareHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    const importedWorker = prepared.source.match(
      /import \{ Worker as (Worker\d+) \} from "(?:npm:worker-package@1\.0\.0|worker-package)"/,
    );
    assertNotEquals(importedWorker, null, "the external Worker import must remain in the bundle");
    assertEquals(
      prepared.source.includes(`${importedWorker?.[1]}.name`),
      true,
      "the route must retain the collision-free import binding chosen by the bundler",
    );
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

  it("keeps zod as a user dependency for compiled binary resolution (#217)", () => {
    const dependencies = new Map([
      ["zod", "^3.22.0"],
      ["pdf-parse", "^1.1.1"],
    ]);

    // A compiled binary needs zod in this list so a handler's `import { z } from
    // "zod"` is rewritten to resolve from node_modules instead of 500ing (#217).
    assertEquals(
      [...getUserDependencies(dependencies)],
      [
        ["zod", "^3.22.0"],
        ["pdf-parse", "^1.1.1"],
      ],
    );
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

  it("preserves route user dependency subpath rewrites despite package export maps", async () => {
    const tmpDir = await makeTempDir();
    const depDir = join(tmpDir, "node_modules", "my-lib");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(
      join(depDir, "package.json"),
      JSON.stringify({
        exports: {
          ".": "./dist/index.js",
          "./feature": "./dist/exported-feature.js",
        },
      }),
    );

    const rewritten = await rewriteNodeExternalImports(
      'import feature from "my-lib/feature";',
      tmpDir,
      fs,
      new Map([["my-lib", "^1.0.0"]]),
    );

    assertMatch(rewritten, /from "file:\/\/.*node_modules\/my-lib\/feature"/);
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

    assertMatch(
      caught,
      /Import map path escapes project: @app\/escape/,
      "the import-map boundary check must be what rejects the load",
    );
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
      /Relative import escapes project/,
      "the loader must reject the escaping relative import by name",
    );
  });

  it("normalizes URL-encoded dot segments before walking a local import", async () => {
    const containerDir = await makeTempDir();
    const projectDir = join(containerDir, "project");
    await fs.mkdir(join(projectDir, "%2e%2e"), { recursive: true });
    await fs.writeTextFile(
      join(projectDir, "%2e%2e", "helper.ts"),
      `export const value = "encoded-directory";`,
    );
    await fs.writeTextFile(
      join(containerDir, "helper.ts"),
      `export const value = eval('"outside"');`,
    );
    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "./%2e%2e/helper.ts";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir, modulePath, adapter, config: undefined }),
      Error,
      "escapes project",
      "the graph walk must resolve encoded dot segments with module-URL semantics",
    );
  });

  denoIt("preserves encoded URL delimiters while walking a local import", async () => {
    for (
      const { specifier, actualFile, decoyFile } of [
        {
          specifier: "./helper%3Fignored.ts",
          actualFile: "helper?ignored.ts",
          decoyFile: "helper",
        },
        {
          specifier: "./helper%253Fignored.ts",
          actualFile: "helper%3Fignored.ts",
          decoyFile: "helper?ignored.ts",
        },
      ]
    ) {
      const projectDir = await makeTempDir();
      await fs.writeTextFile(join(projectDir, decoyFile), `export const value = "decoy";`);
      await fs.writeTextFile(
        join(projectDir, actualFile),
        `export const value = eval('"actual"');`,
      );
      const modulePath = join(projectDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        `import { value } from "${specifier}";` +
          `\nexport const GET = () => new Response(value);`,
      );

      await assertRejects(
        () => loadHandlerModule({ projectDir, modulePath, adapter, config: undefined }),
        Error,
        "dynamic code generation",
        "the graph walk must decode the selected filename exactly once",
      );
    }
  });

  it("rejects prepared absolute imports from an unrelated node_modules directory", async () => {
    const projectDir = await makeTempDir();
    const unrelatedDir = await makeTempDir();
    const unrelatedPackageDir = join(unrelatedDir, "node_modules", "host-only");
    await fs.mkdir(unrelatedPackageDir, { recursive: true });

    const unrelatedModule = join(unrelatedPackageDir, "index.js");
    await fs.writeTextFile(
      unrelatedModule,
      `export const value = "outside-project";`,
    );
    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from ${JSON.stringify(unrelatedModule)};\n` +
        `export const GET = () => new Response(value);`,
    );

    await assertRejects(
      () =>
        prepareHandlerModule({
          projectDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Import escapes the project directory",
    );
  });

  it("allows prepared imports from the canonical project dependency root", async () => {
    const projectDir = await makeTempDir();
    const packageDir = join(projectDir, "node_modules", "project-owned");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeTextFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "project-owned", type: "module", main: "index.js" }),
    );
    await fs.writeTextFile(
      join(packageDir, "index.js"),
      `export const value = "project-dependency";`,
    );

    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "project-owned";\n` +
        `export const GET = () => new Response(value);`,
    );

    const prepared = await prepareHandlerModule({
      projectDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertMatch(prepared.source, /project-dependency/);
  });

  denoIt("rejects project symlink escapes before the adapter reads the target", async () => {
    const projectDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const projectLibDir = join(projectDir, "lib");
    await fs.mkdir(projectLibDir, { recursive: true });

    const outsideModule = join(outsideDir, "secret.ts");
    const linkedModule = join(projectLibDir, "linked.ts");
    await fs.writeTextFile(outsideModule, `export const secret = "outside-project";`);
    try {
      await Deno.symlink(outsideModule, linkedModule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|not supported/i.test(message)) return;
      throw error;
    }

    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { secret } from "./lib/linked.ts";\n` +
        `export const GET = () => new Response(secret);`,
    );

    let linkedModuleRead = false;
    const observingAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile(path: string): Promise<string> {
          if (path === linkedModule) linkedModuleRead = true;
          return adapter.fs.readFile(path);
        },
      },
    };

    await assertRejects(
      () =>
        prepareHandlerModule({
          projectDir,
          modulePath,
          adapter: observingAdapter,
          config: undefined,
        }),
      Error,
      "Import escapes the project directory",
    );
    assertEquals(linkedModuleRead, false);
  });

  denoIt("rejects an out-of-project package manifest symlink", async () => {
    const projectDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const outsideManifest = join(outsideDir, "package.json");
    const projectManifest = join(projectDir, "package.json");
    await fs.writeTextFile(
      outsideManifest,
      JSON.stringify({ dependencies: { "outside-only": "1.0.0" } }),
    );
    try {
      await Deno.symlink(outsideManifest, projectManifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|not supported/i.test(message)) return;
      throw error;
    }

    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const canonicalOutsideManifest = await Deno.realPath(outsideManifest);
    let outsideManifestRead = false;
    const observingAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile(path: string): Promise<string> {
          if (path === canonicalOutsideManifest) outsideManifestRead = true;
          return adapter.fs.readFile(path);
        },
      },
    };

    await assertRejects(
      () =>
        prepareHandlerModule({
          projectDir,
          modulePath,
          adapter: observingAdapter,
          config: undefined,
        }),
      Error,
      "Import escapes the project directory",
    );
    assertEquals(outsideManifestRead, false);
  });

  denoIt("rejects a symlinked dependency manifest outside the project", async () => {
    const projectDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const packageName = "outside-dependency";
    const projectModules = join(projectDir, "node_modules");
    const outsidePackage = join(outsideDir, packageName);
    await fs.mkdir(projectModules, { recursive: true });
    await fs.mkdir(outsidePackage, { recursive: true });
    await fs.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { [packageName]: "1.0.0" } }),
    );
    const outsideManifest = join(outsidePackage, "package.json");
    await fs.writeTextFile(
      outsideManifest,
      JSON.stringify({ name: packageName, version: "1.0.0", type: "module" }),
    );
    await fs.writeTextFile(join(outsidePackage, "index.js"), `export const value = "outside";`);
    try {
      await Deno.symlink(outsidePackage, join(projectModules, packageName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|not supported/i.test(message)) return;
      throw error;
    }

    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "${packageName}";\n` +
        `export const GET = () => new Response(value);`,
    );

    const canonicalOutsideManifest = await Deno.realPath(outsideManifest);
    let outsideManifestRead = false;
    const observingAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile(path: string): Promise<string> {
          if (path === canonicalOutsideManifest) outsideManifestRead = true;
          return adapter.fs.readFile(path);
        },
      },
    };

    await assertRejects(
      () =>
        prepareHandlerModule({
          projectDir,
          modulePath,
          adapter: observingAdapter,
          config: undefined,
        }),
      Error,
      "Import escapes the project directory",
    );
    assertEquals(outsideManifestRead, false);
  });

  denoIt("reads the authorized canonical path when a project symlink is swapped", async () => {
    const projectDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const projectLibDir = join(projectDir, "lib");
    await fs.mkdir(projectLibDir, { recursive: true });

    const insideModule = join(projectLibDir, "inside.ts");
    const outsideModule = join(outsideDir, "outside.ts");
    const linkedModule = join(projectLibDir, "linked.ts");
    await fs.writeTextFile(insideModule, `export const value = "inside-project-only";`);
    await fs.writeTextFile(outsideModule, `export const value = "outside-project";`);
    try {
      await Deno.symlink(insideModule, linkedModule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|not supported/i.test(message)) return;
      throw error;
    }

    const modulePath = join(projectDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "./lib/linked.ts";\n` +
        `export const GET = () => new Response(value);`,
    );

    const canonicalInsideModule = await Deno.realPath(insideModule);
    let swapped = false;
    const swappingAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        async readFile(path: string): Promise<string> {
          if (!swapped && path === canonicalInsideModule) {
            swapped = true;
            await Deno.remove(linkedModule);
            await Deno.symlink(outsideModule, linkedModule);
          }
          return await adapter.fs.readFile(path);
        },
      },
    };

    const prepared = await prepareHandlerModule({
      projectDir,
      modulePath,
      adapter: swappingAdapter,
      config: undefined,
    });
    assertEquals(swapped, true);
    assertMatch(prepared.source, /inside-project-only/);
    assertEquals(prepared.source.includes("outside-project"), false);
  });

  it("rejects API handlers with remote imports when the project lockfile cannot be written for non-read-only reasons", async () => {
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

    // The remote import is served by the stub, not by the CDN. It has to move
    // the guarded outbound transport as well as the ambient fetch, or the
    // module loader resolves esm.sh for real and never reaches the lockfile
    // failure this test is about.
    const serveModule: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(`export function parse() { return {}; }`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

    await withMockFetch(serveModule, async () => {
      const error = await assertRejects(
        async () => {
          await loadHandlerModule({
            projectDir: virtualBase,
            modulePath: join(virtualBase, "pages", "api", "articles-2.ts"),
            adapter: virtualAdapter,
            config: undefined,
          });
        },
        Error,
      );
      assertMatch(
        String((error as Error).message),
        /No such file or directory|ENOENT/i,
      );
    });
  });

  it("rejects a direct .js route whose remote import is not allow-listed", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "blocked-js-route.js");

    await fs.writeTextFile(
      modulePath,
      [
        `import "https://blocked.example.com/module.js";`,
        `export const GET = () => new Response("unreachable");`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  it("rejects escaped remote specifiers before direct import evaluation", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "escaped-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        String.raw`import "https:\x2f\x2fblocked.example.com/module.js";`,
        `export const GET = () => new Response("unreachable");`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  it("rejects a remote import hidden after a regular expression before evaluation", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "regex-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /"/;`,
        `import "https://blocked.example.com/module.js";`,
        `export const GET = () => new Response(String(marker));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  it("rejects an unconstrained dynamic import hidden after a regular expression", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "regex-dynamic-route.ts");

    await fs.writeTextFile(
      modulePath,
      `const marker = /"/; const target = "https://blocked.example.com/module.js"; export const GET = () => import(target).then(() => new Response(String(marker)));`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "unconstrained dynamic import",
    );
  });

  it("rejects an unconstrained dynamic import after a keyword-context regular expression", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "keyword-regex-dynamic-route.ts");

    await fs.writeTextFile(
      modulePath,
      `function marker() { return /"/; } const target = "https://blocked.example.com/module.js"; export const GET = () => import(target).then(() => new Response(String(marker)));`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "unconstrained dynamic import",
    );
  });

  it("rejects an unconstrained dynamic import after a control-flow regular expression", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "control-flow-regex-dynamic-route.ts");

    await fs.writeTextFile(
      modulePath,
      `const ready = true; if (ready) /"/.test(""); const target = "https://blocked.example.com/module.js"; export const GET = () => import(target).then(() => new Response("unreachable"));`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "unconstrained dynamic import",
    );
  });

  it("rejects an inline data module before bundling", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "data-module-route.ts");

    await fs.writeTextFile(
      modulePath,
      `import value from "data:text/javascript,const%20u='https://blocked.example/x.js';import(u);export%20default%201"; export const GET = () => new Response(String(value));`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "inline module URLs",
    );
  });

  it("rejects bundled data URL import-map targets before local path fallback", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "data-import-map-route.ts");

    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        imports: {
          "inline-lib": "data:text/javascript,export%20const%20value%20%3D%20%22inline%22",
        },
      }),
    );
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "inline-lib";`,
        `const marker = /force-bundle/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    const error = await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "inline module URLs",
    );
    assertEquals(
      /No such file|ENOENT/i.test(String((error as Error).message)),
      false,
      "an import-map data target must be rejected as a URL, not read as a project file",
    );
  });

  it("rejects eval-created imports before direct module evaluation", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "eval-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const load = () => eval('import("https://blocked.example.com/module.js")');`,
        `export const GET = () => new Response(String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects Function-created imports before direct module evaluation", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "function-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const load = new Function('return import("https://blocked.example.com/module.js")');`,
        `export const GET = () => new Response(String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects imports created through an aliased function constructor", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "aliased-constructor-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const Constructor = (() => {}).constructor;`,
        `const load = Constructor('return import("https://blocked.example.com/module.js")')();`,
        `export const GET = () => new Response(String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects imports created through a destructured function constructor", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "destructured-constructor-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const { constructor: Constructor } = (() => {});`,
        `const load = Constructor('return import("https://blocked.example.com/module.js")')();`,
        `export const GET = () => new Response(String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects an import-map alias that renames a restricted runtime module", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "evaluator": "node:vm" } }\n`,
    );

    const modulePath = join(tmpDir, "aliased-vm-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { runInThisContext } from "evaluator";`,
        `export const GET = () => new Response(String(runInThisContext("1 + 1")));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "code evaluation",
      "an import-map rename must not hand a route the node:vm evaluator",
    );
  });

  it("rejects an import-map alias that renames a subprocess module loader", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "subprocess": "node:child_process" } }\n`,
    );

    const modulePath = join(tmpDir, "aliased-child-process-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { spawn } from "subprocess";`,
        `export const GET = () => new Response(String(spawn));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "subprocess module loading",
      "an import-map rename must not expose the node:child_process loader",
    );
  });

  it("keeps validating helpers when the entry file must bundle", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "generated-import-helper.ts"),
      [
        `export const value = eval('import("https://blocked.example.com/module.js")');`,
      ].join("\n"),
    );

    const modulePath = join(tmpDir, "ambiguous-entry-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /"/;`,
        `import { value } from "./generated-import-helper.ts";`,
        `export const GET = () => new Response(String(marker) + String(value));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("validates the bundled helper graph before preparing worker source", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "prepared-generated-import-helper.ts"),
      [
        `export const value = globalThis["ev" + "al"]('import("https://blocked.example.com/module.js")');`,
      ].join("\n"),
    );

    const modulePath = join(tmpDir, "prepared-entry-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "./prepared-generated-import-helper.ts";`,
        `export const GET = () => new Response(String(value));`,
      ].join("\n"),
    );

    await assertRejects(
      () => prepareHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects a route with an unconstrained dynamic remote import before request handling", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "dynamic-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const url = "https://blocked.example.com/module.js";`,
        `export async function GET() {`,
        `  await import(url);`,
        `  return new Response("unreachable");`,
        `}`,
      ].join("\n"),
    );

    let fetchCalls = 0;
    const serveModule: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(`export const value = "remote";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );
    };

    await withMockFetch(serveModule, async () => {
      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "unconstrained dynamic import",
      );
    });
    assertEquals(fetchCalls, 0);
  });

  it("rejects a remote import inside template interpolation before request handling", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "template-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        'export const GET = () => new Response(String(`before ${import("https://blocked.example.com/module.js")} after`));',
      ].join("\n"),
    );

    let fetchCalls = 0;
    const serveModule: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(`export const value = "remote";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );
    };

    await withMockFetch(serveModule, async () => {
      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "Remote import blocked by allow-list",
      );
    });
    assertEquals(fetchCalls, 0);
  });

  it("does not reject ordinary member calls named import", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "member-import-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const client = { import: (_url: string) => "member" };`,
        `export const GET = () => new Response(client.import("https://blocked.example.com/module.js"));`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(await getText(route), "member");
  });

  it("does not reject optional-chained member calls named import", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "optional-member-import-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `const client = Math.random() > -1 ? { import: () => "optional-member" } : undefined;`,
        `export const GET = () => new Response(client?.import("https://blocked.example.com/module.js") ?? "missing");`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(await getText(route), "optional-member");
  });

  it("rejects escaped remote specifiers through the bundled policy", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "escaped-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `import "https:\\/\\/blocked.example.com\\/module.js";`,
        `export const GET = () => new Response("unreachable");`,
      ].join("\n"),
    );

    let fetchCalls = 0;
    const serveModule: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(`export const value = "remote";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );
    };

    await withMockFetch(serveModule, async () => {
      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "Remote import blocked by allow-list",
      );
    });
    assertEquals(fetchCalls, 0);
  });

  it("rejects a route whose local helper imports a disallowed host", async () => {
    // The direct Deno import hands the whole graph to Deno's loader, so the
    // helper's remote import must be caught before evaluation, not only the
    // entry file's.
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "leaky-helper.ts"),
      [
        `import "https://blocked.example.com/module.js";`,
        `export const value = "leak";`,
      ].join("\n"),
    );

    const modulePath = join(tmpDir, "helper-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "./leaky-helper.ts";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  it("validates local helpers after the entry route requires bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "generated-import-helper.ts"),
      [
        `export const load = () => eval('import("https://blocked.example.com/module.js")');`,
      ].join("\n"),
    );

    const modulePath = join(tmpDir, "bundled-helper-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { load } from "./generated-import-helper.ts";`,
        `const marker = /route/;`,
        `export const GET = () => new Response(String(marker) + String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
    );
  });

  it("rejects unconstrained imports in local helpers after the entry requires bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "dynamic-import-helper.ts"),
      `export const load = (target: string) => import(target);`,
    );

    const modulePath = join(tmpDir, "bundled-dynamic-helper-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { load } from "./dynamic-import-helper.ts";`,
        `const marker = /route/;`,
        `export const GET = () => new Response(String(marker) + String(load));`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "unconstrained dynamic import",
    );
  });

  it("bundles a route whose graph reaches an allowed remote host", async () => {
    // An allowed remote module can itself import other origins, which only the
    // bundler's HTTP plugin validates. A graph with any remote import must
    // therefore load through bundling, never through the direct importer —
    // which is also what lets this stubbed fetch serve the module.
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "allowed-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "https://esm.sh/vf-loader-test-module@1";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    const serveModule: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(`export const value = "remote-ok";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

    await withMockFetch(serveModule, async () => {
      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertEquals(await getText(route), "remote-ok");
    });
  });

  it("applies import maps to remote specifiers before the HTTP bundler", async () => {
    const tmpDir = await makeTempDir();
    const originalUrl = "https://esm.sh/vf-loader-original@1";
    const mappedUrl = "https://esm.sh/vf-loader-mapped@1";
    const modulePath = join(tmpDir, "mapped-remote-route.ts");

    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({ imports: { [originalUrl]: mappedUrl } }),
    );
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "${originalUrl}";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    const serveModule: typeof globalThis.fetch = (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const value = url.startsWith(mappedUrl) ? "mapped" : "original";
      return Promise.resolve(
        new Response(`export const value = "${value}";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );
    };

    await withMockFetch(serveModule, async () => {
      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertEquals(await getText(route), "mapped");
    });
  });

  it("validates manifest-like remote URLs through the HTTP bundler", async () => {
    const tmpDir = await makeTempDir();
    const remoteUrl = "https://esm.sh/bundle-manifest-kv-vf-loader-test@1";
    const modulePath = join(tmpDir, "manifest-like-remote-route.ts");

    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "${remoteUrl}";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    let fetchCalls = 0;
    const serveModule: typeof globalThis.fetch = (input) => {
      fetchCalls += 1;
      const url = input instanceof Request ? input.url : String(input);
      assertEquals(
        url.startsWith(remoteUrl),
        true,
        "the manifest-like remote URL must still be fetched by the HTTP plugin",
      );
      return Promise.resolve(
        new Response(
          [
            `import "https://blocked.example.com/transitive.js";`,
            `export const value = "unreachable";`,
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "application/javascript" },
          },
        ),
      );
    };

    await withMockFetch(serveModule, async () => {
      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "Remote import blocked by allow-list",
      );
    });
    assertEquals(fetchCalls, 1);
  });

  it("refuses to direct-import a route whose graph uses a root-absolute specifier", async () => {
    // A root-absolute specifier resolves from the filesystem root, outside the
    // project boundary, so the walk must refuse the graph rather than hand it
    // to Deno's loader, which would execute the out-of-project file.
    const outsideDir = await makeTempDir();
    const outsidePath = join(outsideDir, "outside.ts");
    await fs.writeTextFile(outsidePath, `export const value = "escaped";`);

    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "absolute-import-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "${outsidePath}";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
    );
  });

  it("loads a route whose JSON data happens to name a code generator", async () => {
    // A `.json` module is parsed as data, so it can neither execute nor name an
    // import. Scanning it as JavaScript rejected ordinary values.
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "labels.json"),
      `{ "label": "Function import.meta.url" }\n`,
    );

    const modulePath = join(tmpDir, "json-data-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import labels from "./labels.json" with { type: "json" };`,
        `export const GET = () => new Response(labels.label);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "Function import.meta.url",
      "JSON data must not be read as executable source",
    );
  });

  it("loads a bundled route whose JSON data happens to name a code generator", async () => {
    // Every bundler namespace loader validates the file it reads, and a `.json`
    // module is data the bundle parses as JSON: it can neither execute nor name
    // an import. The regex literal keeps the route off the direct path, so this
    // exercises the adapter loader that reads the JSON.
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "labels.json"),
      `{ "label": "Function import.meta.url" }\n`,
    );

    const modulePath = join(tmpDir, "bundled-json-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import labels from "./labels.json" with { type: "json" };`,
        `const trim = (value: string) => value.replace(/\\s+$/, "");`,
        `export const GET = () => new Response(trim(labels.label + "  "));`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "Function import.meta.url",
      "bundled JSON data must not be read as executable source",
    );
  });

  it("validates an uppercase JSON extension with the loader that will execute it", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "helper.JSON"),
      `new Worker("https://blocked.example/worker.js"); export const value = "unsafe";`,
    );

    const modulePath = join(tmpDir, "uppercase-json-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "./helper.JSON";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Worker",
      "the js loader makes an uppercase .JSON file executable, so it must be scanned",
    );
  });

  denoIt("preserves import.meta.url when parser-valid slash syntax requires bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(join(tmpDir, "adjacent.txt"), "beside-route");
    const modulePath = join(tmpDir, "slash-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export const GET = async () => {`,
        `  const value = await Deno.readTextFile(new URL("./adjacent.txt", import.meta.url));`,
        `  return new Response(value + marker.source);`,
        `};`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "beside-routex",
      "bundling must preserve the route module as the base for adjacent resources",
    );
  });

  denoIt("preserves import.meta.url for dependencies when bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"));
    await fs.writeTextFile(join(tmpDir, "asset.txt"), "beside-route");
    await fs.writeTextFile(join(tmpDir, "lib", "asset.txt"), "beside-helper");
    await fs.writeTextFile(
      join(tmpDir, "lib", "helper.ts"),
      `export const readAdjacent = () => Deno.readTextFile(` +
        `new URL("./asset.txt", import.meta.url));`,
    );
    const modulePath = join(tmpDir, "dependency-url-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { readAdjacent } from "./lib/helper.ts";`,
        `const marker = /x/;`,
        `export const GET = async () => new Response((await readAdjacent()) + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "beside-helperx",
      "each bundled module must resolve adjacent resources against its own URL",
    );
  });

  denoIt("preserves import.meta dirname and filename for dependencies when bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"));
    await fs.writeTextFile(join(tmpDir, "lib", "asset.txt"), "beside-helper");
    await fs.writeTextFile(
      join(tmpDir, "lib", "helper.ts"),
      [
        `export const readAdjacent = async () => {`,
        `  const value = await Deno.readTextFile(import.meta.dirname + "/asset.txt");`,
        `  return value + String(import.meta.filename.endsWith("/lib/helper.ts"));`,
        `};`,
      ].join("\n"),
    );
    const modulePath = join(tmpDir, "dependency-path-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { readAdjacent } from "./lib/helper.ts";`,
        `const marker = /x/;`,
        `export const GET = async () => new Response((await readAdjacent()) + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "beside-helpertruex",
      "each bundled module must retain its source directory and filename",
    );
  });

  denoIt("preserves import.meta.resolve for dependencies when bundling", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"));
    await fs.writeTextFile(join(tmpDir, "asset.txt"), "beside-route");
    await fs.writeTextFile(join(tmpDir, "lib", "asset.txt"), "beside-helper");
    await fs.writeTextFile(
      join(tmpDir, "lib", "helper.ts"),
      `export const readAdjacent = () => Deno.readTextFile(` +
        `new URL(import.meta.resolve("./asset.txt")));`,
    );
    const modulePath = join(tmpDir, "dependency-resolve-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { readAdjacent } from "./lib/helper.ts";`,
        `const marker = /x/;`,
        `export const GET = async () => new Response((await readAdjacent()) + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "beside-helperx",
      "each bundled resolver must stay bound to the module that declared it",
    );
  });

  denoIt("applies scoped import maps to bundled import.meta.resolve calls", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"));
    await fs.writeTextFile(join(tmpDir, "lib", "asset.txt"), "scoped-asset");
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        scopes: {
          "./lib/": {
            asset: "./lib/asset.txt",
            "#asset": "./lib/asset.txt",
            "?asset": "./lib/asset.txt",
          },
        },
      }),
    );
    await fs.writeTextFile(
      join(tmpDir, "lib", "helper.ts"),
      `const read = (specifier: string) => Deno.readTextFile(new URL(specifier));` +
        ` export const readMapped = async () => (await Promise.all([` +
        `read(import.meta.resolve("asset")),` +
        `read(import.meta.resolve("#asset")),` +
        `read(import.meta.resolve("?asset"))])).join("|");`,
    );
    const modulePath = join(tmpDir, "scoped-resolve-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { readMapped } from "./lib/helper.ts";`,
        `const marker = /x/;`,
        `export const GET = async () => new Response((await readMapped()) + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(
      await getText(route),
      "scoped-asset|scoped-asset|scoped-assetx",
      "a resolver must use the import-map scope belonging to its declaring module",
    );
  });

  denoIt("rejects unmapped dependency-like import.meta.resolve specifiers", async () => {
    for (const specifier of ["#missing", "?missing"]) {
      const tmpDir = await makeTempDir();
      const modulePath = join(tmpDir, "unmapped-resolve-route.ts");
      await fs.writeTextFile(
        modulePath,
        `const marker = /x/;` +
          ` export const GET = () => new Response(` +
          `import.meta.resolve(${JSON.stringify(specifier)}) + marker.source);`,
      );

      await assertRejects(
        () =>
          loadHandlerModule({
            projectDir: tmpDir,
            modulePath,
            adapter,
            config: undefined,
          }),
        Error,
        "import.meta location cannot be preserved",
        `${specifier} must fail closed when the import map does not resolve it`,
      );
    }
  });

  denoIt(
    "keeps a route on the direct path when the project's map leaves its bare specifier alone",
    async () => {
      // An unmapped bare specifier reaches an installed package, never a remote
      // host, so the route does not have to bundle. Only Deno has that direct
      // path at all — every other runtime transpiles unconditionally — so the
      // case is runtime-guarded. The fixture imports a
      // specifier the host runtime resolves, because a temp project's own config
      // is not the one this process runs under; `import.meta.url` then reports
      // which loader produced the module.
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(join(tmpDir, "deno.json"), `{ "imports": {} }\n`);

      const modulePath = join(tmpDir, "unmapped-bare-route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { createUploadHandler } from "veryfront/embedding";`,
          `export const GET = () =>`,
          `  new Response(typeof createUploadHandler + " " + import.meta.url);`,
        ].join("\n"),
      );

      const loadedFrom = await getText(
        await loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      );

      assertMatch(
        loadedFrom ?? "",
        /^function /,
        "the route's own bare import must still resolve",
      );
      assertMatch(
        loadedFrom ?? "",
        /unmapped-bare-route\.ts/,
        "a bare specifier no import map can remap must keep loading through the direct importer",
      );
    },
  );

  it("rejects a bare specifier the project's import map sends to a disallowed host", async () => {
    // The alias never spells the origin, so only resolving it through the
    // project's own map exposes the blocked host before the module loads.
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "blocked-lib": "https://blocked.example.com/lib.js" } }\n`,
    );

    const modulePath = join(tmpDir, "mapped-remote-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "blocked-lib";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  it("bundles a route whose mapped alias reaches an allowed remote host", async () => {
    // Refusing the direct import is only safe if the bundler can resolve the
    // same alias; otherwise the walk would turn a working route into an
    // unresolved import. The stubbed fetch also proves the module travels
    // through the allow-listed HTTP plugin.
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "allowed-lib": "https://esm.sh/vf-mapped-alias@1" } }\n`,
    );

    const modulePath = join(tmpDir, "mapped-allowed-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "allowed-lib";`,
        `export const GET = () => new Response(value);`,
      ].join("\n"),
    );

    const serveModule: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(`export const value = "mapped-remote-ok";`, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

    await withMockFetch(serveModule, async () => {
      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertEquals(
        await getText(route),
        "mapped-remote-ok",
        "a mapped alias for an allowed origin must resolve through the bundler",
      );
    });
  });

  // A route under the second scope must walk that scope's selected helper,
  // including the helper's blocked transitive import. Only Deno has the direct
  // walk this exercises.
  denoIt("vets the matching scope target before direct import", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "a"), { recursive: true });
    await fs.mkdir(join(tmpDir, "b"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "scopes": { "./a/": { "helper": "./a/helper.ts" },` +
        ` "./b/": { "helper": "./b/helper.ts" } } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "a", "helper.ts"), `export const help = "a";`);
    await fs.writeTextFile(
      join(tmpDir, "b", "helper.ts"),
      `import "https://blocked.example.com/x.js";\nexport const help = "b";`,
    );

    const modulePath = join(tmpDir, "b", "route.ts");
    await fs.writeTextFile(
      modulePath,
      [`import { help } from "helper";`, `export const GET = () => new Response(help);`].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
    );
  });

  denoIt("vets a file URL scope target before direct import", async () => {
    const tmpDir = await makeTempDir();
    const appDir = join(tmpDir, "app");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        scopes: {
          [toFileUrl(`${appDir}/`).href]: {
            dep: "https://blocked.example.com/mod.js",
          },
        },
      }),
    );
    const modulePath = join(appDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "dep";\nexport const GET = () => new Response(value);`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
      "the graph walk must apply the same file URL scope that Deno applies",
    );
  });

  denoIt("walks a TypeScript import-equals module edge", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "helper.ts"),
      `new Worker("https://blocked.example.com/worker.js", { type: "module" });` +
        `\nexport const value = "helper";`,
    );
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import helper = require("./helper.ts");` +
        `\nexport const GET = () => new Response(helper.value);`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Worker",
      "the graph validator must inspect import-equals helpers before runtime evaluation",
    );
  });

  denoIt("vets a relative specifier after the Deno import map remaps it", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "./helper.ts": "https://blocked.example.com/helper.ts" } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "helper.ts"), `export const help = "local";`);
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [`import { help } from "./helper.ts";`, `export const GET = () => new Response(help);`].join(
        "\n",
      ),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Remote import blocked by allow-list",
      "the validator must inspect the module Deno selects, not the local path before remapping",
    );
  });

  denoIt("bundles relative imports when an inherited Deno import map is undecidable", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "base.json"),
      JSON.stringify({
        imports: {
          "./helper.ts": `data:text/javascript,export const help = "inherited";`,
        },
      }),
    );
    await fs.writeTextFile(join(tmpDir, "deno.json"), `{ "extends": "./base.json" }\n`);
    await fs.writeTextFile(join(tmpDir, "helper.ts"), `export const help = "local";`);
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [`import { help } from "./helper.ts";`, `export const GET = () => new Response(help);`].join(
        "\n",
      ),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(route),
      "local",
      "an inherited map the validator cannot flatten must not reach Deno direct loading",
    );
  });

  denoIt("vets encoded delimiter filenames after an import-map remap", async () => {
    for (
      const { target, actualFile, decoyFile } of [
        {
          target: "./helper%3Fignored.ts",
          actualFile: "helper?ignored.ts",
          decoyFile: "helper",
        },
        {
          target: "./helper%23ignored.ts",
          actualFile: "helper#ignored.ts",
          decoyFile: "helper",
        },
      ]
    ) {
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(
        join(tmpDir, "deno.json"),
        JSON.stringify({ imports: { "encoded-helper": target } }),
      );
      await fs.writeTextFile(join(tmpDir, decoyFile), `export const value = "decoy";`);
      await fs.writeTextFile(
        join(tmpDir, actualFile),
        `export const value = eval('"actual"');`,
      );
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        `import { value } from "encoded-helper";` +
          `\nexport const GET = () => new Response(value);`,
      );

      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "dynamic code generation",
        "the import-map walk must inspect the decoded filename, not a delimiter-split decoy",
      );
    }
  });

  denoIt("vets encoded delimiter file URL targets after an import-map remap", async () => {
    const tmpDir = await makeTempDir();
    const actualFile = "helper?ignored.ts";
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        imports: { "encoded-helper": toFileUrl(join(tmpDir, actualFile)).href },
      }),
    );
    await fs.writeTextFile(join(tmpDir, "helper"), `export const value = "decoy";`);
    await fs.writeTextFile(
      join(tmpDir, actualFile),
      `export const value = eval('"actual"');`,
    );
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "encoded-helper";` +
        `\nexport const GET = () => new Response(value);`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
      "file URL import-map targets must inspect the decoded filename, not a delimiter-split decoy",
    );
  });

  denoIt("does not direct-import an unchecked package imports alias", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ imports: { "#helper": "./helper.ts" } }),
    );
    await fs.writeTextFile(
      join(tmpDir, "helper.ts"),
      `export const value = eval('"blocked"');`,
    );
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      `import { value } from "#helper";` +
        `\nexport const GET = () => new Response(value);`,
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
      "package imports aliases must pass through the validated bundle graph",
    );
  });

  // A route forced to bundle (here by a regex literal) still imports a bare
  // alias the project's Deno config maps to a local file. The bundler never
  // reads deno.json, so the loader must carry that local mapping over or the
  // valid route fails to resolve.
  it("carries a local Deno import-map alias into the bundler when a route must bundle", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "lib"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "@lib/": "./lib/" } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "lib", "helper.ts"), `export const help = "helped";`);

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { help } from "@lib/helper.ts";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(help + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(route),
      "helpedx",
      "a local Deno alias must resolve through the bundler once the route must bundle",
    );
  });

  denoIt("uses canonical URL-like import-map keys in the bundled graph", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        imports: {
          "HTTPS://EXAMPLE.COM/pkg/../dep.js": "./helper.ts",
        },
      }),
    );
    await fs.writeTextFile(join(tmpDir, "helper.ts"), `export const value = "mapped";`);
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "HTTPS://EXAMPLE.COM/pkg/../dep.js";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: { security: { remoteHosts: ["https://example.com"] } },
    });
    assertEquals(
      await getText(route),
      "mappedx",
      "the bundler must match the same canonical key as the runtime import map",
    );
  });

  denoIt("bundles encoded delimiter filenames after an import-map remap", async () => {
    for (
      const { target, actualFile, decoyFile } of [
        {
          target: "./helper%3Fignored.ts",
          actualFile: "helper?ignored.ts",
          decoyFile: "helper",
        },
        {
          target: "./helper%23ignored.ts",
          actualFile: "helper#ignored.ts",
          decoyFile: "helper",
        },
      ]
    ) {
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(
        join(tmpDir, "deno.json"),
        JSON.stringify({ imports: { "encoded-helper": target } }),
      );
      await fs.writeTextFile(join(tmpDir, decoyFile), `export const value = "decoy";`);
      await fs.writeTextFile(
        join(tmpDir, actualFile),
        `export const value = eval('"actual"');`,
      );
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { value } from "encoded-helper";`,
          `const marker = /force-bundle/;`,
          `export const GET = () => new Response(value + marker.source);`,
        ].join("\n"),
      );

      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "dynamic code generation",
        "the import-map bundler path must read the decoded filename, not a delimiter-split decoy",
      );
    }
  });

  denoIt("bundles encoded delimiter file URL targets after an import-map remap", async () => {
    const tmpDir = await makeTempDir();
    const actualFile = "helper?ignored.ts";
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        imports: { "encoded-helper": toFileUrl(join(tmpDir, actualFile)).href },
      }),
    );
    await fs.writeTextFile(join(tmpDir, "helper"), `export const value = "decoy";`);
    await fs.writeTextFile(
      join(tmpDir, actualFile),
      `export const value = eval('"actual"');`,
    );
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "encoded-helper";`,
        `const marker = /force-bundle/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "dynamic code generation",
      "file URL import-map targets must bundle the decoded filename, not a delimiter-split decoy",
    );
  });

  it("applies a relative import-map remap inside a mapped module", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "mapped"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "entry": "./mapped/entry.ts",` +
        ` "./mapped/helper.ts": "./actual.ts" } }\n`,
    );
    await fs.writeTextFile(
      join(tmpDir, "mapped", "entry.ts"),
      `import { value } from "./helper.ts";\nexport { value };`,
    );
    await fs.writeTextFile(
      join(tmpDir, "mapped", "helper.ts"),
      `export const value = "literal";`,
    );
    await fs.writeTextFile(join(tmpDir, "actual.ts"), `export const value = "remapped";`);
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "entry";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(route),
      "remappedx",
      "relative imports in mapped modules must be looked up before literal resolution",
    );
  });

  denoIt("rejects a mutable local Worker entry before route evaluation", async () => {
    const tmpDir = await makeTempDir();
    const workerPath = join(tmpDir, "worker.ts");
    const originalWorker = `postMessage("ready"); close();`;
    await fs.writeTextFile(
      workerPath,
      originalWorker,
    );
    const modulePath = join(tmpDir, "worker-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `Deno.writeTextFileSync(new URL("./worker.ts", import.meta.url),` +
        ` 'import "https://blocked.example/mod.js";');`,
        `export const GET = () => {`,
        `  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("unreachable");`,
        `};`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "mutable after validation",
      "the route must not receive a chance to replace a validated Worker before startup",
    );
    assertEquals(
      await fs.readTextFile(workerPath),
      originalWorker,
      "rejecting during the build must happen before attacker-controlled module evaluation",
    );
  });

  denoIt(
    "preserves import.meta.url for parser-validated division syntax",
    async () => {
      const tmpDir = await makeTempDir();
      const modulePath = join(tmpDir, "division-import-meta-route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `const result = 8 / 2;`,
          `export const GET = () => new Response(String(result) + " " + import.meta.url);`,
        ].join("\n"),
      );

      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertMatch(
        await getText(route) ?? "",
        /4 .*division-import-meta-route\.ts/,
        "bundling division syntax must retain the original route URL",
      );
    },
  );

  it("uses the longest Deno import-map prefix when a route must bundle", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "default"), { recursive: true });
    await fs.mkdir(join(tmpDir, "vendor"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "@lib/": "./default/", "@lib/vendor/": "./vendor/" } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "default", "mod.ts"), `export const value = "wrong";`);
    await fs.writeTextFile(join(tmpDir, "vendor", "mod.ts"), `export const value = "vendor";`);

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { value } from "@lib/vendor/mod.ts";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(value + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(route),
      "vendorx",
      "the bundler must select the most-specific prefix regardless of declaration order",
    );
  });

  it("uses the matching Deno scope when a scoped route must bundle", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "a"), { recursive: true });
    await fs.mkdir(join(tmpDir, "b"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "scopes": { "./a/": { "helper": "./a/helper.ts" },` +
        ` "./b/": { "helper": "./b/helper.ts" } } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "a", "helper.ts"), `export const help = "a";`);
    await fs.writeTextFile(join(tmpDir, "b", "helper.ts"), `export const help = "b";`);

    const modulePath = join(tmpDir, "b", "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `import { help } from "helper";`,
        `const marker = /x/;`,
        `export const GET = () => new Response(help + marker.source);`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
    assertEquals(
      await getText(route),
      "bx",
      "the bundler must resolve the alias using the longest scope matching its importer",
    );
  });

  denoIt("rejects mutable local Worker entries when the route must bundle", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `self.postMessage("worker-ready");`,
    );

    const modulePath = join(tmpDir, "bundled-worker-route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("worker-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "mutable after validation",
      "bundling must not hand a validated but mutable path to the Worker runtime",
    );
  });

  it("rejects package import aliases inside bundled Worker graphs", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ imports: { "#helper": "./worker-helper.ts" } }),
    );
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "#helper"; self.postMessage("unreachable");`,
    );
    await fs.writeTextFile(join(tmpDir, "worker-helper.ts"), `export const value = "helper";`);
    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response(marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Worker import cannot be validated",
      "a package imports alias must not escape the Worker graph walk",
    );
  });

  it("rejects relative string Workers reached through constructors the bundle cannot wrap", async () => {
    for (
      const construction of [
        `new globalThis.Worker("./worker.ts", { type: "module" })`,
        `new self.Worker("./worker.ts", { type: "module" })`,
        `new routeGlobal.Worker("./worker.ts", { type: "module" })`,
        `new RouteWorker("./worker.ts", { type: "module" })`,
      ]
    ) {
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(join(tmpDir, "worker.ts"), `self.postMessage("unreachable");`);
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `const marker = /x/;`,
          `const routeGlobal = globalThis;`,
          `const { Worker: RouteWorker } = globalThis;`,
          `export function GET() {`,
          `  const worker = ${construction};`,
          `  worker.terminate();`,
          `  return new Response("ok-" + marker.source);`,
          `}`,
        ].join("\n"),
      );

      await assertRejects(
        async () =>
          await loadHandlerModule({
            projectDir: tmpDir,
            modulePath,
            adapter,
            config: undefined,
          }),
        Error,
        "relative string Worker constructor cannot be preserved while bundling",
        `${construction} must fail before the route is evaluated`,
      );
    }
  });

  it("validates bundled helper Worker entries against their execution base", async () => {
    for (
      const { aliasInitializer, workerUrlExpression } of [
        { aliasInitializer: `globalThis`, workerUrlExpression: `"./worker.ts"` },
        {
          aliasInitializer: `globalThis`,
          workerUrlExpression: `new URL("./worker.ts", import.meta.url)`,
        },
        {
          aliasInitializer: `globalThis.window`,
          workerUrlExpression: `new routeGlobal.URL("./worker.ts", import.meta.url)`,
        },
        {
          aliasInitializer: `globalThis.self`,
          workerUrlExpression: `new routeGlobal.URL("./worker.ts", import.meta.url)`,
        },
        {
          aliasInitializer: `self.window`,
          workerUrlExpression: `new routeGlobal.URL("./worker.ts", import.meta.url)`,
        },
        {
          aliasInitializer: `window.self`,
          workerUrlExpression: `new routeGlobal.URL("./worker.ts", import.meta.url)`,
        },
      ]
    ) {
      const tmpDir = await makeTempDir();
      await fs.mkdir(join(tmpDir, "helpers"), { recursive: true });
      await fs.writeTextFile(
        join(tmpDir, "helpers", "worker.ts"),
        `self.postMessage("helper-relative-safe");`,
      );
      await fs.writeTextFile(
        join(tmpDir, "worker.ts"),
        `import "https://blocked.example.com/worker.js";`,
      );
      await fs.writeTextFile(
        join(tmpDir, "helpers", "start-worker.ts"),
        [
          `const routeGlobal = ${aliasInitializer};`,
          `export function startWorker() {`,
          `  const worker = new Worker(${workerUrlExpression}, { type: "module" });`,
          `  worker.terminate();`,
          `}`,
        ].join("\n"),
      );

      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { startWorker } from "./helpers/start-worker.ts";`,
          `const marker = /x/;`,
          `export function GET() {`,
          `  startWorker();`,
          `  return new Response("ok-" + marker.source);`,
          `}`,
        ].join("\n"),
      );

      await assertRejects(
        async () =>
          await loadHandlerModule({
            projectDir: tmpDir,
            modulePath,
            adapter,
            config: undefined,
          }),
        Error,
        workerUrlExpression.includes("import.meta.url")
          ? "mutable after validation"
          : "Remote import blocked",
        `Worker ${workerUrlExpression} via ${aliasInitializer} must use the matching module or route base`,
      );
    }
  });

  denoIt(
    "rejects mutable Worker entries reached through bundled helpers",
    async () => {
      const tmpDir = await makeTempDir();
      await fs.mkdir(join(tmpDir, "helpers"), { recursive: true });
      await fs.writeTextFile(
        join(tmpDir, "helpers", "worker.ts"),
        `import "https://blocked.example.com/worker.js";`,
      );
      await fs.writeTextFile(
        join(tmpDir, "worker.ts"),
        `self.postMessage("route-relative-safe");`,
      );
      await fs.writeTextFile(
        join(tmpDir, "helpers", "start-worker.ts"),
        [
          `export async function workerValue() {`,
          `  const worker = new Worker("./worker.ts", { type: "module" });`,
          `  try {`,
          `    return await new Promise<string>((resolve, reject) => {`,
          `      worker.onmessage = (event) => resolve(String(event.data));`,
          `      worker.onerror = (event) => reject(new Error(event.message));`,
          `    });`,
          `  } finally { worker.terminate(); }`,
          `}`,
        ].join("\n"),
      );

      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { workerValue } from "./helpers/start-worker.ts";`,
          `const marker = /x/;`,
          `export const GET = async () => new Response(await workerValue() + marker.source);`,
        ].join("\n"),
      );

      await assertRejects(
        () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
        Error,
        "mutable after validation",
        "a helper must not retain a mutable Worker path after the graph walk",
      );
    },
  );

  it("rejects bundled Worker entries whose local import graph reaches a blocked remote", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "./worker-helper.ts"; self.postMessage("unreachable");`,
    );
    await fs.writeTextFile(
      join(tmpDir, "worker-helper.ts"),
      `import "https://blocked.example.com/worker-helper.js";`,
    );

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      async () =>
        await loadHandlerModule({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Remote import blocked",
      "a bundled Worker entry must validate local imports loaded by the worker module",
    );
  });

  it("rejects bundled Worker imports mapped to a blocked remote", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "worker-lib": "https://blocked.example.com/worker-lib.js" } }\n`,
    );
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "worker-lib"; self.postMessage("unreachable");`,
    );

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      async () =>
        await loadHandlerModule({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Remote import blocked",
      "a Worker import-map alias must be checked against the remote allow-list",
    );
  });

  it("rejects remote imports that a bundled Worker would load outside the HTTP plugin", async () => {
    for (
      const { denoConfig, workerImport } of [
        {
          denoConfig: undefined,
          workerImport: `https://esm.sh/yaml@2`,
        },
        {
          denoConfig: `{ "imports": { "worker-lib": "https://esm.sh/yaml@2" } }\n`,
          workerImport: `worker-lib`,
        },
      ]
    ) {
      const tmpDir = await makeTempDir();
      if (denoConfig !== undefined) {
        await fs.writeTextFile(join(tmpDir, "deno.json"), denoConfig);
      }
      await fs.writeTextFile(
        join(tmpDir, "worker.ts"),
        `import "${workerImport}"; self.postMessage("unreachable");`,
      );
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `const marker = /x/;`,
          `export function GET() {`,
          `  const worker = new Worker("./worker.ts", { type: "module" });`,
          `  worker.terminate();`,
          `  return new Response("ok-" + marker.source);`,
          `}`,
        ].join("\n"),
      );

      await assertRejects(
        async () =>
          await loadHandlerModule({
            projectDir: tmpDir,
            modulePath,
            adapter,
            config: undefined,
          }),
        Error,
        "Worker remote import cannot be validated transitively",
        `${workerImport} must not bypass validation of the remote module's own graph`,
      );
    }
  });

  it("validates local import-map descendants in bundled Worker graphs", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "imports": { "worker-helper": "./worker-helper.ts" } }\n`,
    );
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "worker-helper"; self.postMessage("unreachable");`,
    );
    await fs.writeTextFile(
      join(tmpDir, "worker-helper.ts"),
      `import "https://blocked.example.com/worker-helper.js";`,
    );

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      async () =>
        await loadHandlerModule({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Remote import blocked",
      "a local Worker alias must be traversed before the Worker is allowed to start",
    );
  });

  it("rejects bare imports in bundled Worker graphs when the import map is undecidable", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "deno.json"),
      `{ "extends": "./base.json", "imports": { "worker-helper": "./worker-helper.ts" } }\n`,
    );
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "worker-helper"; self.postMessage("unreachable");`,
    );
    await fs.writeTextFile(join(tmpDir, "worker-helper.ts"), `export {};`);

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      async () =>
        await loadHandlerModule({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Worker import cannot be validated",
      "an undecidable import map must not let a Worker resolve an unchecked bare import",
    );
  });

  it("rejects relative imports in bundled Worker graphs when the import map is undecidable", async () => {
    const tmpDir = await makeTempDir();
    await fs.writeTextFile(
      join(tmpDir, "base.json"),
      `{ "imports": { "./helper.ts": "https://blocked.example/mod.js" } }\n`,
    );
    await fs.writeTextFile(join(tmpDir, "deno.json"), `{ "extends": "./base.json" }\n`);
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      `import "./helper.ts"; self.postMessage("unreachable");`,
    );
    await fs.writeTextFile(join(tmpDir, "helper.ts"), `export {};`);

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      () => loadHandlerModule({ projectDir: tmpDir, modulePath, adapter, config: undefined }),
      Error,
      "Worker import cannot be validated",
      "an inherited map may remap a relative Worker edge outside the validated graph",
    );
  });

  it("rejects bundled Worker entries whose nested Worker reaches a blocked remote", async () => {
    const tmpDir = await makeTempDir();
    await fs.mkdir(join(tmpDir, "nested"), { recursive: true });
    await fs.writeTextFile(
      join(tmpDir, "worker.ts"),
      [
        `const nested = new Worker("./nested/worker.ts", { type: "module" });`,
        `nested.terminate();`,
        `self.postMessage("unreachable");`,
      ].join("\n"),
    );
    await fs.writeTextFile(
      join(tmpDir, "nested", "worker.ts"),
      `import "https://blocked.example.com/nested-worker.js";`,
    );

    const modulePath = join(tmpDir, "route.ts");
    await fs.writeTextFile(
      modulePath,
      [
        `const marker = /x/;`,
        `export function GET() {`,
        `  const worker = new Worker("./worker.ts", { type: "module" });`,
        `  worker.terminate();`,
        `  return new Response("ok-" + marker.source);`,
        `}`,
      ].join("\n"),
    );

    await assertRejects(
      async () =>
        await loadHandlerModule({
          projectDir: tmpDir,
          modulePath,
          adapter,
          config: undefined,
        }),
      Error,
      "Remote import blocked",
      "nested local Worker entries must be validated relative to the Worker module that starts them",
    );
  });

  it("preserves module URL suffixes while resolving bundled relative imports", async () => {
    for (const suffix of ["?version=1", "#named"]) {
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(join(tmpDir, "helper.ts"), `export const help = "helped";`);
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { help } from "./helper.ts${suffix}";`,
          `const marker = /x/;`,
          `export const GET = () => new Response(help + marker.source);`,
        ].join("\n"),
      );

      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertEquals(
        await getText(route),
        "helpedx",
        `the filesystem path must exclude ${suffix} while esbuild retains it as a module suffix`,
      );
    }
  });

  it("preserves query and hash suffixes after splitting an encoded module path", async () => {
    for (const suffix of ["?version=1", "#named"]) {
      const tmpDir = await makeTempDir();
      await fs.writeTextFile(join(tmpDir, "helper.ts"), `export const help = "helped";`);
      const modulePath = join(tmpDir, "route.ts");
      await fs.writeTextFile(
        modulePath,
        [
          `import { help } from "./%68elper.ts${suffix}";`,
          `const marker = /x/;`,
          `export const GET = () => new Response(help + marker.source);`,
        ].join("\n"),
      );

      const route = await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
      assertEquals(
        await getText(route),
        "helpedx",
        `the raw ${suffix} suffix must survive after the encoded path segment is decoded`,
      );
    }
  });
});

/**
 * Load the emitted compiled-binary shim as a real module so its containment
 * checks are exercised instead of being re-implemented by the test.
 */
async function importCompiledBinaryRequireShim(
  projectDir: string,
): Promise<(id: string) => unknown> {
  const shimPath = join(projectDir, "vf-require-shim.mjs");
  await fs.writeTextFile(
    shimPath,
    `${generateCompiledBinaryRequireShim(projectDir)}\nexport { require as vfRequire };\n`,
  );
  const module = await import(toFileUrl(shimPath).href) as {
    vfRequire: (id: string) => unknown;
  };
  return module.vfRequire;
}

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

  it("canonicalises the resolved path before checking containment", () => {
    const shim = generateCompiledBinaryRequireShim("/fake/project");
    assertEquals(shim.includes("Deno.realPathSync"), true);
    // The containment check must run on the canonical path. Asserting on the
    // pre-canonical one instead compares a non-canonical candidate against an
    // already-canonical root, which rejects legitimate dependencies whenever
    // the project root is itself a symlink.
    const canonIdx = shim.indexOf("resolved = __vf_canonicalize(resolved)");
    const assertIdx = shim.indexOf("__vf_assertContained(resolved)", canonIdx);
    assertEquals(
      canonIdx !== -1 && assertIdx > canonIdx,
      true,
      "the resolved path must be canonicalised before it is containment-checked",
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

  denoIt("the emitted containment check rejects paths outside the project root", async () => {
    // Execute the shim the generator actually emits: a local re-implementation
    // would keep passing even if the emitted __vf_assertContained were gutted.
    const projectDir = Deno.realPathSync(await makeTempDir());
    const packageDir = join(projectDir, "node_modules", "ok");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeTextFile(join(packageDir, "index.js"), "module.exports = { ok: true };");

    const vfRequire = await importCompiledBinaryRequireShim(projectDir);

    assertEquals(
      (vfRequire(join(packageDir, "index.js")) as { ok: boolean }).ok,
      true,
      "in-project CJS must load",
    );
    assertThrows(
      () => vfRequire("/etc/passwd"),
      Error,
      "blocked path outside project",
      "absolute host paths must be refused",
    );
    assertThrows(
      () => vfRequire(`${projectDir}ile/secret.js`),
      Error,
      "blocked path outside project",
      "prefix-sibling dirs must be refused",
    );
    assertThrows(
      () => vfRequire(join(projectDir, "node_modules", "..", "..", "escape.js")),
      Error,
      "blocked path outside project",
      "'..' segments must be normalised before the containment check",
    );

    try {
      await fs.remove(projectDir, { recursive: true });
    } catch (_) { /* best effort */ }
  });
});

describe("generateCompiledBinaryRequireShim - symlink resistance (VULN-FS-5)", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  denoIt("re-canonicalisation via realPathSync catches a node_modules symlink escape", async () => {
    // Create a project root, a decoy "evil" package whose entry file is a
    // symlink pointing at a file outside the project root. If the shim only
    // checked the pre-symlink path, the containment test would pass but the
    // readTextFileSync would still leak the external file. The emitted shim is
    // executed here so the realPathSync + second __vf_assertContained is the
    // thing under test, not a copy of it.
    const projectDir = Deno.realPathSync(await makeTempDir());
    const outsideDir = Deno.realPathSync(await makeTempDir());
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

    const vfRequire = await importCompiledBinaryRequireShim(projectDir);

    const error = assertThrows(
      () => vfRequire(symlinkEntry),
      Error,
      "blocked path outside project",
      "a symlinked dependency escaping the project root must be rejected",
    );
    assertEquals(
      (error as Error).message.includes("top-secret-contents"),
      false,
      "the outside file contents must never reach the caller",
    );

    // Clean up.
    try {
      await fs.remove(projectDir, { recursive: true });
    } catch (_) { /* best effort */ }
    try {
      await fs.remove(outsideDir, { recursive: true });
    } catch (_) { /* best effort */ }
  });

  denoIt("accepts dependencies through a symlinked project root", async () => {
    // Regression for #4091. The previous version of this test re-implemented
    // __vf_assertContained locally and only ever called it with the already
    // canonicalised path, so it passed without ever exercising the check that
    // actually rejected these dependencies. The emitted shim is executed here
    // so the containment check itself is the thing under test.
    const realProject = Deno.realPathSync(await makeTempDir());
    const symlinkedProject = `${realProject}-link`;
    try {
      await Deno.symlink(realProject, symlinkedProject);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("permission") || msg.includes("not supported")) return;
      throw e;
    }

    const depDir = join(realProject, "node_modules", "ok");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeTextFile(join(depDir, "index.js"), "module.exports = { ok: true };");

    // The project root is handed to the shim as the symlinked path, which is
    // what happens with package managers, CI checkouts, and macOS /tmp.
    const vfRequire = await importCompiledBinaryRequireShim(symlinkedProject);

    assertEquals(
      (vfRequire(join(symlinkedProject, "node_modules", "ok", "index.js")) as { ok: boolean })
        .ok,
      true,
      "a dependency genuinely inside the project must load when the root is a symlink",
    );

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
