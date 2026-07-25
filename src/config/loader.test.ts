import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  __getHostedConfigFlightStateForTests,
  __getTrustedConfigFlightStateForTests,
  __setHostedConfigEvaluatorForTests,
  clearConfigCache,
  getCachedConfigSync,
  getConfig,
  getConfigWithProvenance,
  getHostedConfig,
  mergeConfigs,
  rewriteBareVeryfrontConfigImports,
  transpileConfigSourceForImport,
} from "./loader.ts";
import { createMockAdapter } from "../platform/adapters/mock.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  DeclarativeConfigEvaluationError,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import { DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS } from "./declarative-evaluator-worker-runner.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  deleteEnv,
  getEnvOverlayStorage,
  getHostEnv,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import { ESBUILD_WASM_URL } from "#veryfront/platform/compat/esbuild-shared.ts";

const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestReflectApply = Reflect.apply;
const TestReflectOwnKeys = Reflect.ownKeys;

function replacePropertyForTest(
  target: object,
  key: PropertyKey,
  replacement: PropertyDescriptor,
): () => void {
  const original = TestObjectGetOwnPropertyDescriptor(target, key);
  if (!original) throw new Error(`Expected an own descriptor for ${String(key)}`);
  TestObjectDefineProperty(target, key, {
    ...original,
    ...replacement,
  });
  return () => {
    TestObjectDefineProperty(target, key, original);
  };
}

function setup() {
  clearConfigCache();
  return createMockAdapter();
}

function configCandidateNotFound(path: string): Error {
  return Object.assign(new Error(`File not found: ${path}`), {
    code: "ENOENT",
  });
}

async function waitForHostedFlightState(
  expected: Readonly<{ flights: number; waiters: number }>,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = __getHostedConfigFlightStateForTests();
    if (
      current.flights === expected.flights &&
      current.waiters === expected.waiters
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Timed out waiting for hosted flight state ${JSON.stringify(expected)}; observed ${
      JSON.stringify(__getHostedConfigFlightStateForTests())
    }`,
  );
}

async function waitForTrustedFlightCount(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = __getTrustedConfigFlightStateForTests();
    if (current.flights === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Timed out waiting for ${expected} trusted config flights; observed ${__getTrustedConfigFlightStateForTests().flights}`,
  );
}

