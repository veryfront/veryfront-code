import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  clearConfigCache,
  getCachedConfigSync,
  getConfig,
  mergeConfigs,
  transpileConfigSourceForImport,
} from "./loader.ts";
import { createMockAdapter } from "../platform/adapters/mock.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { ESBUILD_VERSION } from "#veryfront/platform/compat/esbuild-shared.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { unregister as unregisterExtensionContract } from "#veryfront/extensions/contracts.ts";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolved) => {
    resolve = resolved;
  });
  return { promise, resolve };
}

function setup() {
  clearConfigCache();
  return createMockAdapter();
}

function withHostEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

async function withHostEnvironmentAsync<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function markAdapterAsVirtual(
  adapter: ReturnType<typeof createMockAdapter>,
  isMultiProjectMode: boolean,
): void {
  Object.assign(adapter.fs, {
    [FS_ADAPTER_KIND]: isMultiProjectMode ? "veryfront-multi-project" : "veryfront",
    getUnderlyingAdapter: () => adapter.fs,
    isMultiProjectMode: () => isMultiProjectMode,
    isVeryfrontAdapter: () => true,
  });
}

describe("config/loader", () => {
  describe("transpileConfigSourceForImport", () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    it("should transpile typed config files without rewriting string literals", async () => {
      const source = `
type LocalConfig = { title: string; description: string };
const literal = "keep as const text";
const config: LocalConfig = {
  title: "Typed Project",
  description: literal as string,
};

export default config as const;
`;

      const result = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
        default: { title: string; description: string };
      };

      assert(!result.includes("type LocalConfig"));
      assert(!result.includes(": LocalConfig"));
      assert(result.includes('"keep as const text"'));
      assertEquals(module.default.title, "Typed Project");
      assertEquals(module.default.description, "keep as const text");
    });

    it("initializes its bundler contract when used outside server bootstrap", async () => {
      unregisterExtensionContract("Bundler");
      unregisterExtensionContract("ModuleLexer");

      const result = await transpileConfigSourceForImport(
        "const title: string = 'Standalone'; export default { title };",
        "/app/veryfront.config.ts",
      );

      assert(result.includes("Standalone"));
      assert(!result.includes(": string"));
    });
  });

  describe("clearConfigCache", () => {
    it("should not throw when called on empty cache", () => {
      clearConfigCache();
    });

    it("should invalidate previously cached configs", async () => {
      const adapter = setup();

      const config1 = await getConfig("/test-project", adapter);
      assert(config1 !== null);

      const config2 = await getConfig("/test-project", adapter);
      assertEquals(config2, config1);

      clearConfigCache();
      const config3 = await getConfig("/test-project", adapter);
      assert(config3 !== null);
      assert(config3 !== config1, "Expected new object after cache clear");
    });

    it("does not let a load started before clear repopulate the cache", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-stale-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "Stale load" };';
      const started = createDeferred();
      const release = createDeferred();
      const originalExists = adapter.fs.exists.bind(adapter.fs);

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
        Object.assign(adapter.fs, {
          exists: async (path: string) => {
            started.resolve();
            await release.promise;
            return originalExists(path);
          },
        });

        const pending = getConfig(projectDir, adapter);
        await started.promise;
        clearConfigCache();
        release.resolve();
        await pending;

        assertEquals(getCachedConfigSync(projectDir), null);
      } finally {
        release.resolve();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("getCachedConfigSync", () => {
    it("should return null for uncached project", () => {
      clearConfigCache();
      assertEquals(getCachedConfigSync("/nonexistent-project"), null);
    });

    it("returns the config cached for a project directory", async () => {
      const adapter = setup();
      const config = await getConfig("/cached-project", adapter);

      assertEquals(getCachedConfigSync("/cached-project"), config);
    });

    it("should return null after cache is cleared", async () => {
      const adapter = setup();

      await getConfig("/cached-project", adapter);
      clearConfigCache();

      assertEquals(getCachedConfigSync("/cached-project"), null);
    });
  });

  describe("getConfig", () => {
    it("should return default config when no config file exists", async () => {
      const adapter = setup();

      const config = await getConfig("/empty-project", adapter);
      assert(config !== null);
      assertEquals(config.title, "Veryfront App");
      assertEquals(config.description, "Built with Veryfront");
      assertEquals(config.build?.outDir, "dist");
      assertEquals(config.dev?.port, 3000);
      assertEquals(config.dev?.host, "localhost");
      assertEquals(config.dev?.open, false);
      assertEquals(config.client?.moduleResolution, "cdn");
      assertEquals(config.client?.cdn?.provider, "esm.sh");
    });

    it("should return cached config on subsequent calls", async () => {
      const adapter = setup();

      const config1 = await getConfig("/cached-test", adapter);
      const config2 = await getConfig("/cached-test", adapter);

      assertEquals(config1, config2);
    });

    it("keeps cached configuration immutable across consumers", async () => {
      const adapter = setup();
      const config = await getConfig("/immutable-cache-test", adapter);

      assert(Object.isFrozen(config));
      assert(Object.isFrozen(config.dev));
      assert(Object.isFrozen(config.resolve?.importMap?.imports));
      assertThrows(() => {
        if (config.dev) config.dev.port = 9_999;
      }, TypeError);

      const cached = await getConfig("/immutable-cache-test", adapter);
      assertEquals(cached.dev?.port, 3_000);
    });

    it("does not freeze opaque extension and middleware instances", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      adapter.fs.files.set(
        "/veryfront.config.js",
        [
          'const extension = { name: "custom", capabilities: [] };',
          'const middleware = { name: "custom-middleware" };',
          "export default { extensions: [extension], middleware: { custom: [middleware] } };",
        ].join("\n"),
      );

      const config = await getConfig("/opaque-config-values", adapter);
      const extension = config.extensions?.[0];
      const middleware = config.middleware?.custom?.[0];

      assert(Object.isFrozen(config.extensions));
      assert(Object.isFrozen(config.middleware?.custom));
      assertEquals(typeof extension, "object");
      assertEquals(typeof middleware, "object");
      assert(!Object.isFrozen(extension));
      assert(!Object.isFrozen(middleware));
    });

    it("deduplicates concurrent persistent loads for the same project", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-concurrent-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "Concurrent" };';
      const started = createDeferred();
      const release = createDeferred();
      const originalExists = adapter.fs.exists.bind(adapter.fs);
      let existsCalls = 0;

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
        Object.assign(adapter.fs, {
          exists: async (path: string) => {
            existsCalls++;
            started.resolve();
            await release.promise;
            return originalExists(path);
          },
        });

        const first = getConfig(projectDir, adapter);
        await started.promise;
        const second = getConfig(projectDir, adapter);
        release.resolve();

        const [firstConfig, secondConfig] = await Promise.all([first, second]);
        assertEquals(firstConfig, secondConfig);
        assertEquals(existsCalls, 1);
      } finally {
        release.resolve();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("should cache separately for different project directories", async () => {
      const adapter = setup();

      const configA = await getConfig("/project-a", adapter);
      const configB = await getConfig("/project-b", adapter);

      assert(configA !== null);
      assert(configB !== null);
      assertEquals(configA.title, "Veryfront App");
      assertEquals(configB.title, "Veryfront App");
    });

    it("should load and validate a JS config file", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-js-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "JS Project" };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "JS Project");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("loads config from paths containing spaces and fragment characters", async () => {
      const adapter = setup();
      const parentDir = await Deno.makeTempDir({ prefix: "vf-config-path-" });
      const projectDir = `${parentDir}/project #1`;
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "Special path" };';

      try {
        await Deno.mkdir(projectDir);
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "Special path");
      } finally {
        await Deno.remove(parentDir, { recursive: true });
      }
    });

    it("uses schema-normalized output instead of retaining nested unknown fields", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-normalized-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { dev: { port: 4321, internalMarker: "must-be-stripped" } };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals((config.dev as Record<string, unknown>).internalMarker, undefined);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("validates a falsy default export instead of falling back to the module namespace", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-falsy-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = "export default false;";

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        await assertRejects(
          () => getConfig(projectDir, adapter),
          Error,
          "Expected object, received boolean",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("loads canonical source integration restrictions", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      const projectDir = "/typed-integration-config";
      const configPath = "/veryfront.config.ts";
      const source = [
        'import { defineConfig } from "veryfront";',
        'export default defineConfig({ integrations: { allow: { linear: { allowedTools: ["search_issues"] } } } });',
      ].join("\n");

      adapter.fs.files.set(configPath, source);

      const config = await getConfig(projectDir, adapter);
      assertEquals(config.integrations, {
        allow: { linear: { allowedTools: ["search_issues"] } },
      });
    });

    it("provides supported authoring helpers to temporary config modules", async () => {
      await withHostEnvironmentAsync(
        { NODE_ENV: undefined, DENO_ENV: undefined },
        async () => {
          const adapter = setup();
          markAdapterAsVirtual(adapter, false);
          adapter.fs.files.set(
            "/veryfront.config.ts",
            [
              "import { defineConfig, defineConfigWithEnv, mergeConfigs } from 'veryfront';",
              'const base = defineConfig({ title: "Temporary module" });',
              "export default defineConfigWithEnv((env) =>",
              "  mergeConfigs(base, { description: `Environment: ${env}` })",
              ");",
            ].join("\n"),
          );

          const config = await getConfig("/temporary-helper-config", adapter);

          assertEquals(config.title, "Temporary module");
          assertEquals(config.description, "Environment: development");
        },
      );
    });

    it("does not rewrite import-like text outside module specifiers", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      adapter.fs.files.set(
        "/veryfront.config.ts",
        [
          'if (true) /from "veryfront"/.test(\'from "veryfront"\');',
          "const from = 1;",
          "from",
          '"veryfront";',
          'import { defineConfig } from "veryfront";',
          'export default defineConfig({ title: "Lexer-safe" });',
        ].join("\n"),
      );

      const config = await getConfig("/import-like-config", adapter);

      assertEquals(config.title, "Lexer-safe");
    });

    it("isolates virtual config values by exact branch, release, and environment", async () => {
      const adapter = setup();
      const reads: string[] = [];
      markAdapterAsVirtual(adapter, true);
      Object.assign(adapter.fs, {
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async () => {
          const source = getCurrentRequestContext();
          const target = !source?.productionMode
            ? `branch:${source?.branch ?? "main"}`
            : source.environmentName
            ? `env:${source.environmentName}:${source.releaseId}`
            : `release:${source.releaseId}`;
          reads.push(target);
          return `export default { title: ${JSON.stringify(target)} };`;
        },
      });

      const loadFor = (
        source: Parameters<typeof runWithRequestContext>[0],
      ) =>
        runWithRequestContext(
          source,
          () =>
            getConfig("/source-qualified-config", adapter, {
              cacheKey: "project-1",
              sourceContext: {
                productionMode: source.productionMode ?? false,
                releaseId: source.releaseId,
                branch: source.branch,
                environmentName: source.environmentName,
              },
            }),
        );

      const main = await loadFor({
        projectSlug: "demo",
        token: "token",
        branch: "main",
      });
      const preview = await loadFor({
        projectSlug: "demo",
        token: "token",
        branch: "feature/integrations",
      });
      const release = await loadFor({
        projectSlug: "demo",
        token: "token",
        productionMode: true,
        releaseId: "release-1",
      });
      const environment = await loadFor({
        projectSlug: "demo",
        token: "token",
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      });

      assertEquals(main.title, "branch:main");
      assertEquals(preview.title, "branch:feature/integrations");
      assertEquals(release.title, "release:release-1");
      assertEquals(environment.title, "env:Production:release-1");

      await loadFor({ projectSlug: "demo", token: "token", branch: "main" });
      await loadFor({
        projectSlug: "demo",
        token: "token",
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      });
      assertEquals(reads, [
        "branch:main",
        "branch:feature/integrations",
        "release:release-1",
        "env:Production:release-1",
        "branch:main",
      ]);
    });

    it("reloads mutable branch config across request contexts", async () => {
      const adapter = setup();
      let revision = "first";
      markAdapterAsVirtual(adapter, true);
      Object.assign(adapter.fs, {
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async () => `export default { title: ${JSON.stringify(revision)} };`,
      });

      const sourceContext = { productionMode: false, branch: "feature/integrations" } as const;
      const loadBranchConfig = () =>
        runWithRequestContext(
          { projectSlug: "demo", token: "token", branch: sourceContext.branch },
          () =>
            getConfig("/mutable-branch-config", adapter, {
              cacheKey: "project-1",
              sourceContext,
            }),
        );

      const first = await loadBranchConfig();
      revision = "second";
      const second = await loadBranchConfig();

      assertEquals(first.title, "first");
      assertEquals(second.title, "second");
    });

    it("does not persist virtual config without an exact source", async () => {
      const adapter = setup();
      let revision = "first";
      markAdapterAsVirtual(adapter, true);
      Object.assign(adapter.fs, {
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async () => `export default { title: ${JSON.stringify(revision)} };`,
      });

      const first = await getConfig("/contextless-virtual-config", adapter);
      revision = "second";
      const second = await getConfig("/contextless-virtual-config", adapter);

      assertEquals(first.title, "first");
      assertEquals(second.title, "second");
    });

    it("rejects an explicit source that differs from the request context", async () => {
      const adapter = setup();
      let reads = 0;
      markAdapterAsVirtual(adapter, true);
      Object.assign(adapter.fs, {
        exists: async () => true,
        readFile: async () => {
          reads++;
          return 'export default { title: "wrong source" };';
        },
      });

      await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo",
              token: "token",
              productionMode: true,
              environmentName: "Production:release-1",
              releaseId: "release-2",
            },
            () =>
              getConfig("/mismatched-source-config", adapter, {
                cacheKey: "project-1",
                sourceContext: {
                  productionMode: true,
                  environmentName: "Production",
                  releaseId: "release-1:release-2",
                },
              }),
          ),
        Error,
        "does not match the current request context",
      );
      assertEquals(reads, 0);
    });

    it("rejects legacy integration policy fields instead of normalizing them", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      const projectDir = "/legacy-integration-config";
      const configPath = "/veryfront.config.ts";
      const source = [
        'import { defineConfig } from "veryfront";',
        'export default defineConfig({ integrations: { linear: { scope: "endUser", tools: ["search_issues"] } } });',
      ].join("\n");

      adapter.fs.files.set(configPath, source);

      await assertRejects(
        () => getConfig(projectDir, adapter),
        Error,
        "integrations.allow",
      );
    });

    it("should try multiple config file names", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-mjs-" });
      const configPath = `${projectDir}/veryfront.config.mjs`;
      const source = 'export default { title: "MJS Project" };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "MJS Project");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a detected config file that cannot be imported", async () => {
      const adapter = setup();
      adapter.fs.files.set(
        "/broken-project/veryfront.config.js",
        "export default {",
      );

      const error = await assertRejects(() => getConfig("/broken-project", adapter));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-parse-error");
      assertEquals((error as Error & { cause?: unknown }).cause, undefined);
      assertEquals(getCachedConfigSync("/broken-project"), null);
    });

    it("sanitizes filesystem failures while checking for config files", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        exists: async () => {
          throw new Error("FILESYSTEM_FAILURE_CANARY");
        },
      });

      const error = await assertRejects(() => getConfig("/filesystem-failure", adapter));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-parse-error");
      assert(!JSON.stringify(error).includes("FILESYSTEM_FAILURE_CANARY"));
      assertEquals((error as Error & { cause?: unknown }).cause, undefined);
    });

    it("rejects invalid UTF-8 from a virtual config source", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      const prefix = new TextEncoder().encode('export default { title: "');
      const suffix = new TextEncoder().encode('" };');
      const invalidSource = new Uint8Array(prefix.length + 1 + suffix.length);
      invalidSource.set(prefix);
      invalidSource[prefix.length] = 0xff;
      invalidSource.set(suffix, prefix.length + 1);
      adapter.fs.files.set("/veryfront.config.ts", "");
      Object.assign(adapter.fs, {
        readFile: async () => invalidSource,
      });

      const error = await assertRejects(() => getConfig("/invalid-encoding", adapter));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-parse-error");
      assertEquals(getCachedConfigSync("/invalid-encoding"), null);
    });

    it("rejects oversized virtual config source before importing it", async () => {
      const adapter = setup();
      markAdapterAsVirtual(adapter, false);
      adapter.fs.files.set(
        "/veryfront.config.ts",
        `//${"x".repeat(4 * 1024 * 1024)}\nexport default {};`,
      );

      const error = await assertRejects(() => getConfig("/oversized-config", adapter));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-parse-error");
      assertEquals(getCachedConfigSync("/oversized-config"), null);
    });

    it("does not emit config source, project paths, or cache identifiers in logs", async () => {
      const adapter = setup();
      const entries: LogEntry[] = [];
      const previousLevel = Deno.env.get("LOG_LEVEL");
      const originalDebug = console.debug;
      markAdapterAsVirtual(adapter, false);
      adapter.fs.files.set(
        "/veryfront.config.ts",
        '// CONFIG_SOURCE_CANARY\nexport default { title: "Safe" };',
      );

      try {
        Deno.env.set("LOG_LEVEL", "DEBUG");
        refreshLoggerConfig();
        console.debug = () => {};
        __registerLogRecordEmitter((entry) => entries.push(entry));

        await getConfig("/PROJECT_PATH_CANARY", adapter, {
          cacheKey: "CACHE_IDENTIFIER_CANARY",
        });

        const serialized = JSON.stringify(entries);
        for (
          const marker of [
            "CONFIG_SOURCE_CANARY",
            "PROJECT_PATH_CANARY",
            "CACHE_IDENTIFIER_CANARY",
          ]
        ) {
          assert(!serialized.includes(marker), `logs must not contain ${marker}`);
        }
      } finally {
        __resetLogRecordEmitterForTests();
        console.debug = originalDebug;
        if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLevel);
        refreshLoggerConfig();
      }
    });

    it("should produce fresh defaults per call after cache clear", async () => {
      const adapter = setup();

      const config1 = await getConfig("/fresh-test-1", adapter);
      clearConfigCache();
      const config2 = await getConfig("/fresh-test-2", adapter);

      assert(config1 !== config2, "Expected different object references for fresh defaults");
      assertEquals(config1.title, config2.title);
    });

    it("should include default resolve.importMap", async () => {
      const adapter = setup();

      const config = await getConfig("/importmap-test", adapter);
      assert(config.resolve !== undefined);
      assert(config.resolve.importMap !== undefined);
      assert(config.resolve.importMap.imports !== undefined);
    });

    it("should include default cache.render config", async () => {
      const adapter = setup();

      const config = await getConfig("/cache-test", adapter);
      assert(config.cache !== undefined);
      assertEquals(config.cache.render?.type, "memory");
      assertEquals(config.cache.render?.maxEntries, 500);
    });

    it("should include default experimental config", async () => {
      const adapter = setup();

      const config = await getConfig("/experimental-test", adapter);
      assertEquals(config.experimental?.esmLayouts, true);
    });

    it("should include default build.esbuild config", async () => {
      const adapter = setup();

      const config = await getConfig("/build-test", adapter);
      assertEquals(config.build?.trailingSlash, false);
      assertEquals(config.build?.esbuild?.worker, false);
      assert(typeof config.build?.esbuild?.wasmURL === "string");
    });

    it("should include default theme config", async () => {
      const adapter = setup();

      const config = await getConfig("/theme-test", adapter);
      assertEquals(config.theme?.colors?.primary, "#3B82F6");
    });
  });

  describe("mergeConfigs deep merge", () => {
    it("fails closed when proxy mode has no API filesystem endpoint", () => {
      withHostEnvironment(
        { PROXY_MODE: "1", VERYFRONT_API_BASE_URL: undefined },
        () => {
          assertThrows(
            () => mergeConfigs({}),
            VeryfrontError,
            "Proxy mode requires VERYFRONT_API_BASE_URL",
          );
        },
      );
    });

    it("rejects unsafe proxy filesystem endpoints before building defaults", () => {
      for (
        const apiBaseUrl of [
          "not a URL",
          "file:///tmp/veryfront-api",
          "https://user:password@api.example.test",
          " https://api.example.test/api ",
          "https://api.example.test/\napi",
          "https://api.example.test/api?tenant=unexpected",
          "https://api.example.test/api#fragment",
          `https://api.example.test/${"x".repeat(2_048)}`,
        ]
      ) {
        withHostEnvironment(
          { PROXY_MODE: "1", VERYFRONT_API_BASE_URL: apiBaseUrl },
          () => {
            assertThrows(
              () => mergeConfigs({}),
              VeryfrontError,
              "Proxy mode requires a safe HTTP or HTTPS API base URL",
            );
          },
        );
      }
    });

    it("uses a validated proxy filesystem endpoint", () => {
      withHostEnvironment(
        {
          PROXY_MODE: "1",
          VERYFRONT_API_BASE_URL: "http://internal-api.example.test:8080/api",
        },
        () => {
          const merged = mergeConfigs({});
          assertEquals(merged.fs?.type, "veryfront-api");
          assertEquals(
            merged.fs?.veryfront?.apiBaseUrl,
            "http://internal-api.example.test:8080/api",
          );
        },
      );
    });

    it("does not let project config override proxy filesystem routing", () => {
      withHostEnvironment(
        {
          PROXY_MODE: "1",
          VERYFRONT_API_BASE_URL: "https://api.example.test/api",
        },
        () => {
          for (
            const fs of [
              { type: "local" as const },
              { type: "github" as const, github: {} },
              {
                type: "veryfront-api" as const,
                veryfront: { apiBaseUrl: "https://tenant.example.test/api" },
              },
            ]
          ) {
            assertThrows(
              () => mergeConfigs({ fs }),
              VeryfrontError,
              "Project config cannot override filesystem routing in proxy mode",
            );
          }
        },
      );
    });

    it("keeps host proxy filesystem settings for a canonical project marker", () => {
      withHostEnvironment(
        {
          PROXY_MODE: "1",
          VERYFRONT_API_BASE_URL: "https://api.example.test/api",
        },
        () => {
          const merged = mergeConfigs({ fs: { type: "veryfront-api" } });
          assertEquals(merged.fs?.type, "veryfront-api");
          assertEquals(merged.fs?.veryfront?.apiBaseUrl, "https://api.example.test/api");
          assertEquals(merged.fs?.veryfront?.proxyMode, true);
          assert(Object.isFrozen(merged));
          assert(Object.isFrozen(merged.fs));
          assert(Object.isFrozen(merged.fs?.veryfront));
          assert(Object.isFrozen(merged.fs?.veryfront?.cache));
          assert(Object.isFrozen(merged.fs?.veryfront?.retry));
        },
      );
    });

    it("does not let project environment overlays select proxy filesystem routing", () => {
      withHostEnvironment(
        { PROXY_MODE: undefined, VERYFRONT_API_BASE_URL: undefined },
        () => {
          const merged = runWithProjectEnv(
            {
              PROXY_MODE: "1",
              VERYFRONT_API_BASE_URL: "https://tenant.example.test/api",
            },
            () => mergeConfigs({}),
          );
          assertEquals(merged.fs?.type, "local");
          assertEquals(merged.fs?.veryfront, undefined);
        },
      );
    });

    it("does not let project environment overlays replace the host proxy endpoint", () => {
      withHostEnvironment(
        {
          PROXY_MODE: "1",
          VERYFRONT_API_BASE_URL: "https://host.example.test/api",
        },
        () => {
          const merged = runWithProjectEnv(
            { VERYFRONT_API_BASE_URL: "https://tenant.example.test/api" },
            () => mergeConfigs({ fs: { type: "veryfront-api" } }),
          );
          assertEquals(merged.fs?.veryfront?.apiBaseUrl, "https://host.example.test/api");
        },
      );
    });

    it("does not synthesize Veryfront API settings for a local filesystem", () => {
      const merged = mergeConfigs({});
      assertEquals(merged.fs?.type, "local");
      assertEquals(merged.fs?.veryfront, undefined);
    });

    it("keeps default cache.render when user overrides only cache.dir", () => {
      const merged = mergeConfigs({ cache: { dir: "/custom" } });
      assertEquals(merged.cache?.dir, "/custom");
      // render sub-object must survive the partial override (regression: shallow
      // spread dropped it and crashed callers reading cache.render.type).
      assertEquals(merged.cache?.render?.type, "memory");
      assertEquals(merged.cache?.render?.maxEntries, 500);
    });

    it("keeps default build.esbuild fields when user overrides only build.outDir", () => {
      const merged = mergeConfigs({ build: { outDir: "out" } });
      assertEquals(merged.build?.outDir, "out");
      assertEquals(merged.build?.esbuild?.worker, false);
      assert(typeof merged.build?.esbuild?.wasmURL === "string");
      assert(merged.build?.esbuild?.wasmURL?.includes(`@v${ESBUILD_VERSION}/`));
    });

    it("keeps default theme colors when user sets an unrelated color", () => {
      const merged = mergeConfigs({ theme: { colors: { secondary: "#000000" } } });
      assertEquals(merged.theme?.colors?.primary, "#3B82F6");
      assertEquals(merged.theme?.colors?.secondary, "#000000");
    });
  });
});