describe("config/loader", () => {
  afterEach(() => {
    __setHostedConfigEvaluatorForTests();
  });

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
  });

  describe("rewriteBareVeryfrontConfigImports", () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    it("rewrites bare veryfront specifiers to a loadable shim", async () => {
      const rewritten = await rewriteBareVeryfrontConfigImports(
        'import { defineConfig } from "veryfront";\nexport default defineConfig({});',
      );

      assert(!rewritten.includes('"veryfront"'), "bare specifier must be replaced");
      assert(rewritten.includes("data:text/javascript,"), "specifier must point at the shim");
    });

    it("handles single quotes and leaves other specifiers untouched", async () => {
      const rewritten = await rewriteBareVeryfrontConfigImports(
        "import { defineConfig } from 'veryfront';\nimport other from './local.ts';\nimport 'veryfront';",
      );

      assert(!rewritten.includes("'veryfront'"));
      assert(rewritten.includes("./local.ts"), "relative imports must stay untouched");
    });

    it("does not rewrite veryfront subpath or lookalike specifiers", async () => {
      const source =
        'import { a } from "veryfront/head";\nimport { b } from "not-veryfront";\nconst s = "veryfront";';
      assertEquals(await rewriteBareVeryfrontConfigImports(source), source);
    });

    it("does not rewrite import-like text outside module declarations", async () => {
      const source = [
        "const quoted = 'from \"veryfront\"';",
        "const sideEffect = 'import \"veryfront\"';",
        'const pattern = /from "veryfront"/;',
        'const template = `import "veryfront"`;',
        '// import "veryfront"',
        '/* export { defineConfig } from "veryfront" */',
      ].join("\n");

      assertEquals(await rewriteBareVeryfrontConfigImports(source), source);
    });

    it("produces a module whose defineConfig behaves as identity end to end", async () => {
      const source = [
        'import { defineConfig } from "veryfront";',
        'export default defineConfig({ projectSlug: "shimmed", title: "Shim" });',
      ].join("\n");

      const transpiled = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const rewritten = await rewriteBareVeryfrontConfigImports(transpiled);
      const module = await import(`data:application/javascript;base64,${btoa(rewritten)}`) as {
        default: { projectSlug: string; title: string };
      };

      assertEquals(module.default.projectSlug, "shimmed");
      assertEquals(module.default.title, "Shim");
    });

    it("shims defineConfigWithEnv with a working environment factory", async () => {
      const source = [
        'import { defineConfigWithEnv } from "veryfront";',
        "export default defineConfigWithEnv((env) => ({ title: `env:${env}` }));",
      ].join("\n");

      const transpiled = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const rewritten = await rewriteBareVeryfrontConfigImports(transpiled);
      const module = await import(`data:application/javascript;base64,${btoa(rewritten)}`) as {
        default: { title: string };
      };

      assert(module.default.title.startsWith("env:"), "factory must receive an env name");
    });

    it("bridges getEnv through the active environment scope", async () => {
      setEnv("VERYFRONT_CONFIG_SHIM_TEST", "scoped-value");
      const source = [
        'import { defineConfig, getEnv } from "veryfront";',
        'export default defineConfig({ title: getEnv("VERYFRONT_CONFIG_SHIM_TEST") });',
      ].join("\n");

      const transpiled = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const rewritten = await rewriteBareVeryfrontConfigImports(transpiled);
      const module = await import(`data:application/javascript;base64,${btoa(rewritten)}`) as {
        default: { title: string };
      };

      assertEquals(module.default.title, "scoped-value");
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

    it("does not repopulate the cache from a load invalidated in flight", async () => {
      const adapter = setup();
      const projectDir = "/in-flight-clear";
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      let firstCheck = true;

      adapter.fs.exists = async () => {
        if (firstCheck) {
          firstCheck = false;
          started.resolve();
          await resume.promise;
        }
        return false;
      };

      const staleRequest = getConfig(projectDir, adapter);
      await started.promise;
      clearConfigCache();
      const fresh = await getConfig(projectDir, adapter);
      resume.resolve();
      const stale = await staleRequest;

      assertStrictEquals(getCachedConfigSync(projectDir), fresh);
      assert(
        stale !== fresh,
        "a cleared revision must not join or replace the fresh revision's flight",
      );
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

    it("reports explicit default provenance when no config file exists", async () => {
      const adapter = setup();

      const result = await getConfigWithProvenance(
        "/empty-project-provenance",
        adapter,
      );

      assertEquals(result.provenance, { kind: "defaults" });
      assertEquals(result.config.title, "Veryfront App");
    });

    it("reports file provenance even when a present config matches default values", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-config-provenance-",
      });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = [
        "export default {",
        '  title: "Veryfront App",',
        '  dev: { port: 3000, host: "localhost", hmr: false },',
        "};",
      ].join("\n");

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const result = await getConfigWithProvenance(projectDir, adapter);

        assertEquals(result.provenance, {
          kind: "file",
          configFile: "veryfront.config.js",
        });
        assertEquals(result.config.dev?.port, 3000);
        assertEquals(result.config.dev?.host, "localhost");
        assertEquals(result.config.dev?.hmr, false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("selects trusted virtual config from one explicit read outcome", async () => {
      const adapter = setup();
      const reads: string[] = [];
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        exists: () => {
          throw new Error("explicit provenance must not use an exists heuristic");
        },
        readFile: async (path: string) => {
          reads.push(path);
          if (path === "/veryfront.config.ts") {
            return [
              "export default {",
              '  title: "Veryfront App",',
              '  dev: { port: 3000, host: "localhost", hmr: false },',
              "};",
            ].join("\n");
          }
          throw configCandidateNotFound(path);
        },
      });

      const result = await getConfigWithProvenance(
        "/explicit-virtual-provenance",
        adapter,
        { cacheKey: "explicit-virtual-provenance" },
      );

      assertEquals(reads, [
        "/veryfront.config.js",
        "/veryfront.config.ts",
      ]);
      assertEquals(result.provenance, {
        kind: "file",
        configFile: "veryfront.config.ts",
      });
      assertEquals(result.config.dev?.port, 3000);
      assertEquals(result.config.dev?.hmr, false);
    });

    it("propagates trusted virtual backend errors instead of reporting absence", async () => {
      const adapter = setup();
      const backendError = new Error("virtual config backend unavailable");
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        exists: () => {
          throw new Error("trusted virtual loads must not use exists");
        },
        readFile: () => Promise.reject(backendError),
      });

      for (
        const load of [
          () => getConfig("/explicit-virtual-error", adapter),
          () =>
            getConfigWithProvenance(
              "/explicit-virtual-error",
              adapter,
            ),
        ]
      ) {
        const error = await assertRejects(load);
        assertStrictEquals(error, backendError);
      }
    });

    it("shares one authoritative virtual read across both loader APIs", async () => {
      const adapter = setup();
      const readStarted = Promise.withResolvers<void>();
      const resumeRead = Promise.withResolvers<void>();
      const sourceContext = {
        productionMode: true,
        releaseId: "authoritative-read-release",
      } as const;
      let reads = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        exists: () => {
          throw new Error("trusted virtual loads must not use exists");
        },
        readFile: async () => {
          reads += 1;
          readStarted.resolve();
          await resumeRead.promise;
          return 'export default { title: "REMOTE" };';
        },
      });

      await runWithRequestContext(
        {
          projectSlug: "authoritative-read-project",
          projectId: "authoritative-read-project",
          token: "token",
          productionMode: true,
          releaseId: sourceContext.releaseId,
        },
        async () => {
          const options = {
            cacheKey: "authoritative-read-project",
            sourceContext,
          };
          const ordinaryRequest = getConfig(
            "/authoritative-read-project",
            adapter,
            options,
          );
          await readStarted.promise;
          const explicitRequest = getConfigWithProvenance(
            "/authoritative-read-project",
            adapter,
            options,
          );
          resumeRead.resolve();

          const [ordinary, explicit] = await Promise.all([
            ordinaryRequest,
            explicitRequest,
          ]);
          assertEquals(ordinary.title, "REMOTE");
          assertEquals(explicit.provenance, {
            kind: "file",
            configFile: "veryfront.config.js",
          });
          assertStrictEquals(explicit.config, ordinary);
          assertEquals(reads, 1);

          const cached = await getConfig(
            "/authoritative-read-project",
            adapter,
            options,
          );
          assertStrictEquals(cached, ordinary);
          assertEquals(reads, 1);
        },
      );
    });

    it("should return cached config on subsequent calls", async () => {
      const adapter = setup();

      const config1 = await getConfig("/cached-test", adapter);
      const config2 = await getConfig("/cached-test", adapter);

      assertEquals(config1, config2);
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

    describe("trusted config single-flight", () => {
      it("executes one exact concurrent config module once and shares its identity", async () => {
        const adapter = setup();
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-config-single-flight-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        const counterKey = `__veryfront_config_single_flight_${
          crypto.randomUUID().replaceAll("-", "_")
        }`;
        const source = [
          `const key = ${JSON.stringify(counterKey)};`,
          "globalThis[key] = (globalThis[key] ?? 0) + 1;",
          "export default { title: `execution-${globalThis[key]}` };",
        ].join("\n");

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          const [first, second, third] = await Promise.all([
            getConfig(projectDir, adapter),
            getConfig(projectDir, adapter),
            getConfig(projectDir, adapter),
          ]);

          assertEquals(first.title, "execution-1");
          assertStrictEquals(second, first);
          assertStrictEquals(third, first);
          assertEquals(
            (globalThis as Record<string, unknown>)[counterKey],
            1,
          );
          await waitForTrustedFlightCount(0);
        } finally {
          delete (globalThis as Record<string, unknown>)[counterKey];
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("evicts rejected flights so a later request can retry", async () => {
        const adapter = setup();
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-config-single-flight-retry-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        const counterKey = `__veryfront_config_retry_${crypto.randomUUID().replaceAll("-", "_")}`;
        const source = [
          `const key = ${JSON.stringify(counterKey)};`,
          "const attempt = (globalThis[key] ?? 0) + 1;",
          "globalThis[key] = attempt;",
          'if (attempt === 1) throw new Error("first execution failed");',
          "export default { title: `execution-${attempt}` };",
        ].join("\n");

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          await assertRejects(
            () => getConfig(projectDir, adapter),
            Error,
            "Failed to load veryfront.config.js",
          );
          await waitForTrustedFlightCount(0);

          const recovered = await getConfig(projectDir, adapter);

          assertEquals(recovered.title, "execution-2");
          assertEquals(
            (globalThis as Record<string, unknown>)[counterKey],
            2,
          );
        } finally {
          delete (globalThis as Record<string, unknown>)[counterKey];
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("bounds distinct concurrent loads and recovers capacity after they drain", async () => {
        const adapter = setup();
        const gate = Promise.withResolvers<void>();
        const { maxFlights } = __getTrustedConfigFlightStateForTests();
        adapter.fs.exists = async () => {
          await gate.promise;
          return false;
        };

        const pending = Array.from(
          { length: maxFlights },
          (_, index) => getConfig(`/bounded-flight-${index}`, adapter),
        );

        try {
          await waitForTrustedFlightCount(maxFlights);
          const error = await assertRejects(
            () => getConfig("/bounded-flight-overflow", adapter),
            VeryfrontError,
          ) as VeryfrontError;
          assertEquals(error.slug, "service-overloaded");
        } finally {
          gate.resolve();
          await Promise.allSettled(pending);
        }

        await waitForTrustedFlightCount(0);
        const recovered = await getConfig("/bounded-flight-recovered", adapter);
        assertEquals(recovered.title, "Veryfront App");
      });
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

    it("loads config paths containing URL-significant characters", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf config #project-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "Encoded Path Project" };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "Encoded Path Project");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("loads canonical source integration restrictions", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
      });
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

    it("evaluates hosted multi-project config in the real worker with tenant env", async () => {
      const adapter = setup();
      const sourceContext = {
        productionMode: false,
        branch: "feature/hosted-config",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: { TENANT: "tenant-value" },
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return `
            import { defineConfigWithEnv, getEnv } from "veryfront";
            export default defineConfigWithEnv((environmentName) => ({
              title: \`\${environmentName}:\${getEnv("TENANT") ?? "missing"}\`,
            }));
          `;
        },
      });

      const config = await runWithRequestContext(
        {
          projectSlug: "demo",
          projectId: "project-1",
          token: "token",
          branch: sourceContext.branch,
        },
        () =>
          getHostedConfig("/hosted-worker-config", adapter, {
            cacheKey: "project-1",
            sourceContext,
            preparedContext,
          }),
      );

      assertEquals(config.title, "preview:tenant-value");
      assert(Object.isFrozen(config));
      assert(Object.isFrozen(config.build));
      assertThrows(() => {
        (config as { title: string }).title = "mutated";
      }, TypeError);
    });

    it("keeps hosted loader state and immutable results independent of poisoned primordials", async () => {
      const adapter = setup();
      const sourceContext = {
        productionMode: false,
        branch: "feature/primordial-capture",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return 'export default { title: "source" };';
        },
      });
      let poisonCalls = 0;
      const poisoned = (): never => {
        poisonCalls += 1;
        throw new Error("ambient primordial invoked after hosted boundary import");
      };
      const snapshot = {
        title: "captured",
        theme: {
          colors: {
            primary: "#123456",
          },
        },
      };
      const schemaInputObjects: readonly object[] = [
        snapshot,
        snapshot.theme,
        snapshot.theme.colors,
      ];
      let restore: Array<() => void> = [];
      const installPoisoning = (): void => {
        const envOverlayStore = getEnvOverlayStorage()?.getStore();
        const poisonMapMethod = (original: (...args: never[]) => unknown) =>
          function (this: unknown, ...args: unknown[]): unknown {
            if (this === envOverlayStore) {
              return TestReflectApply(original, this, args);
            }
            return poisoned();
          };
        const mapSizeGetter = TestObjectGetOwnPropertyDescriptor(
          Map.prototype,
          "size",
        )?.get;
        if (!mapSizeGetter) throw new Error("Expected Map size getter");
        restore = [
          replacePropertyForTest(Map.prototype, "clear", {
            value: poisonMapMethod(Map.prototype.clear),
          }),
          replacePropertyForTest(Map.prototype, "delete", {
            value: poisonMapMethod(Map.prototype.delete),
          }),
          replacePropertyForTest(Map.prototype, "forEach", {
            value: poisonMapMethod(Map.prototype.forEach),
          }),
          replacePropertyForTest(Map.prototype, "get", {
            value: poisonMapMethod(Map.prototype.get),
          }),
          replacePropertyForTest(Map.prototype, "set", {
            value: poisonMapMethod(Map.prototype.set),
          }),
          replacePropertyForTest(Map.prototype, "size", {
            get: poisonMapMethod(mapSizeGetter),
          }),
          replacePropertyForTest(Object, "freeze", { value: poisoned }),
          replacePropertyForTest(Object, "getOwnPropertyDescriptor", {
            value: poisoned,
          }),
          replacePropertyForTest(Object, "getPrototypeOf", { value: poisoned }),
          replacePropertyForTest(Object, "isFrozen", { value: poisoned }),
          replacePropertyForTest(Reflect, "ownKeys", {
            value: (value: object): PropertyKey[] => {
              if (schemaInputObjects.some((input) => input === value)) {
                return TestReflectApply(
                  TestReflectOwnKeys,
                  Reflect,
                  [value],
                ) as PropertyKey[];
              }
              return poisoned();
            },
          }),
          replacePropertyForTest(WeakSet.prototype, "add", { value: poisoned }),
          replacePropertyForTest(WeakSet.prototype, "has", { value: poisoned }),
        ];
      };
      __setHostedConfigEvaluatorForTests(async () => {
        installPoisoning();
        return snapshot;
      });

      let config: Awaited<ReturnType<typeof getHostedConfig>> | undefined;
      let flightState:
        | ReturnType<typeof __getHostedConfigFlightStateForTests>
        | undefined;
      await runWithRequestContext(
        {
          projectSlug: "primordial-project",
          projectId: "primordial-project",
          token: "token",
          branch: sourceContext.branch,
        },
        async () => {
          const weakMapGet = WeakMap.prototype.get;
          const weakMapSet = WeakMap.prototype.set;
          const restoreIdentityPrimordials = [
            replacePropertyForTest(WeakMap.prototype, "get", {
              value: function (
                this: WeakMap<object, unknown>,
                key: object,
              ): unknown {
                if (key === adapter.fs) return poisoned();
                return TestReflectApply(weakMapGet, this, [key]);
              },
            }),
            replacePropertyForTest(WeakMap.prototype, "set", {
              value: function (
                this: WeakMap<object, unknown>,
                key: object,
                value: unknown,
              ): WeakMap<object, unknown> {
                if (key === adapter.fs) return poisoned();
                return TestReflectApply(
                  weakMapSet,
                  this,
                  [key, value],
                ) as unknown as WeakMap<object, unknown>;
              },
            }),
          ];
          try {
            config = await getHostedConfig("/hosted-primordial", adapter, {
              cacheKey: "primordial-project",
              sourceContext,
              preparedContext,
            });
            flightState = __getHostedConfigFlightStateForTests();
          } finally {
            for (let index = restore.length - 1; index >= 0; index -= 1) {
              restore[index]!();
            }
            for (
              let index = restoreIdentityPrimordials.length - 1;
              index >= 0;
              index -= 1
            ) {
              restoreIdentityPrimordials[index]!();
            }
          }
        },
      );

      assertEquals(poisonCalls, 0);
      assertEquals(config?.title, "captured");
      assert(Object.isFrozen(config));
      assert(Object.isFrozen(config?.theme));
      assert(Object.isFrozen(config?.theme?.colors));
      assertEquals(flightState, { flights: 0, waiters: 0 });
    });

    it("selects hosted config from one read without an exists/read race", async () => {
      const adapter = setup();
      const source = 'export default { title: "read-once" };';
      adapter.fs.files.set("/veryfront.config.ts", source);
      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      const reads: string[] = [];
      let existsCalls = 0;
      adapter.fs.readFile = async (path: string) => {
        reads.push(path);
        return await originalReadFile(path);
      };
      adapter.fs.exists = async () => {
        existsCalls += 1;
        throw new Error("hosted config must not probe exists");
      };
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
      });
      let evaluatedSource: string | undefined;
      __setHostedConfigEvaluatorForTests(async (payload) => {
        evaluatedSource = payload.evaluationOptions.source;
        return { title: "evaluated-read-once" };
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/read-once",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });

      const config = await runWithRequestContext(
        {
          projectSlug: "demo",
          projectId: "project-1",
          token: "token",
          branch: sourceContext.branch,
        },
        () =>
          getHostedConfig("/hosted-read-once", adapter, {
            cacheKey: "project-1",
            sourceContext,
            preparedContext,
          }),
      );

      assertEquals(config.title, "evaluated-read-once");
      assertEquals(evaluatedSource, source);
      assertEquals(reads, [
        "/veryfront.config.js",
        "/veryfront.config.ts",
      ]);
      assertEquals(existsCalls, 0);
    });

    it("propagates hosted config backend failures without trying another candidate", async () => {
      const adapter = setup();
      let reads = 0;
      let existsCalls = 0;
      let evaluations = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          existsCalls += 1;
          return false;
        },
        readFile: async () => {
          reads += 1;
          throw new Error("remote config backend unavailable");
        },
      });
      __setHostedConfigEvaluatorForTests(async () => {
        evaluations += 1;
        return { title: "must-not-evaluate" };
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/backend-failure",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });

      const error = await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo",
              projectId: "project-1",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted-backend-failure", adapter, {
                cacheKey: "project-1",
                sourceContext,
                preparedContext,
              }),
          ),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "config-parse-error");
      assertEquals(reads, 1);
      assertEquals(existsCalls, 0);
      assertEquals(evaluations, 0);
    });

    it("does not expose host environment values to hosted config", async () => {
      const adapter = setup();
      const envKey = "VERYFRONT_HOSTED_CONFIG_HOST_SECRET_TEST";
      const previousValue = getHostEnv(envKey);
      const sourceContext = {
        productionMode: false,
        branch: "feature/no-host-env",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      setEnv(envKey, "host-secret");
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return `
            import { getEnv } from "veryfront";
            export default { title: getEnv(${JSON.stringify(envKey)}) ?? "missing" };
          `;
        },
      });

      try {
        const config = await runWithRequestContext(
          {
            projectSlug: "demo",
            projectId: "project-1",
            token: "token",
            branch: sourceContext.branch,
          },
          () =>
            getHostedConfig("/host-env-isolation", adapter, {
              cacheKey: "project-1",
              sourceContext,
              preparedContext,
            }),
        );

        assertEquals(config.title, "missing");
      } finally {
        if (previousValue === undefined) deleteEnv(envKey);
        else setEnv(envKey, previousValue);
      }
    });

    it("preserves typed hosted rejection as the parse error cause without host execution", async () => {
      const adapter = setup();
      const marker = "__veryfrontHostedConfigHostMutation";
      const host = globalThis as Record<string, unknown>;
      const previousMarker = Object.getOwnPropertyDescriptor(host, marker);
      const sourceContext = {
        productionMode: false,
        branch: "feature/hostile-config",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      Object.defineProperty(host, marker, {
        configurable: true,
        value: 0,
        writable: true,
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return `const hidden = false || eval("globalThis.${marker} = 1"); export default {};`;
        },
      });

      try {
        const error = await assertRejects(
          () =>
            runWithRequestContext(
              {
                projectSlug: "demo",
                projectId: "project-1",
                token: "token",
                branch: sourceContext.branch,
              },
              () =>
                getHostedConfig("/hostile-hosted-config", adapter, {
                  cacheKey: "project-1",
                  sourceContext,
                  preparedContext,
                }),
            ),
          VeryfrontError,
        ) as VeryfrontError;
        assertEquals(error.slug, "config-parse-error");
        assert(error.cause instanceof DeclarativeConfigEvaluationError);
        const cause = error.cause as DeclarativeConfigEvaluationError;
        assertEquals(cause.code, "forbidden-capability");
        assertEquals(cause.phase, "validate");
        assertEquals(cause.reason, "host-global");
        assertEquals(cause.retryable, false);
        assertEquals(cause.location?.fileName, "veryfront.config.ts");
        assertEquals(host[marker], 0);
      } finally {
        if (previousMarker) Object.defineProperty(host, marker, previousMarker);
        else delete host[marker];
      }
    });

    it("never host-executes hosted JavaScript or MJS config variants", async () => {
      const marker = "__veryfrontHostedConfigVariantMutation";
      const host = globalThis as Record<string, unknown>;
      const previousMarker = Object.getOwnPropertyDescriptor(host, marker);
      Object.defineProperty(host, marker, {
        configurable: true,
        value: 0,
        writable: true,
      });

      try {
        for (
          const [index, configFile] of [
            "veryfront.config.js",
            "veryfront.config.mjs",
          ].entries()
        ) {
          const adapter = setup();
          const projectId = `hosted-variant-${index}`;
          const branch = `feature/hosted-variant-${index}`;
          const sourceContext = { productionMode: false, branch } as const;
          const preparedContext = await prepareDeclarativeConfigContext({
            environmentName: "preview",
            environment: {},
          });
          Object.assign(adapter.fs, {
            getUnderlyingAdapter: () => adapter.fs,
            isMultiProjectMode: () => true,
            isVeryfrontAdapter: () => true,
            exists: async (path: string) => path === `/${configFile}`,
            readFile: async (path: string) => {
              if (path !== `/${configFile}`) throw configCandidateNotFound(path);
              return `const hidden = false || eval("globalThis.${marker} = 1"); export default {};`;
            },
          });

          const error = await assertRejects(
            () =>
              runWithRequestContext(
                { projectSlug: "demo", projectId, token: "token", branch },
                () =>
                  getHostedConfig("/hosted-config-variant", adapter, {
                    cacheKey: projectId,
                    sourceContext,
                    preparedContext,
                  }),
              ),
            VeryfrontError,
          ) as VeryfrontError;

          assertEquals(error.slug, "config-parse-error");
          assert(error.cause instanceof DeclarativeConfigEvaluationError);
          assertEquals(
            (error.cause as DeclarativeConfigEvaluationError).reason,
            "host-global",
          );
          assertEquals(
            (error.cause as DeclarativeConfigEvaluationError).location?.fileName,
            configFile,
          );
          assertEquals(host[marker], 0);
        }
      } finally {
        if (previousMarker) Object.defineProperty(host, marker, previousMarker);
        else delete host[marker];
      }
    });

    it("rejects hosted multi-project getConfig without context before filesystem I/O", async () => {
      const adapter = setup();
      let existsCalls = 0;
      let readCalls = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          existsCalls += 1;
          return true;
        },
        readFile: async () => {
          readCalls += 1;
          return 'export default { title: "must not load" };';
        },
      });

      await assertRejects(() =>
        runWithRequestContext(
          {
            projectSlug: "demo",
            projectId: "project-1",
            token: "token",
            branch: "feature/missing-hosted-context",
          },
          () =>
            getConfig("/missing-hosted-context", adapter, {
              cacheKey: "project-1",
              sourceContext: {
                productionMode: false,
                branch: "feature/missing-hosted-context",
              },
            }),
        )
      );
      assertEquals(existsCalls, 0);
      assertEquals(readCalls, 0);
    });

    it("rejects mismatched hosted project identity before filesystem I/O", async () => {
      const adapter = setup();
      let filesystemCalls = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          filesystemCalls += 1;
          return false;
        },
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/project-identity",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });

      const error = await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "actual-project",
              projectId: "project-actual",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted-project-identity", adapter, {
                cacheKey: "project-forged",
                sourceContext,
                preparedContext,
              }),
          ),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "cache-invariant-violation");
      assertEquals(filesystemCalls, 0);
    });

    it("rejects hosted source and environment identity splicing before filesystem I/O", async () => {
      const adapter = setup();
      let filesystemCalls = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          filesystemCalls += 1;
          return false;
        },
      });
      const sourceContext = {
        productionMode: true,
        environmentName: "Staging",
        releaseId: "release-staging",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: {},
      });

      const error = await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo",
              projectId: "project-1",
              token: "token",
              productionMode: true,
              environmentName: sourceContext.environmentName,
              releaseId: sourceContext.releaseId,
            },
            () =>
              getHostedConfig("/hosted-environment-identity", adapter, {
                cacheKey: "project-1",
                sourceContext,
                preparedContext,
              }),
          ),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "cache-invariant-violation");
      assertEquals(filesystemCalls, 0);
    });

    it("allows an exact release only with the empty release evaluator context", async () => {
      const adapter = setup();
      let reads = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          reads += 1;
          return 'export default { title: "source" };';
        },
      });
      __setHostedConfigEvaluatorForTests(async () => ({ title: "release-config" }));
      const sourceContext = {
        productionMode: true,
        releaseId: "release-exact",
        environmentName: null,
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "release",
        environment: {},
      });

      const config = await runWithRequestContext(
        {
          projectSlug: "demo",
          projectId: "project-1",
          token: "token",
          productionMode: true,
          releaseId: sourceContext.releaseId,
        },
        () =>
          getHostedConfig("/hosted-exact-release", adapter, {
            cacheKey: "project-1",
            sourceContext,
            preparedContext,
          }),
      );

      assertEquals(config.title, "release-config");
      assertEquals(reads, 1);
    });

    it("rejects exact releases with an environment label or tenant secrets", async () => {
      const adapter = setup();
      let filesystemCalls = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          filesystemCalls += 1;
          return false;
        },
        readFile: async () => {
          filesystemCalls += 1;
          return 'export default { title: "must-not-read" };';
        },
      });
      const sourceContext = {
        productionMode: true,
        releaseId: "release-exact",
        environmentName: null,
      } as const;

      for (
        const preparedContext of [
          await prepareDeclarativeConfigContext({
            environmentName: "production",
            environment: {},
          }),
          await prepareDeclarativeConfigContext({
            environmentName: "release",
            environment: { SECRET: "must-not-bind" },
          }),
        ]
      ) {
        const error = await assertRejects(
          () =>
            runWithRequestContext(
              {
                projectSlug: "demo",
                projectId: "project-1",
                token: "token",
                productionMode: true,
                releaseId: sourceContext.releaseId,
              },
              () =>
                getHostedConfig("/hosted-exact-release", adapter, {
                  cacheKey: "project-1",
                  sourceContext,
                  preparedContext,
                }),
            ),
          VeryfrontError,
        ) as VeryfrontError;
        assertEquals(error.slug, "cache-invariant-violation");
      }

      assertEquals(filesystemCalls, 0);
    });

    it("honors hosted cancellation before filesystem I/O", async () => {
      const adapter = setup();
      let filesystemCalls = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          filesystemCalls += 1;
          return false;
        },
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/aborted-hosted-config",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      const controller = new AbortController();
      controller.abort();

      const error = await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo",
              projectId: "project-1",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/aborted-hosted-config", adapter, {
                cacheKey: "project-1",
                sourceContext,
                preparedContext,
                signal: controller.signal,
              }),
          ),
        DeclarativeConfigEvaluationError,
      ) as DeclarativeConfigEvaluationError;

      assertEquals(error.reason, "worker-aborted");
      assertEquals(filesystemCalls, 0);
    });

    it("keys hosted production cache by equivalent context and source digest", async () => {
      const adapter = setup();
      const sourceContext = {
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      } as const;
      const requestContext = {
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        productionMode: true,
        releaseId: sourceContext.releaseId,
        environmentName: sourceContext.environmentName,
      } as const;
      let sourceRevision = "base";
      let reads = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          reads += 1;
          return `
            import { getEnv } from "veryfront";
            export default {
              title: ${JSON.stringify(sourceRevision)} + ":" + (getEnv("TENANT") ?? "missing"),
            };
          `;
        },
      });
      const firstContext = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: { TENANT: "tenant-a" },
      });
      const equivalentContext = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: { TENANT: "tenant-a" },
      });
      const changedContext = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: { TENANT: "tenant-b" },
      });
      const load = (preparedContext: typeof firstContext) =>
        runWithRequestContext(
          requestContext,
          () =>
            getHostedConfig("/production-hosted-config", adapter, {
              cacheKey: "project-1",
              sourceContext,
              preparedContext,
            }),
        );

      const first = await load(firstContext);
      const equivalent = await load(equivalentContext);
      const changedEnvironment = await load(changedContext);
      sourceRevision = "changed-source";
      const changedSource = await load(changedContext);

      assertEquals(first.title, "base:tenant-a");
      assert(
        first === equivalent,
        "equivalent prepared contexts and source must reuse the cached merged config",
      );
      assertEquals(changedEnvironment.title, "base:tenant-b");
      assert(
        changedEnvironment !== equivalent,
        "changed prepared context must not alias an earlier hosted config",
      );
      assertEquals(changedSource.title, "changed-source:tenant-b");
      assert(
        changedSource !== changedEnvironment,
        "changed source digest must not alias an earlier hosted config",
      );
      assertEquals(reads, 4);
    });

    describe("hosted config single-flight", () => {
      const productionSourceContext = {
        productionMode: true,
        releaseId: "release-single-flight",
        environmentName: "Production",
      } as const;
      type PreparedContext = Awaited<
        ReturnType<typeof prepareDeclarativeConfigContext>
      >;
      type TestAdapter = ReturnType<typeof setup>;

      function createHostedAdapter(): TestAdapter {
        const adapter = setup();
        Object.assign(adapter.fs, {
          getUnderlyingAdapter: () => adapter.fs,
          isMultiProjectMode: () => true,
          isVeryfrontAdapter: () => true,
          exists: async (path: string) => path === "/veryfront.config.ts",
          readFile: async (path: string) => {
            if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
            return 'export default { title: "source" };';
          },
        });
        return adapter;
      }

      function loadProductionHostedConfig(
        adapter: TestAdapter,
        preparedContext: PreparedContext,
        options: Readonly<{
          projectId?: string;
          signal?: AbortSignal;
        }> = {},
      ) {
        const projectId = options.projectId ?? "project-single-flight";
        return runWithRequestContext(
          {
            projectSlug: projectId,
            projectId,
            token: "token",
            productionMode: true,
            releaseId: productionSourceContext.releaseId,
            environmentName: productionSourceContext.environmentName,
          },
          () =>
            getHostedConfig(`/hosted/${projectId}`, adapter, {
              cacheKey: projectId,
              sourceContext: productionSourceContext,
              preparedContext,
              signal: options.signal,
            }),
        );
      }

      function prepareProductionContext(): Promise<PreparedContext> {
        return prepareDeclarativeConfigContext({
          environmentName: "Production",
          environment: { TENANT: "tenant" },
        });
      }

      it("shares one exact production evaluation and result across concurrent callers", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const started = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async (_payload, options) => {
          evaluations += 1;
          assertEquals(options?.signal?.aborted, false);
          started.resolve();
          await resume.promise;
          return { title: "coalesced" };
        });

        const first = loadProductionHostedConfig(adapter, preparedContext);
        await started.promise;
        const second = loadProductionHostedConfig(adapter, preparedContext);
        await waitForHostedFlightState({ flights: 1, waiters: 2 });
        assertEquals(evaluations, 1);

        resume.resolve();
        const [firstConfig, secondConfig] = await Promise.all([first, second]);
        assert(firstConfig === secondConfig);
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        const cached = await loadProductionHostedConfig(adapter, preparedContext);
        assert(cached === firstConfig);
        assertEquals(evaluations, 1);
      });

      it("removes rejected flights and never caches their failure", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const firstEvaluationStarted = Promise.withResolvers<void>();
        const rejectFirstEvaluation = Promise.withResolvers<void>();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          if (evaluations === 1) {
            firstEvaluationStarted.resolve();
            await rejectFirstEvaluation.promise;
            throw new Error("deterministic hosted evaluation failure");
          }
          return { title: "recovered" };
        });

        const first = loadProductionHostedConfig(adapter, preparedContext);
        await firstEvaluationStarted.promise;
        const second = loadProductionHostedConfig(adapter, preparedContext);
        await waitForHostedFlightState({ flights: 1, waiters: 2 });
        rejectFirstEvaluation.resolve();

        const failures = await Promise.allSettled([first, second]);
        assert(failures.every((result) => result.status === "rejected"));
        assertEquals(evaluations, 1);
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        const recovered = await loadProductionHostedConfig(adapter, preparedContext);
        assertEquals(recovered.title, "recovered");
        assertEquals(evaluations, 2);
      });

      it("separates flights across cache revisions and blocks stale cache seeding", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const starts = [
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
        ] as const;
        const outcomes = [
          Promise.withResolvers<{ title: string }>(),
          Promise.withResolvers<{ title: string }>(),
        ] as const;
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(() => {
          const index = evaluations;
          evaluations += 1;
          starts[index]?.resolve();
          return outcomes[index]!.promise;
        });

        const staleRequest = loadProductionHostedConfig(adapter, preparedContext);
        await starts[0].promise;
        clearConfigCache();
        const freshRequest = loadProductionHostedConfig(adapter, preparedContext);
        await starts[1].promise;
        await waitForHostedFlightState({ flights: 2, waiters: 2 });

        outcomes[1].resolve({ title: "fresh-revision" });
        const fresh = await freshRequest;
        outcomes[0].resolve({ title: "stale-revision" });
        const stale = await staleRequest;
        assertEquals(fresh.title, "fresh-revision");
        assertEquals(stale.title, "stale-revision");
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        const cached = await loadProductionHostedConfig(adapter, preparedContext);
        assertEquals(cached.title, "fresh-revision");
        assert(cached === fresh);
        assertEquals(evaluations, 2);
      });

      it("lets one caller abort without cancelling its peers", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const started = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const firstController = new AbortController();
        const secondController = new AbortController();
        let sharedSignal: AbortSignal | undefined;
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async (_payload, options) => {
          evaluations += 1;
          sharedSignal = options?.signal;
          started.resolve();
          await resume.promise;
          return { title: "peer-survived" };
        });

        const first = loadProductionHostedConfig(adapter, preparedContext, {
          signal: firstController.signal,
        });
        await started.promise;
        const second = loadProductionHostedConfig(adapter, preparedContext, {
          signal: secondController.signal,
        });
        await waitForHostedFlightState({ flights: 1, waiters: 2 });

        const firstFailure = assertRejects(
          () => first,
          DeclarativeConfigEvaluationError,
        ) as Promise<DeclarativeConfigEvaluationError>;
        firstController.abort();
        const error = await firstFailure;
        assertEquals(error.reason, "worker-aborted");
        await waitForHostedFlightState({ flights: 1, waiters: 1 });
        assertEquals(sharedSignal?.aborted, false);

        resume.resolve();
        const survivingPeer = await second;
        assertEquals(survivingPeer.title, "peer-survived");
        assertEquals(evaluations, 1);
      });

      it("aborts the shared evaluation only after every waiter leaves", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const started = Promise.withResolvers<void>();
        const sharedOutcome = Promise.withResolvers<{ title: string }>();
        const firstController = new AbortController();
        const secondController = new AbortController();
        let sharedSignal: AbortSignal | undefined;
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests((_payload, options) => {
          evaluations += 1;
          if (evaluations > 1) return Promise.resolve({ title: "recovered" });
          sharedSignal = options?.signal;
          started.resolve();
          return sharedOutcome.promise;
        });

        const first = loadProductionHostedConfig(adapter, preparedContext, {
          signal: firstController.signal,
        });
        await started.promise;
        const second = loadProductionHostedConfig(adapter, preparedContext, {
          signal: secondController.signal,
        });
        await waitForHostedFlightState({ flights: 1, waiters: 2 });
        const firstFailure = assertRejects(
          () => first,
          DeclarativeConfigEvaluationError,
        );
        const secondFailure = assertRejects(
          () => second,
          DeclarativeConfigEvaluationError,
        );

        firstController.abort();
        await firstFailure;
        assertEquals(sharedSignal?.aborted, false);
        secondController.abort();
        await secondFailure;
        assertEquals(sharedSignal?.aborted, true);
        await waitForHostedFlightState({ flights: 1, waiters: 0 });

        const recovered = await loadProductionHostedConfig(adapter, preparedContext);
        assertEquals(recovered.title, "recovered");
        assertEquals(evaluations, 2);
        sharedOutcome.reject(new Error("cancelled evaluator drained"));
        await waitForHostedFlightState({ flights: 0, waiters: 0 });
      });

      it("coalesces preview branches without persisting their result", async () => {
        const adapter = createHostedAdapter();
        const sourceContext = {
          productionMode: false,
          branch: "feature/single-flight",
        } as const;
        const preparedContext = await prepareDeclarativeConfigContext({
          environmentName: "preview",
          environment: {},
        });
        const firstStarted = Promise.withResolvers<void>();
        const resumeFirst = Promise.withResolvers<void>();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          if (evaluations === 1) {
            firstStarted.resolve();
            await resumeFirst.promise;
          }
          return { title: `preview-evaluation-${evaluations}` };
        });
        const load = () =>
          runWithRequestContext(
            {
              projectSlug: "preview-project",
              projectId: "preview-project",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted/preview-project", adapter, {
                cacheKey: "preview-project",
                sourceContext,
                preparedContext,
              }),
          );

        const first = load();
        await firstStarted.promise;
        const second = load();
        await waitForHostedFlightState({ flights: 1, waiters: 2 });
        resumeFirst.resolve();
        const [firstConfig, secondConfig] = await Promise.all([first, second]);
        assert(firstConfig === secondConfig);
        assertEquals(firstConfig.title, "preview-evaluation-1");
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        const next = await load();
        assertEquals(next.title, "preview-evaluation-2");
        assert(next !== firstConfig);
        assertEquals(evaluations, 2);
      });

      it("bounds unique flights and releases capacity after cancellation", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const limit = DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive +
          DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxQueued;
        const controllers = Array.from(
          { length: limit },
          () => new AbortController(),
        );
        let releaseImmediately = false;
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests((_payload, options) => {
          evaluations += 1;
          if (releaseImmediately) return Promise.resolve({ title: "capacity-recovered" });
          return new Promise((_, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("bounded flight cancelled")),
              { once: true },
            );
          });
        });

        const pending = controllers.map((controller, index) =>
          loadProductionHostedConfig(adapter, preparedContext, {
            projectId: `bounded-project-${index}`,
            signal: controller.signal,
          })
        );
        await waitForHostedFlightState({ flights: limit, waiters: limit });
        assertEquals(evaluations, limit);

        const overflow = await assertRejects(
          () =>
            loadProductionHostedConfig(adapter, preparedContext, {
              projectId: "bounded-project-overflow",
            }),
          VeryfrontError,
        ) as VeryfrontError;
        assertEquals(overflow.slug, "service-overloaded");
        assert(overflow.cause instanceof DeclarativeConfigEvaluationError);
        assertEquals(
          (overflow.cause as DeclarativeConfigEvaluationError).reason,
          "worker-overloaded",
        );
        assertEquals(evaluations, limit);

        const pendingFailures = pending.map((request) =>
          assertRejects(() => request, DeclarativeConfigEvaluationError)
        );
        for (const controller of controllers) controller.abort();
        await Promise.all(pendingFailures);
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        releaseImmediately = true;
        const recovered = await loadProductionHostedConfig(adapter, preparedContext, {
          projectId: "bounded-project-recovered",
        });
        assertEquals(recovered.title, "capacity-recovered");
        assertEquals(evaluations, limit + 1);
      });
    });

    it("preserves executable config for single-project virtual filesystems", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async () => `
          const resolveTitle = () => "single-project-executable";
          export default { title: resolveTitle() };
        `,
      });

      const config = await getConfig("/single-project-virtual-config", adapter, {
        cacheKey: "single-project",
      });

      assertEquals(config.title, "single-project-executable");
    });

    it("isolates virtual config values by exact branch, release, and environment", async () => {
      const adapter = setup();
      const reads: string[] = [];
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
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

      const loadFor = async (
        source: Parameters<typeof runWithRequestContext>[0],
      ) => {
        const preparedContext = await prepareDeclarativeConfigContext({
          environmentName: source.environmentName ??
            (source.productionMode ? "release" : "preview"),
          environment: {},
        });
        return runWithRequestContext(
          source,
          () =>
            getHostedConfig("/source-qualified-config", adapter, {
              cacheKey: "project-1",
              sourceContext: {
                productionMode: source.productionMode ?? false,
                releaseId: source.releaseId,
                branch: source.branch,
                environmentName: source.environmentName,
              },
              preparedContext,
            }),
        );
      };

      const main = await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        branch: "main",
      });
      const preview = await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        branch: "feature/integrations",
      });
      const release = await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        productionMode: true,
        releaseId: "release-1",
      });
      const environment = await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      });

      assertEquals(main.title, "branch:main");
      assertEquals(preview.title, "branch:feature/integrations");
      assertEquals(release.title, "release:release-1");
      assertEquals(environment.title, "env:Production:release-1");

      await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
        token: "token",
        branch: "main",
      });
      await loadFor({
        projectSlug: "demo",
        projectId: "project-1",
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
        "env:Production:release-1",
      ]);
    });

    it("reloads mutable branch config across request contexts", async () => {
      const adapter = setup();
      let revision = "first";
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return `export default { title: ${JSON.stringify(revision)} };`;
        },
      });

      const sourceContext = { productionMode: false, branch: "feature/integrations" } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      const loadBranchConfig = () =>
        runWithRequestContext(
          {
            projectSlug: "demo",
            projectId: "project-1",
            token: "token",
            branch: sourceContext.branch,
          },
          () =>
            getHostedConfig("/mutable-branch-config", adapter, {
              cacheKey: "project-1",
              sourceContext,
              preparedContext,
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
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        exists: async (path: string) => path === "/veryfront.config.ts",
        readFile: async () => `export default { title: ${JSON.stringify(revision)} };`,
      });

      const first = await getConfig("/contextless-virtual-config", adapter);
      revision = "second";
      const second = await getConfig("/contextless-virtual-config", adapter);

      assertEquals(first.title, "first");
      assertEquals(second.title, "second");
    });

    it("does not coalesce virtual filesystems without an exact source identity", async () => {
      for (
        const scenario of [
          { name: "no-cache-key", options: undefined },
          {
            name: "contextless-cache-key",
            options: { cacheKey: "shared-project" },
          },
        ] as const
      ) {
        const firstAdapter = setup();
        const secondAdapter = createMockAdapter();
        const firstStarted = Promise.withResolvers<void>();
        const resumeFirst = Promise.withResolvers<void>();

        Object.assign(firstAdapter.fs, {
          getUnderlyingAdapter: () => firstAdapter.fs,
          isMultiProjectMode: () => false,
          isVeryfrontAdapter: () => true,
          exists: async (path: string) => path === "/veryfront.config.ts",
          readFile: async () => {
            firstStarted.resolve();
            await resumeFirst.promise;
            return 'export default { title: "first-filesystem" };';
          },
        });
        Object.assign(secondAdapter.fs, {
          getUnderlyingAdapter: () => secondAdapter.fs,
          isMultiProjectMode: () => false,
          isVeryfrontAdapter: () => true,
          exists: async (path: string) => path === "/veryfront.config.ts",
          readFile: async () => 'export default { title: "second-filesystem" };',
        });

        const projectDir = `/shared-virtual-project-dir/${scenario.name}`;
        const firstRequest = getConfig(
          projectDir,
          firstAdapter,
          scenario.options,
        );
        await firstStarted.promise;
        const secondRequest = getConfig(
          projectDir,
          secondAdapter,
          scenario.options,
        );
        resumeFirst.resolve();

        const [first, second] = await Promise.all([firstRequest, secondRequest]);
        assertEquals(first.title, "first-filesystem");
        assertEquals(second.title, "second-filesystem");
      }
    });

    it("does not coalesce mutable branch sources across virtual filesystem instances", async () => {
      const firstAdapter = setup();
      const secondAdapter = createMockAdapter();
      const firstStarted = Promise.withResolvers<void>();
      const resumeFirst = Promise.withResolvers<void>();
      const sourceContext = {
        productionMode: false,
        branch: "feature/mutable-source",
      } as const;

      Object.assign(firstAdapter.fs, {
        getUnderlyingAdapter: () => firstAdapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        readFile: async () => {
          firstStarted.resolve();
          await resumeFirst.promise;
          return 'export default { title: "first-filesystem" };';
        },
      });
      Object.assign(secondAdapter.fs, {
        getUnderlyingAdapter: () => secondAdapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        readFile: async () => 'export default { title: "second-filesystem" };',
      });

      const loadFrom = (adapter: ReturnType<typeof createMockAdapter>) =>
        runWithRequestContext(
          {
            projectSlug: "shared-project",
            projectId: "shared-project",
            token: "token",
            branch: sourceContext.branch,
          },
          () =>
            getConfig("/shared-mutable-branch", adapter, {
              cacheKey: "shared-project",
              sourceContext,
            }),
        );

      const firstRequest = loadFrom(firstAdapter);
      await firstStarted.promise;
      const secondRequest = loadFrom(secondAdapter);
      resumeFirst.resolve();

      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assertEquals(first.title, "first-filesystem");
      assertEquals(second.title, "second-filesystem");
    });

    it("rejects an explicit source that differs from the request context", async () => {
      const adapter = setup();
      let reads = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => true,
        readFile: async () => {
          reads++;
          return 'export default { title: "wrong source" };';
        },
      });
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: {},
      });

      await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo",
              projectId: "project-1",
              token: "token",
              productionMode: true,
              environmentName: "Production:release-1",
              releaseId: "release-2",
            },
            () =>
              getHostedConfig("/mismatched-source-config", adapter, {
                cacheKey: "project-1",
                sourceContext: {
                  productionMode: true,
                  environmentName: "Production",
                  releaseId: "release-1:release-2",
                },
                preparedContext,
              }),
          ),
        Error,
        "does not match the current request context",
      );
      assertEquals(reads, 0);
    });

    it("rejects legacy integration policy fields instead of normalizing them", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
      });
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
      assertEquals(getCachedConfigSync("/broken-project"), null);
    });

    it("preserves schema validation errors instead of relabeling them as parse failures", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-invalid-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { dev: { port: "not-a-port" } };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const error = await assertRejects(() => getConfig(projectDir, adapter));

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, "config-validation-failed");
        assertEquals(getCachedConfigSync(projectDir), null);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
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
      assertEquals(config.build?.esbuild?.wasmURL, ESBUILD_WASM_URL);
    });

    it("should include default theme config", async () => {
      const adapter = setup();

      const config = await getConfig("/theme-test", adapter);
      assertEquals(config.theme?.colors?.primary, "#3B82F6");
    });
  });

  describe("mergeConfigs deep merge", () => {
    it("does not invent inactive filesystem backend configuration", () => {
      const merged = mergeConfigs({});

      assertEquals(merged.fs, { type: "local" });
    });

    it("keeps only the selected filesystem backend outside proxy mode", () => {
      const merged = mergeConfigs({
        fs: {
          type: "github",
          github: { token: "token", owner: "owner", repo: "repo" },
        },
      });

      assertEquals(merged.fs, {
        type: "github",
        github: { token: "token", owner: "owner", repo: "repo" },
      });
    });

    it("rejects project filesystem overrides when proxy mode owns the backend", () => {
      setEnv("PROXY_MODE", "1");
      setEnv("VERYFRONT_API_BASE_URL", "https://api.example.com");

      assertThrows(
        () => mergeConfigs({ fs: { type: "local" } }),
        VeryfrontError,
        "platform-managed in proxy mode",
      );

      assertEquals(mergeConfigs({}).fs, {
        type: "veryfront-api",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          proxyMode: true,
          cache: { enabled: true, ttl: 60_000 },
          retry: { maxRetries: 3, initialDelay: 500, maxDelay: 5_000 },
        },
      });
    });

    it("fails closed when proxy mode has no valid platform API URL", () => {
      setEnv("PROXY_MODE", "1");

      for (
        const apiBaseUrl of [
          "",
          "not-a-url",
          "https://token@example.com",
          "https://api.example.com/api?target=other",
          "https://api.example.com/api#fragment",
        ]
      ) {
        setEnv("VERYFRONT_API_BASE_URL", apiBaseUrl);
        assertThrows(
          () => mergeConfigs({}),
          VeryfrontError,
          apiBaseUrl
            ? "must be an HTTP(S) base URL without credentials, query, or fragment"
            : "requires VERYFRONT_API_BASE_URL",
        );
      }
    });

    it("canonicalizes the platform API base URL before consumers concatenate paths", () => {
      setEnv("PROXY_MODE", "1");
      setEnv("VERYFRONT_API_BASE_URL", " https://api.example.com/api/// ");

      assertEquals(
        mergeConfigs({}).fs?.veryfront?.apiBaseUrl,
        "https://api.example.com/api",
      );
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
      assertEquals(merged.build?.esbuild?.wasmURL, ESBUILD_WASM_URL);
    });

    it("keeps default theme colors when user sets an unrelated color", () => {
      const merged = mergeConfigs({ theme: { colors: { secondary: "#000000" } } });
      assertEquals(merged.theme?.colors?.primary, "#3B82F6");
      assertEquals(merged.theme?.colors?.secondary, "#000000");
    });
  });
});
