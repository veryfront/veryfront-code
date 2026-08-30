import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, symlink, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { dirname, toFileUrl } from "#veryfront/compat/path/index.ts";
import { makeTempDir, waitFor, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";

/** Repeated across the config-load classification tests below. */
const CONFIG_FILE_NAME = "veryfront.config.js";
const DEPENDENCY_MISSING_SLUG = "dependency-missing";
const CONFIG_PARSE_ERROR_SLUG = "config-parse-error";

function normalizeMacOsVarAlias(value: string): string {
  const fileUrlPrefix = "file:///private";
  if (value.startsWith(`${fileUrlPrefix}/var/`)) {
    return `file://${value.slice(fileUrlPrefix.length)}`;
  }
  return value.startsWith("/private/var/") ? value.slice("/private".length) : value;
}
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  __bunConfigHasTopLevelAwaitForTests,
  __collectBunProjectConfigModulesForTests,
  __evictBunProjectConfigModulesForTests,
  __getHostedConfigFlightStateForTests,
  __getHostedConfigSourceReadStateForTests,
  __getNodeConfigBundleConditionsForTests,
  __getNodeConfigPackageConditionsForTests,
  __getTrustedConfigFlightStateForTests,
  __isBunWorkspaceMemberDirectoryForTests,
  __observePromiseForTests,
  __resolveNodeConfigPackageTargetForTests,
  __rewriteComputedDynamicProjectConfigImportsForTests,
  __serializeConfigResolveErrorForTests,
  __setHostedConfigEvaluatorForTests,
  bundleProjectConfigSourceForImport,
  clearConfigCache,
  evaluateHostedConfigSource,
  getCachedConfigSync,
  getConfig,
  getConfigWithProvenance,
  getHostedConfig,
  loadConfigFromTempFile,
  mergeConfigs,
  rewriteBareVeryfrontConfigImports,
  rewriteProjectConfigImports,
  rewriteProjectConfigImportsFromProject,
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
import { MAX_HOSTED_RENDER_CACHE_ENTRIES } from "./defaults.ts";
import {
  register as registerExtensionContract,
  tryResolve as tryResolveExtensionContract,
  unregister as unregisterExtensionContract,
} from "#veryfront/extensions/contracts.ts";
import type {
  Bundler,
  BundlerPluginBuild,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
} from "#veryfront/extensions/bundler/bundler.ts";

const TestObjectDefineProperty = Object.defineProperty;
const TestObjectCreate = Object.create;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestObjectGetPrototypeOf = Object.getPrototypeOf;
const TestReflectApply = Reflect.apply;
const TestReflectDeleteProperty = Reflect.deleteProperty;
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

function definePropertyForTest(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): () => void {
  const original = TestObjectGetOwnPropertyDescriptor(target, key);
  TestObjectDefineProperty(target, key, {
    configurable: true,
    ...descriptor,
  });
  return () => {
    if (original) TestObjectDefineProperty(target, key, original);
    else TestReflectApply(TestReflectDeleteProperty, Reflect, [target, key]);
  };
}

function defineNullPrototypeAccessorForTest(
  target: object,
  key: PropertyKey,
  getter: () => unknown,
  setter: (value?: unknown) => unknown,
): () => void {
  const original = TestObjectGetOwnPropertyDescriptor(target, key);
  if (original) throw new Error(`Expected no own descriptor for ${String(key)}`);
  const descriptor = TestReflectApply(
    TestObjectCreate,
    Object,
    [null],
  ) as PropertyDescriptor;
  descriptor.get = getter;
  descriptor.set = setter;
  descriptor.enumerable = false;
  descriptor.configurable = true;
  TestReflectApply(TestObjectDefineProperty, Object, [
    target,
    key,
    descriptor,
  ]);
  return () => {
    TestReflectApply(TestReflectDeleteProperty, Reflect, [target, key]);
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
  await waitFor(
    () => {
      const current = __getHostedConfigFlightStateForTests();
      return current.flights === expected.flights &&
        current.waiters === expected.waiters;
    },
    {
      interval: 10,
      message: `Expected hosted flight state ${JSON.stringify(expected)}`,
    },
  );
}

async function waitForHostedSourceReadState(
  expected: Readonly<{
    active: number;
    queued: number;
    flights: number;
    waiters: number;
  }>,
): Promise<void> {
  await waitFor(
    () => {
      const current = __getHostedConfigSourceReadStateForTests();
      return current.active === expected.active &&
        current.queued === expected.queued &&
        current.flights === expected.flights &&
        current.waiters === expected.waiters;
    },
    {
      interval: 10,
      message: `Expected hosted source-read state ${JSON.stringify(expected)}`,
    },
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
  afterEach(async () => {
    __setHostedConfigEvaluatorForTests();
    await waitForHostedSourceReadState({
      active: 0,
      queued: 0,
      flights: 0,
      waiters: 0,
    });
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

    it("bundles local TypeScript imports for staged Node configs", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const packageDir = `${projectDir}/node_modules/esm-config-dependency`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "esm-config-dependency",
            type: "module",
            exports: { import: "./import.js" },
          }),
        );
        await writeTextFile(`${packageDir}/import.js`, 'export default "config";\n');
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#config-values": "./config-values.ts" },
          }),
        );
        const source = [
          'import { defineConfig } from "veryfront";',
          'import { title } from "#config-values";',
          "export default defineConfig({",
          "  title,",
          "  configUrl: import.meta.url,",
          "  configFilename: import.meta.filename,",
          "  configDirname: import.meta.dirname,",
          "});",
        ].join("\n");
        await writeTextFile(
          `${projectDir}/config-values.ts`,
          'import suffix from "esm-config-dependency";\n' +
            "export const title: string = `Node module graph ${suffix}`;\n",
        );

        const result = await rewriteBareVeryfrontConfigImports(
          await bundleProjectConfigSourceForImport(source, configPath),
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: {
            title: string;
            configUrl: string;
            configFilename: string;
            configDirname: string;
          };
        };

        assert(!result.includes("#config-values"));
        assertStringIncludes(result, "var title");
        assert(!result.includes('from "esm-config-dependency"'));
        assertStringIncludes(result, "/esm-config-dependency/import.js");
        assertEquals(module.default.title, "Node module graph config");
        assertEquals(module.default.configUrl, toFileUrl(configPath).href);
        assertEquals(module.default.configFilename, configPath);
        assertEquals(module.default.configDirname, dirname(configPath));
      }, { prefix: "vf-config-module-graph-" });
    });

    it("preserves import.meta.url for every bundled config module", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/config-values.ts`;
        const source = [
          'import { dependencyUrl } from "./config-values.ts";',
          "export default { entryUrl: import.meta.url, dependencyUrl };",
        ].join("\n");
        await writeTextFile(valuesPath, "export const dependencyUrl = import.meta.url;\n");

        const result = await bundleProjectConfigSourceForImport(source, configPath);
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { entryUrl: string; dependencyUrl: string };
        };

        assertEquals(module.default.entryUrl, toFileUrl(configPath).href);
        assertStringIncludes(module.default.dependencyUrl, "vf-config-import-meta-");
        assertEquals(module.default.dependencyUrl.endsWith("/config-values.ts"), true);
      }, { prefix: "vf-config-import-meta-" });
    });

    it("bundles TypeScript imported by a staged JavaScript config", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.js`;
        await writeTextFile(
          `${projectDir}/config-values.ts`,
          'export const title: string = "Staged JavaScript config";\n',
        );

        const config = await loadConfigFromTempFile(
          'import { title } from "./config-values.ts"; export default { title };',
          configPath,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { title: string };

        assertEquals(config.title, "Staged JavaScript config");
      }, { prefix: "vf-config-staged-js-" });
    });

    it("preserves CommonJS config exports when Node staging is requested", async () => {
      await withTempDir(async (projectDir) => {
        const config = await loadConfigFromTempFile(
          'module.exports = { title: "Staged CommonJS config" };',
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { title: string };

        assertEquals(config.title, "Staged CommonJS config");
      }, { prefix: "vf-config-staged-cjs-" });
    });

    it("does not collide with a config-owned require binding", async () => {
      await withTempDir(async (projectDir) => {
        const config = await loadConfigFromTempFile(
          'const require = "project binding"; export default { require };',
          `${projectDir}/veryfront.config.ts`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { require: string };

        assertEquals(config.require, "project binding");
      }, { prefix: "vf-config-staged-require-binding-" });
    });

    it("resolves CommonJS Veryfront requires before staging", async () => {
      await withTempDir(async (projectDir) => {
        const config = await loadConfigFromTempFile(
          'const { defineConfig } = require("veryfront");\n' +
            'module.exports = defineConfig({ title: "Staged CommonJS helper" });',
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { title: string };

        assertEquals(config.title, "Staged CommonJS helper");
      }, { prefix: "vf-config-staged-cjs-helper-" });
    });

    it("preserves project-bound CommonJS requires while staging", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/staged-cjs-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "staged-cjs-dependency",
            type: "module",
            exports: {
              import: "./import.js",
              require: "./require.cjs",
            },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/require.cjs`,
          'module.exports = { value: "dependency" };\n',
        );
        await writeTextFile(
          `${dependencyDir}/import.js`,
          'export default { value: "wrong-condition" };\n',
        );
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));

        for (
          const configFile of [
            "veryfront.config.cjs",
            "veryfront.config.js",
            "veryfront.config.ts",
          ]
        ) {
          const config = await loadConfigFromTempFile(
            'const path = require("node:path");\n' +
              'const dependency = require("staged-cjs-dependency");\n' +
              "module.exports = { base: path.basename(__filename), value: dependency.value };",
            `${projectDir}/${configFile}`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { base: string; value: string };

          assertEquals(config.base, configFile);
          assertEquals(config.value, "dependency");
        }
      }, { prefix: "vf-config-staged-cjs-require-" });
    });

    it("keeps ESM import conditions out of CommonJS require resolution", async () => {
      await withTempDir(async (projectDir) => {
        const packageName = "staged-require-condition-dependency";
        const dependencyDir = `${projectDir}/node_modules/${packageName}`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: packageName,
            type: "module",
            exports: {
              import: "./missing-import.js",
              require: "./require.cjs",
            },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/require.cjs`,
          'module.exports = { value: "require-condition" };\n',
        );
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));

        const config = await loadConfigFromTempFile(
          `module.exports = require(${JSON.stringify(packageName)});`,
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { value: string };

        assertEquals(config.value, "require-condition");
      }, { prefix: "vf-config-staged-cjs-require-condition-" });
    });

    it("provides project-bound dynamic require and require.resolve while staging", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/staged-dynamic-cjs-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "staged-dynamic-cjs-dependency",
            main: "index.cjs",
          }),
        );
        await writeTextFile(`${dependencyDir}/index.cjs`, 'module.exports = "dynamic";\n');
        await writeTextFile(`${projectDir}/config-helper.cjs`, 'module.exports = "helper";\n');
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));

        for (const configFile of ["veryfront.config.cjs", "veryfront.config.ts"]) {
          const config = await loadConfigFromTempFile(
            'const dependencyName = "staged-dynamic-cjs-dependency";\n' +
              'const helperName = "./config-helper.cjs";\n' +
              "module.exports = {\n" +
              "  value: require(dependencyName),\n" +
              "  helperPath: require.resolve(helperName),\n" +
              "  interpolated: `${require(dependencyName)}:${require(helperName)}`,\n" +
              "};\n",
            `${projectDir}/${configFile}`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { value: string; helperPath: string; interpolated: string };

          assertEquals(config.value, "dynamic");
          assertEquals(config.interpolated, "dynamic:helper");
          assertEquals(
            normalizeMacOsVarAlias(config.helperPath),
            normalizeMacOsVarAlias(`${projectDir}/config-helper.cjs`),
          );
        }
      }, { prefix: "vf-config-staged-dynamic-require-" });
    });

    it("exposes CommonJS require cache fields while staging", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
        await writeTextFile(`${projectDir}/config-helper.cjs`, 'module.exports = "helper";\n');

        const config = await loadConfigFromTempFile(
          'const helperPath = require.resolve("./config-helper.cjs");\n' +
            "delete require.cache[helperPath];\n" +
            "module.exports = {\n" +
            '  helper: require("./config-helper.cjs"),\n' +
            "  hasCache: typeof require.cache === 'object',\n" +
            "  hasExtensions: typeof require.extensions === 'object',\n" +
            "  hasMain: 'main' in require,\n" +
            "};",
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as {
          hasCache: boolean;
          hasExtensions: boolean;
          hasMain: boolean;
          helper: string;
        };

        assertEquals(config, {
          hasCache: true,
          hasExtensions: true,
          hasMain: true,
          helper: "helper",
        });
      }, { prefix: "vf-config-staged-require-cache-" });
    });

    it("bundles nested CommonJS helper graphs for cross-runtime staging", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
        await writeTextFile(
          `${projectDir}/value.js`,
          "module.exports = { value: 'nested-commonjs' };\n",
        );
        await writeTextFile(
          `${projectDir}/helper.cjs`,
          "module.exports = require('./value.js');\n",
        );

        const config = await loadConfigFromTempFile(
          "const load = require;\n" +
            "void load;\n" +
            "module.exports = require('./helper.cjs');",
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { value: string };

        assertEquals(config.value, "nested-commonjs");
      }, { prefix: "vf-config-staged-nested-cjs-require-" });
    });

    it("bundles nested CommonJS helpers beside runtime-computed requires", async () => {
      await withTempDir(async (projectDir) => {
        const helperSpecifier = `__vfNestedConfigHelper_${
          crypto.randomUUID().replaceAll("-", "_")
        }`;
        try {
          (globalThis as Record<string, unknown>)[helperSpecifier] = "./dynamic.cjs";
          await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
          await writeTextFile(`${projectDir}/dynamic.cjs`, 'module.exports = "dynamic";\n');
          await writeTextFile(
            `${projectDir}/value.js`,
            "module.exports = { value: 'nested-commonjs' };\n",
          );
          await writeTextFile(
            `${projectDir}/helper.cjs`,
            "module.exports = require('./value.js');\n",
          );

          const config = await loadConfigFromTempFile(
            `const dynamic = require(globalThis[${JSON.stringify(helperSpecifier)}]);\n` +
              "const nested = require('./helper.cjs');\n" +
              "module.exports = { dynamic, nested };",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { dynamic: string; nested: { value: string } };

          assertEquals(config.dynamic, "dynamic");
          assertEquals(config.nested.value, "nested-commonjs");
        } finally {
          delete (globalThis as Record<string, unknown>)[helperSpecifier];
        }
      }, { prefix: "vf-config-staged-computed-nested-cjs-require-" });
    });

    it("shares one bundled CommonJS-scoped JavaScript module", async () => {
      await withTempDir(async (projectDir) => {
        const runtimeSpecifierKey = `__vfRuntimeConfigRequire_${
          crypto.randomUUID().replaceAll("-", "_")
        }`;
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
        await writeTextFile(
          `${projectDir}/shared.js`,
          "module.exports = { token: {} };\n",
        );

        (globalThis as Record<string, unknown>)[runtimeSpecifierKey] = "./shared.js";
        let config: { sameInstance: boolean };
        try {
          config = await loadConfigFromTempFile(
            `const dynamicValue = require(globalThis[${JSON.stringify(runtimeSpecifierKey)}]);\n` +
              'const staticValue = require("./shared.js");\n' +
              "module.exports = { sameInstance: staticValue === dynamicValue };",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { sameInstance: boolean };
        } finally {
          delete (globalThis as Record<string, unknown>)[runtimeSpecifierKey];
        }

        assertEquals(config.sameInstance, true);
      }, { prefix: "vf-config-staged-cjs-scoped-js-require-" });
    });

    it("provides project-bound CommonJS require aliases while staging", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/staged-aliased-cjs-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "staged-aliased-cjs-dependency",
            main: "index.cjs",
          }),
        );
        await writeTextFile(`${dependencyDir}/index.cjs`, 'module.exports = "aliased";\n');

        const config = await loadConfigFromTempFile(
          'const dependencyName = "staged-aliased-cjs-dependency";\n' +
            "const load = require;\n" +
            "const { resolve } = require;\n" +
            "module.exports = { value: load(dependencyName), resolved: resolve(dependencyName) };",
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { resolved: string; value: string };

        assertStringIncludes(config.resolved, "/staged-aliased-cjs-dependency/index.cjs");
        assertEquals(config.value, "aliased");
      }, { prefix: "vf-config-staged-aliased-require-" });
    });

    it("preserves CommonJS export conditions for computed require calls", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/staged-dynamic-cjs-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "staged-dynamic-cjs-dependency",
            type: "module",
            exports: {
              require: "./require.cjs",
              import: "./import.js",
            },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/require.cjs`,
          'module.exports = { value: "dynamic-require" };\n',
        );
        await writeTextFile(
          `${dependencyDir}/import.js`,
          'export default { value: "wrong-condition" };\n',
        );
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));

        const config = await loadConfigFromTempFile(
          'const dependencyName = "staged-dynamic-cjs-dependency";\n' +
            "const dependency = require(dependencyName);\n" +
            "module.exports = {\n" +
            "  resolved: require.resolve(dependencyName),\n" +
            "  value: dependency.value,\n" +
            "};",
          `${projectDir}/veryfront.config.ts`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { resolved: string; value: string };

        assertStringIncludes(config.resolved, "/staged-dynamic-cjs-dependency/require.cjs");
        assertEquals(config.value, "dynamic-require");
      }, { prefix: "vf-config-staged-dynamic-cjs-require-" });
    });

    it("preserves CommonJS package import conditions for computed require calls", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "commonjs",
            imports: {
              "#dynamic-dependency": {
                require: "./require.cjs",
                import: "./import.js",
              },
            },
          }),
        );
        await writeTextFile(`${projectDir}/require.cjs`, 'module.exports = "dynamic-require";\n');
        await writeTextFile(`${projectDir}/import.js`, 'export default "wrong-condition";\n');

        const config = await loadConfigFromTempFile(
          'const dependencyName = "#dynamic-dependency";\n' +
            "const dependency = require(dependencyName);\n" +
            "module.exports = { value: dependency };",
          `${projectDir}/veryfront.config.ts`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { value: string };

        assertEquals(config.value, "dynamic-require");
      }, { prefix: "vf-config-staged-dynamic-cjs-imports-require-" });
    });

    it("shares one CommonJS module between static and computed requires", async () => {
      await withTempDir(async (projectDir) => {
        const loadMarker = `__vfMixedConfigRequire_${crypto.randomUUID().replaceAll("-", "_")}`;
        try {
          await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
          await writeTextFile(
            `${projectDir}/config-helper.cjs`,
            `globalThis[${JSON.stringify(loadMarker)}] = ` +
              `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
              `module.exports = { loads: globalThis[${JSON.stringify(loadMarker)}] };\n`,
          );

          const config = await loadConfigFromTempFile(
            'const helperName = "./config-helper.cjs";\n' +
              'const staticallyLoaded = require("./config-helper.cjs");\n' +
              "const dynamicallyLoaded = require(helperName);\n" +
              "module.exports = { staticallyLoaded, dynamicallyLoaded };\n",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as {
            staticallyLoaded: { loads: number };
            dynamicallyLoaded: { loads: number };
          };

          assertStrictEquals(config.staticallyLoaded, config.dynamicallyLoaded);
          assertEquals(config.staticallyLoaded.loads, 1);
          assertEquals((globalThis as Record<string, unknown>)[loadMarker], 1);
        } finally {
          delete (globalThis as Record<string, unknown>)[loadMarker];
        }
      }, { prefix: "vf-config-staged-mixed-cjs-require-" });
    });

    it("shares CommonJS .js modules between static and runtime-computed requires", async () => {
      await withTempDir(async (projectDir) => {
        const loadMarker = `__vfMixedJsConfigRequire_${crypto.randomUUID().replaceAll("-", "_")}`;
        const previousHelper = getHostEnv("VF_CONFIG_HELPER");
        try {
          await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
          await writeTextFile(
            `${projectDir}/config-helper.js`,
            `globalThis[${JSON.stringify(loadMarker)}] = ` +
              `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
              `module.exports = { loads: globalThis[${JSON.stringify(loadMarker)}] };\n`,
          );
          setEnv("VF_CONFIG_HELPER", "./config-helper.js");

          const config = await loadConfigFromTempFile(
            'const staticallyLoaded = require("./config-helper.js");\n' +
              "const dynamicallyLoaded = require(process.env.VF_CONFIG_HELPER);\n" +
              "module.exports = { staticallyLoaded, dynamicallyLoaded };\n",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as {
            staticallyLoaded: { loads: number };
            dynamicallyLoaded: { loads: number };
          };

          assertStrictEquals(config.staticallyLoaded, config.dynamicallyLoaded);
          assertEquals(config.staticallyLoaded.loads, 1);
          assertEquals((globalThis as Record<string, unknown>)[loadMarker], 1);
        } finally {
          delete (globalThis as Record<string, unknown>)[loadMarker];
          if (previousHelper === undefined) deleteEnv("VF_CONFIG_HELPER");
          else setEnv("VF_CONFIG_HELPER", previousHelper);
        }
      }, { prefix: "vf-config-staged-mixed-cjs-js-require-" });
    });

    it("resolves computed CommonJS requires relative to their declaring helper", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "module" }));
        await mkdir(`${projectDir}/nested`, { recursive: true });
        await writeTextFile(
          `${projectDir}/nested/helper.ts`,
          'const localName = "./value.cjs";\n' +
            "const value = require(localName);\n" +
            "module.exports = { resolved: require.resolve(localName), value };\n",
        );
        await writeTextFile(
          `${projectDir}/nested/value.cjs`,
          'module.exports = "nested-value";\n',
        );

        const config = await loadConfigFromTempFile(
          'module.exports = require("./nested/helper.ts");',
          `${projectDir}/veryfront.config.cjs`,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { resolved: string; value: string };

        assertStringIncludes(config.resolved, "/nested/value.cjs");
        assertEquals(config.value, "nested-value");
      }, { prefix: "vf-config-staged-nested-dynamic-cjs-require-" });
    });

    it("externalizes project-local native addon requires while staging", async () => {
      await withTempDir(async (projectDir) => {
        const addonPath = `${projectDir}/addon.node`;
        await writeTextFile(addonPath, "not a native binary\n");
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));

        const result = await bundleProjectConfigSourceForImport(
          'module.exports = require("./addon.node");',
          `${projectDir}/veryfront.config.cjs`,
        );

        assertStringIncludes(result, "createRequire");
        assertStringIncludes(result, "./addon.node");
      }, { prefix: "vf-config-staged-native-addon-" });
    });

    it("rejects native addon requires outside the project boundary", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const outsideAddon = `${outsideDir}/addon.node`;
          await writeTextFile(outsideAddon, "not a native binary\n");

          await assertRejects(
            () =>
              bundleProjectConfigSourceForImport(
                `module.exports = require(${JSON.stringify(outsideAddon)});`,
                `${projectDir}/veryfront.config.cjs`,
              ),
            Error,
            "outside the project directory",
          );
        }, { prefix: "vf-config-staged-native-addon-outside-" });
      }, { prefix: "vf-config-staged-native-addon-project-" });
    });

    it("preserves CommonJS require fallback for JSX and TypeScript helpers", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "module" }),
        );
        for (const extension of ["jsx", "ts", "tsx"]) {
          const helperName = `config-helper.${extension}`;
          await writeTextFile(
            `${projectDir}/${helperName}`,
            'const path = require("node:path");\n' +
              "module.exports = { base: path.basename(__filename) };\n",
          );

          const config = await loadConfigFromTempFile(
            `const helper = require("./${helperName}");\n` +
              "module.exports = { helperBase: helper.base };",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { helperBase: string };

          assertEquals(config.helperBase, helperName);
        }
      }, { prefix: "vf-config-staged-cjs-jsx-helper-" });
    });

    it("does not inject CommonJS globals into explicit ESM helpers", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "commonjs" }),
        );
        await writeTextFile(
          `${projectDir}/config-helper.mjs`,
          'const path = require("node:path");\n' +
            "export default { base: path.basename(__filename) };\n",
        );

        await assertRejects(
          () =>
            loadConfigFromTempFile(
              'module.exports = require("./config-helper.mjs");',
              `${projectDir}/veryfront.config.js`,
              (tempFile) => toFileUrl(tempFile).href,
              rewriteBareVeryfrontConfigImports,
              true,
            ),
          Error,
          "Dynamic require",
        );
      }, { prefix: "vf-config-staged-esm-helper-" });
    });

    it("preserves CommonJS config module paths while staging", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.cjs`;
        const config = await loadConfigFromTempFile(
          "module.exports = { configFilename: __filename, configDirname: __dirname };",
          configPath,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { configFilename: string; configDirname: string };

        assertEquals(config.configFilename, configPath);
        assertEquals(config.configDirname, projectDir);
      }, { prefix: "vf-config-staged-cjs-paths-" });
    });

    it("preserves CommonJS module filename and path fields while staging", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.cjs`;
        const config = await loadConfigFromTempFile(
          "module.exports = { configFilename: module.filename, configPath: module.path };",
          configPath,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { configFilename: string; configPath: string };

        assertEquals(config.configFilename, configPath);
        assertEquals(config.configPath, projectDir);
      }, { prefix: "vf-config-staged-cjs-module-paths-" });
    });

    it("preserves and applies CommonJS module search paths while staging", async () => {
      await withTempDir(async (projectDir) => {
        const customModules = `${projectDir}/custom_modules`;
        const dependencyDir = `${customModules}/custom-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({ name: "custom-config-dependency", main: "index.cjs" }),
        );
        await writeTextFile(`${dependencyDir}/index.cjs`, 'module.exports = "custom";\n');

        TestObjectDefineProperty(globalThis, "__veryfrontConfigModulePathName", {
          configurable: true,
          value: "custom-config-dependency",
        });
        try {
          const config = await loadConfigFromTempFile(
            `module.paths.unshift(${JSON.stringify(customModules)});\n` +
              "module.exports = {\n" +
              "  value: module.require(globalThis.__veryfrontConfigModulePathName),\n" +
              "  paths: module.paths,\n" +
              "};",
            `${projectDir}/veryfront.config.cjs`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { value: string; paths: string[] };

          assertEquals(config.value, "custom");
          assertEquals(config.paths[0], customModules);
        } finally {
          TestReflectApply(TestReflectDeleteProperty, Reflect, [
            globalThis,
            "__veryfrontConfigModulePathName",
          ]);
        }
      }, { prefix: "vf-config-staged-cjs-module-search-paths-" });
    });

    it("preserves CommonJS module.require while staging", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(`${projectDir}/package.json`, JSON.stringify({ type: "commonjs" }));
        await writeTextFile(`${projectDir}/config-helper.cjs`, 'module.exports = "loaded";\n');

        for (const configFile of ["veryfront.config.cjs", "veryfront.config.js"]) {
          const config = await loadConfigFromTempFile(
            'const helperName = "./config-helper.cjs";\n' +
              "const load = module.require;\n" +
              "module.exports = {\n" +
              '  direct: module.require("./config-helper.cjs"),\n' +
              "  detached: load(helperName),\n" +
              "  dot: module.require(helperName),\n" +
              '  bracket: module["require"](helperName),\n' +
              "};",
            `${projectDir}/${configFile}`,
            (tempFile) => toFileUrl(tempFile).href,
            rewriteBareVeryfrontConfigImports,
            true,
          ) as { direct: string; detached: string; dot: string; bracket: string };

          assertEquals(config, {
            direct: "loaded",
            detached: "loaded",
            dot: "loaded",
            bracket: "loaded",
          });
        }
      }, { prefix: "vf-config-staged-cjs-module-require-" });
    });

    it("preserves CommonJS package module paths for staged JavaScript configs", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "commonjs" }),
        );
        const configPath = `${projectDir}/veryfront.config.js`;
        const config = await loadConfigFromTempFile(
          "module.exports = { configFilename: __filename, configDirname: __dirname };",
          configPath,
          (tempFile) => toFileUrl(tempFile).href,
          rewriteBareVeryfrontConfigImports,
          true,
        ) as { configFilename: string; configDirname: string };

        assertEquals(config.configFilename, configPath);
        assertEquals(config.configDirname, projectDir);
      }, { prefix: "vf-config-staged-js-commonjs-paths-" });
    });

    it("preserves query and fragment identities in bundled config modules", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/config-values.ts`;
        await writeTextFile(valuesPath, "export const moduleUrl = import.meta.url;\n");

        const result = await bundleProjectConfigSourceForImport(
          'import { moduleUrl as preview } from "./config-values.ts?mode=preview";\n' +
            'import { moduleUrl as production } from "./config-values.ts#production";\n' +
            "export default { preview, production };",
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { preview: string; production: string };
        };

        const previewUrl = new URL(module.default.preview);
        const productionUrl = new URL(module.default.production);
        assertEquals(previewUrl.pathname.endsWith("/config-values.ts"), true);
        assertEquals(previewUrl.search, "?mode=preview");
        assertEquals(productionUrl.pathname.endsWith("/config-values.ts"), true);
        assertEquals(productionUrl.hash, "#production");
        assertEquals(module.default.preview === module.default.production, false);
      }, { prefix: "vf-config-module-suffix-" });
    });

    it("ignores node_modules ancestors above the project root", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/node_modules/workspace-app`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/config-values.ts`;
        await mkdir(projectDir, { recursive: true });
        await writeTextFile(valuesPath, 'export const title: string = "Workspace app";\n');

        const result = await bundleProjectConfigSourceForImport(
          'import { title } from "./config-values.ts"; export default { title };',
          configPath,
        );

        assertEquals(result.includes(toFileUrl(valuesPath).href), false);
        assertEquals(result.includes("Workspace app"), true);
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { title: string };
        };
        assertEquals(module.default.title, "Workspace app");
      }, { prefix: "vf-config-node-modules-ancestor-" });
    });

    it("bundles package import aliases that resolve to local TypeScript", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/config-values.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "module", imports: { "#config-values": "./config-values.ts" } }),
        );
        await writeTextFile(valuesPath, 'export const title: string = "Aliased config";\n');

        const result = await bundleProjectConfigSourceForImport(
          'import { title } from "#config-values";\nexport default { title };',
          configPath,
        );

        assertEquals(result.includes("#config-values"), false);
        assertEquals(result.includes(toFileUrl(valuesPath).href), false);
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { title: string };
        };
        assertEquals(module.default.title, "Aliased config");
      }, { prefix: "vf-config-import-alias-" });
    });

    it("allows package import aliases to hoisted dependencies", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/packages/app`;
        const dependencyDir = `${workspaceDir}/node_modules/hoisted-config-helper`;
        await mkdir(projectDir, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#config-helper": "hoisted-config-helper" },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({ name: "hoisted-config-helper", type: "module", exports: "./index.js" }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, 'export default "hoisted";\n');

        const result = await bundleProjectConfigSourceForImport(
          'import value from "#config-helper"; export default { value };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(module.default.value, "hoisted");
        assertStringIncludes(result, "/node_modules/hoisted-config-helper/index.js");
      }, { prefix: "vf-config-hoisted-import-alias-" });
    });

    it("rejects hoisted package import aliases that escape their package", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/packages/app`;
        const dependencyDir = `${workspaceDir}/node_modules/hoisted-config-helper`;
        const outsidePath = `${workspaceDir}/outside.js`;
        await mkdir(projectDir, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#config-helper": "hoisted-config-helper" },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({ name: "hoisted-config-helper", type: "module", exports: "./index.js" }),
        );
        await writeTextFile(outsidePath, 'export default "outside";\n');
        await symlink(outsidePath, `${dependencyDir}/index.js`);

        await assertRejects(
          () =>
            bundleProjectConfigSourceForImport(
              'import value from "#config-helper"; export default { value };',
              `${projectDir}/veryfront.config.ts`,
            ),
          Error,
          "escaped its package",
        );
      }, { prefix: "vf-config-hoisted-import-alias-escape-" });
    });

    it("accepts a BOM-prefixed package manifest while staging", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          `\uFEFF${
            JSON.stringify({
              type: "module",
              imports: { "#config-values": "./config-values.ts" },
            })
          }`,
        );
        await writeTextFile(
          `${projectDir}/config-values.ts`,
          'export const title = "BOM package manifest";\n',
        );

        const result = await bundleProjectConfigSourceForImport(
          'import { title } from "#config-values"; export default { title };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { title: string };
        };

        assertEquals(module.default.title, "BOM package manifest");
      }, { prefix: "vf-config-package-manifest-bom-" });
    });

    it("bundles project-local TypeScript imports addressed by file URL", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/file-url-values.ts`;
        await writeTextFile(valuesPath, 'export const title: string = "File URL config";\n');

        const result = await bundleProjectConfigSourceForImport(
          `import { title } from ${JSON.stringify(toFileUrl(valuesPath).href)};\n` +
            "export default { title };",
          configPath,
        );

        assertEquals(result.includes(toFileUrl(valuesPath).href), false);
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { title: string };
        };
        assertEquals(module.default.title, "File URL config");
      }, { prefix: "vf-config-file-url-" });
    });

    it("preserves query and fragment identities on project-local file URL imports", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const valuesPath = `${projectDir}/file-url-suffix-values.ts`;
        const valuesUrl = toFileUrl(valuesPath).href;
        await writeTextFile(
          valuesPath,
          'export const moduleUrl = import.meta.url;\nexport const title: string = "File URL suffix";\n',
        );

        const result = await bundleProjectConfigSourceForImport(
          `import { moduleUrl as preview, title } from ${
            JSON.stringify(`${valuesUrl}?mode=preview`)
          };\n` +
            `import { moduleUrl as production } from ${
              JSON.stringify(`${valuesUrl}#production`)
            };\n` +
            "export default { preview, production, title };",
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { preview: string; production: string; title: string };
        };

        assertEquals(new URL(module.default.preview).search, "?mode=preview");
        assertEquals(new URL(module.default.production).hash, "#production");
        assertEquals(module.default.preview === module.default.production, false);
        assertEquals(module.default.title, "File URL suffix");
      }, { prefix: "vf-config-file-url-suffix-" });
    });

    it("rejects absolute config imports outside the project", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const outsidePath = `${outsideDir}/outside.ts`;
          await writeTextFile(outsidePath, 'export const secret = "outside";\n');

          await assertRejects(
            () =>
              bundleProjectConfigSourceForImport(
                `import { secret } from ${JSON.stringify(outsidePath)}; export default { secret };`,
                `${projectDir}/veryfront.config.ts`,
              ),
            Error,
            "outside the project directory",
          );
        }, { prefix: "vf-config-absolute-outside-" });
      }, { prefix: "vf-config-absolute-project-" });
    });

    it("rejects relative config imports that escape through a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const outsidePath = `${outsideDir}/outside.ts`;
          const linkedPath = `${projectDir}/linked.ts`;
          await writeTextFile(outsidePath, 'export const secret = "outside";\n');
          await symlink(outsidePath, linkedPath);

          await assertRejects(
            () =>
              bundleProjectConfigSourceForImport(
                'import { secret } from "./linked.ts"; export default { secret };',
                `${projectDir}/veryfront.config.ts`,
              ),
            Error,
            "outside the project directory",
          );
        }, { prefix: "vf-config-symlink-outside-" });
      }, { prefix: "vf-config-symlink-project-" });
    });

    it("resolves staged config imports from the canonical symlink target", async () => {
      await withTempDir(async (projectDir) => {
        const configDir = `${projectDir}/configs`;
        const source = 'import { value } from "./helper.js";\n' +
          "export default { value, url: import.meta.url };\n";
        await mkdir(configDir, { recursive: true });
        await writeTextFile(`${configDir}/base.js`, source);
        await writeTextFile(`${configDir}/helper.js`, 'export const value = "from-target";\n');
        await symlink(`${configDir}/base.js`, `${projectDir}/veryfront.config.js`);

        const result = await bundleProjectConfigSourceForImport(
          source,
          `${projectDir}/veryfront.config.js`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string; url: string };
        };

        assertEquals(module.default.value, "from-target");
        assertEquals(
          normalizeMacOsVarAlias(module.default.url),
          normalizeMacOsVarAlias(toFileUrl(`${configDir}/base.js`).href),
        );
      }, { prefix: "vf-config-canonical-entry-symlink-" });
    });

    it("rejects package import aliases that escape through a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const outsidePath = `${outsideDir}/outside.ts`;
          const linkedPath = `${projectDir}/linked.ts`;
          await writeTextFile(outsidePath, 'export const secret = "outside";\n');
          await symlink(outsidePath, linkedPath);
          await writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({ type: "module", imports: { "#outside": "./linked.ts" } }),
          );

          await assertRejects(
            () =>
              bundleProjectConfigSourceForImport(
                'import { secret } from "#outside"; export default { secret };',
                `${projectDir}/veryfront.config.ts`,
              ),
            Error,
            "outside the project directory",
          );
        }, { prefix: "vf-config-alias-outside-" });
      }, { prefix: "vf-config-alias-project-" });
    });

    it("rejects file URL config imports that escape through a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const outsidePath = `${outsideDir}/outside.ts`;
          const linkedPath = `${projectDir}/linked.ts`;
          await writeTextFile(outsidePath, 'export const secret = "outside";\n');
          await symlink(outsidePath, linkedPath);

          await assertRejects(
            () =>
              bundleProjectConfigSourceForImport(
                `import { secret } from ${JSON.stringify(toFileUrl(linkedPath).href)}; ` +
                  "export default { secret };",
                `${projectDir}/veryfront.config.ts`,
              ),
            Error,
            "outside the project directory",
          );
        }, { prefix: "vf-config-file-url-outside-" });
      }, { prefix: "vf-config-file-url-project-" });
    });

    it("preserves nested package resolution and import.meta.resolve semantics", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const helperDir = `${projectDir}/packages/config-helper`;
        const dependencyDir = `${helperDir}/node_modules/nested-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "nested-config-dependency",
            type: "module",
            exports: { import: "./import.js" },
          }),
        );
        await writeTextFile(`${dependencyDir}/import.js`, 'export default "nested";\n');
        await writeTextFile(
          `${helperDir}/values.ts`,
          'import value from "nested-config-dependency";\n' +
            'export const resolved = import.meta.resolve("nested-config-dependency");\n' +
            "export { value };\n",
        );

        const result = await bundleProjectConfigSourceForImport(
          'import { resolved, value } from "./packages/config-helper/values.ts";\n' +
            "export default { resolved, value };",
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string; value: string };
        };

        assertEquals(module.default.value, "nested");
        assertStringIncludes(
          module.default.resolved,
          "/packages/config-helper/node_modules/nested-config-dependency/import.js",
        );
        assertStringIncludes(
          result,
          "/packages/config-helper/node_modules/nested-config-dependency/import.js",
          "installed packages must remain external instead of being folded into the config bundle",
        );
      }, { prefix: "vf-config-nested-package-" });
    });

    it("defers import.meta.resolve failures until guarded config code executes", async () => {
      await withTempDir(async (projectDir) => {
        const result = await bundleProjectConfigSourceForImport(
          'let resolved = "skipped";\n' +
            'if (false) resolved = import.meta.resolve("missing-optional-config-package");\n' +
            "let failure;\n" +
            "let zeroArgumentFailure;\n" +
            'try { import.meta.resolve("another-missing-config-package"); } catch (error) {\n' +
            '  resolved += ":caught";\n' +
            "  failure = { name: error.name, message: error.message, code: error.code };\n" +
            "}\n" +
            "try { import.meta.resolve(); } catch (error) {\n" +
            "  zeroArgumentFailure = { name: error.name, message: error.message, code: error.code };\n" +
            "}\n" +
            "export default { resolved, failure, zeroArgumentFailure };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: {
            resolved: string;
            failure: { name: string; message: string; code: string };
            zeroArgumentFailure: { name: string; message: string; code: string };
          };
        };

        assertEquals(module.default.resolved, "skipped:caught");
        assertEquals(module.default.failure.name, "Error");
        assertStringIncludes(module.default.failure.message, "another-missing-config-package");
        assertEquals(module.default.failure.code, "ERR_MODULE_NOT_FOUND");
        assertEquals(module.default.zeroArgumentFailure.name, "Error");
        assertStringIncludes(module.default.zeroArgumentFailure.message, "undefined");
        assertEquals(module.default.zeroArgumentFailure.code, "ERR_MODULE_NOT_FOUND");
      }, { prefix: "vf-config-deferred-resolve-" });
    });

    it("serializes deferred import.meta.resolve failures without project-controlled sets", async () => {
      const originalHas = Set.prototype.has;
      const originalAdd = Set.prototype.add;
      try {
        Set.prototype.has = function () {
          throw new Error("poisoned has");
        };
        Set.prototype.add = function () {
          throw new Error("poisoned add");
        };

        const cause = new TypeError("set-poisoned-inner-package");
        const error = new Error("set-poisoned-missing-package", { cause });
        TestObjectDefineProperty(error, "code", {
          configurable: true,
          value: "ERR_MODULE_NOT_FOUND",
        });

        const serialized = __serializeConfigResolveErrorForTests(error);

        assertEquals(serialized.constructorName, "Error");
        assertStringIncludes(serialized.message, "set-poisoned-missing-package");
        assertEquals(serialized.code, "ERR_MODULE_NOT_FOUND");
        assertEquals(
          typeof serialized.cause === "object" && serialized.cause !== null
            ? serialized.cause.constructorName
            : undefined,
          "TypeError",
        );
      } finally {
        Set.prototype.has = originalHas;
        Set.prototype.add = originalAdd;
      }
    });

    it("uses captured randomness when lazily creating the config resolver bridge", async () => {
      await withTempDir(async (projectDir) => {
        const cryptoPrototype = TestObjectGetPrototypeOf(crypto);
        const restore = replacePropertyForTest(cryptoPrototype, "randomUUID", {
          value: () => {
            throw new Error("ambient crypto.randomUUID must not initialize the config bridge");
          },
        });
        try {
          const result = await bundleProjectConfigSourceForImport(
            'const specifier = "./asset.txt";\n' +
              "export default { resolved: import.meta.resolve(specifier) };",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { resolved: string };
          };

          assertEquals(module.default.resolved, toFileUrl(`${projectDir}/asset.txt`).href);
        } finally {
          restore();
        }
      }, { prefix: "vf-config-resolver-randomness-" });
    });

    it("preserves computed import.meta.resolve calls in bundled configs", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const assetPath = `${projectDir}/asset.txt`;
        await writeTextFile(assetPath, "asset\n");

        const result = await bundleProjectConfigSourceForImport(
          'const specifier = "./asset.txt";\n' +
            'const moduleRelative = new URL("./asset.txt", import.meta.url).href;\n' +
            "if (false) import.meta.resolve(globalThis.MISSING_CONFIG_SPECIFIER);\n" +
            "export default {\n" +
            "  resolved: import.meta.resolve(specifier),\n" +
            "  nested: import.meta.resolve(moduleRelative),\n" +
            "};",
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string; nested: string };
        };

        assertEquals(module.default.resolved, toFileUrl(assetPath).href);
        assertEquals(module.default.nested, toFileUrl(assetPath).href);
      }, { prefix: "vf-config-computed-resolve-" });
    });

    it("preserves detached import.meta.resolve functions in bundled configs", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const assetPath = `${projectDir}/asset.txt`;
        await writeTextFile(assetPath, "asset\n");

        const result = await bundleProjectConfigSourceForImport(
          "const resolve = import.meta.resolve;\n" +
            'export default { resolved: resolve("./asset.txt") };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertEquals(module.default.resolved, toFileUrl(assetPath).href);
      }, { prefix: "vf-config-detached-resolve-" });
    });

    it("binds aliased and destructured import.meta objects to their source module", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const assetPath = `${projectDir}/asset.txt`;
        await writeTextFile(assetPath, "asset\n");

        const result = await bundleProjectConfigSourceForImport(
          "const metadata = import.meta;\n" +
            "const { url, dirname, filename, resolve } = metadata;\n" +
            'export default { url, dirname, filename, resolved: resolve("./asset.txt") };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { dirname: string; filename: string; resolved: string; url: string };
        };

        assertEquals(module.default.url, toFileUrl(configPath).href);
        assertEquals(module.default.dirname, projectDir);
        assertEquals(module.default.filename, configPath);
        assertEquals(module.default.resolved, toFileUrl(assetPath).href);
      }, { prefix: "vf-config-whole-import-meta-" });
    });

    it("resolves exact dot segments as module-relative URLs", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/nested/veryfront.config.ts`;
        await mkdir(dirname(configPath), { recursive: true });
        const result = await bundleProjectConfigSourceForImport(
          'export default { current: import.meta.resolve("."), parent: import.meta.resolve("..") };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { current: string; parent: string };
        };

        assertEquals(module.default.current, new URL(".", toFileUrl(configPath)).href);
        assertEquals(module.default.parent, new URL("..", toFileUrl(configPath)).href);
      }, { prefix: "vf-config-dot-resolve-" });
    });

    it("preserves suffixes on absolute import.meta.resolve paths", async () => {
      await withTempDir(async (projectDir) => {
        const assetPath = `${projectDir}/asset.js`;
        const specifier = `${assetPath}?mode=preview#fragment`;
        const escapedSpecifier = `${projectDir}/escaped%20asset.js`;
        const result = await bundleProjectConfigSourceForImport(
          "export default {\n" +
            `  resolved: import.meta.resolve(${JSON.stringify(specifier)}),\n` +
            `  escaped: import.meta.resolve(${JSON.stringify(escapedSpecifier)}),\n` +
            "};",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { escaped: string; resolved: string };
        };

        assertEquals(
          module.default.resolved,
          `${toFileUrl(assetPath).href}?mode=preview#fragment`,
        );
        assertEquals(
          module.default.escaped,
          `file://${escapedSpecifier}`,
        );
      }, { prefix: "vf-config-absolute-resolve-suffix-" });
    });

    it("preserves package suffixes in literal import.meta.resolve calls", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/config-resolve-suffix`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "config-resolve-suffix",
            type: "module",
            exports: { "./*": "./*.js" },
          }),
        );
        await writeTextFile(`${dependencyDir}/value.js`, "export default 'value';\n");

        const result = await bundleProjectConfigSourceForImport(
          'export default { resolved: import.meta.resolve("config-resolve-suffix/value?raw#part") };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertEquals(
          normalizeMacOsVarAlias(module.default.resolved),
          `${toFileUrl(`${dependencyDir}/value`).href}?raw#part.js`,
        );
      }, { prefix: "vf-config-package-resolve-suffix-" });
    });

    it("resolves missing package export targets prospectively", async () => {
      await withTempDir(async (projectDir) => {
        const rootDependencyDir = `${projectDir}/node_modules/config-missing-root-export`;
        const subpathDependencyDir = `${projectDir}/node_modules/config-missing-subpath-export`;
        await mkdir(rootDependencyDir, { recursive: true });
        await mkdir(subpathDependencyDir, { recursive: true });
        await writeTextFile(
          `${rootDependencyDir}/package.json`,
          JSON.stringify({
            name: "config-missing-root-export",
            type: "module",
            exports: "./missing.js",
          }),
        );
        await writeTextFile(
          `${subpathDependencyDir}/package.json`,
          JSON.stringify({
            name: "config-missing-subpath-export",
            type: "module",
            exports: { "./feature": "./missing-feature.js" },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          "export default {\n" +
            '  root: import.meta.resolve("config-missing-root-export"),\n' +
            '  subpath: import.meta.resolve("config-missing-subpath-export/feature"),\n' +
            "};",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { root: string; subpath: string };
        };

        assertEquals(
          normalizeMacOsVarAlias(module.default.root),
          toFileUrl(`${rootDependencyDir}/missing.js`).href,
        );
        assertEquals(
          normalizeMacOsVarAlias(module.default.subpath),
          toFileUrl(`${subpathDependencyDir}/missing-feature.js`).href,
        );
      }, { prefix: "vf-config-package-missing-export-" });
    });

    it("fails closed for computed package import aliases in staged configs", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#computed-config-value": {
                require: "./require.cjs",
                import: "./import.js",
              },
            },
          }),
        );
        await writeTextFile(`${projectDir}/require.cjs`, 'module.exports = "require";\n');
        await writeTextFile(`${projectDir}/import.js`, 'export default "import";\n');

        const result = await bundleProjectConfigSourceForImport(
          'const specifier = "#computed-config-value";\n' +
            "export default { resolved: import.meta.resolve(specifier) };",
          `${projectDir}/veryfront.config.ts`,
        );

        await assertRejects(
          () => import(`data:application/javascript;base64,${btoa(result)}`),
          TypeError,
          "Computed package specifiers in import.meta.resolve() are unavailable",
        );
      }, { prefix: "vf-config-computed-import-alias-" });
    });

    it("fails closed for computed bare package import.meta.resolve calls", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/computed-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "computed-config-dependency",
            type: "module",
            exports: { import: "./import.js" },
          }),
        );
        await writeTextFile(`${dependencyDir}/import.js`, 'export default "import";\n');

        const result = await bundleProjectConfigSourceForImport(
          'const packageName = "computed-config-dependency";\n' +
            "export default { resolved: import.meta.resolve(packageName) };",
          `${projectDir}/veryfront.config.ts`,
        );

        await assertRejects(
          () => import(`data:application/javascript;base64,${btoa(result)}`),
          TypeError,
          "Computed package specifiers in import.meta.resolve() are unavailable",
        );
      }, { prefix: "vf-config-computed-resolve-conditions-" });
    });

    it("matches Node built-in package import target semantics", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#filesystem": "fs",
              "#invalid-filesystem": "node:fs",
            },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          'const resolved = import.meta.resolve("#filesystem");\n' +
            "let failureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#invalid-filesystem"); }\n' +
            "catch (error) { failureCode = error.code; }\n" +
            "export default { resolved, failureCode };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string; failureCode: string };
        };

        assertEquals(module.default.resolved, "node:fs");
        assertEquals(module.default.failureCode, "ERR_INVALID_PACKAGE_TARGET");
      }, { prefix: "vf-config-package-import-builtin-" });
    });

    it("activates module-sync on Node releases that support synchronous ESM", () => {
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], undefined, "import", true),
        ["node", "import", "module-sync", "node-addons"],
      );
      assertEquals(
        __getNodeConfigBundleConditionsForTests([], undefined, true),
        ["node", "module-sync", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], undefined, "import", false),
        ["node", "import", "node-addons"],
      );
    });

    it("rejects invalid bare package import targets before redirecting", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#self": ".",
            },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          "let failureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#self"); } catch (error) { failureCode = error.code; }\n' +
            "export default { failureCode };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { failureCode: string };
        };

        assertEquals(module.default.failureCode, "ERR_INVALID_MODULE_SPECIFIER");
      }, { prefix: "vf-config-package-import-invalid-target-" });
    });

    it("rejects invalid package import names before consulting the imports map", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#": "./root.js",
              "#probe/": "./probe.js",
            },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          "const failures = {};\n" +
            'try { import.meta.resolve("#"); } catch (error) { failures.root = error.code; }\n' +
            'try { import.meta.resolve("#probe/"); } ' +
            "catch (error) { failures.trailing = error.code; }\n" +
            "export default failures;",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: Record<string, string>;
        };

        assertEquals(module.default, {
          root: "ERR_INVALID_MODULE_SPECIFIER",
          trailing: "ERR_INVALID_MODULE_SPECIFIER",
        });
      }, { prefix: "vf-config-package-import-invalid-name-" });
    });

    it("resolves bare package import targets from their defining package scope", async () => {
      await withTempDir(async (projectDir) => {
        const helperDir = `${projectDir}/packages/helper`;
        const rootDependencyDir = `${projectDir}/node_modules/scoped-config-dependency`;
        const nestedDependencyDir = `${helperDir}/node_modules/scoped-config-dependency`;
        await mkdir(rootDependencyDir, { recursive: true });
        await mkdir(nestedDependencyDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#dependency": "scoped-config-dependency" },
          }),
        );
        for (
          const [directory, value] of [
            [rootDependencyDir, "root"],
            [nestedDependencyDir, "nested"],
          ] as const
        ) {
          await writeTextFile(
            `${directory}/package.json`,
            JSON.stringify({
              name: "scoped-config-dependency",
              type: "module",
              exports: "./index.js",
            }),
          );
          await writeTextFile(
            `${directory}/index.js`,
            `export default ${JSON.stringify(value)};\n`,
          );
        }
        await writeTextFile(
          `${helperDir}/values.ts`,
          'import value from "#dependency";\n' +
            'export const resolved = import.meta.resolve("#dependency");\n' +
            "export { value };\n",
        );

        const result = await bundleProjectConfigSourceForImport(
          'import { resolved, value } from "./packages/helper/values.ts";\n' +
            "export default { resolved, value };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string; value: string };
        };

        assertEquals(module.default.value, "root");
        assertStringIncludes(
          module.default.resolved,
          "/node_modules/scoped-config-dependency/index.js",
        );
        assertEquals(module.default.resolved.includes("/packages/helper/node_modules/"), false);
      }, { prefix: "vf-config-package-import-defining-scope-" });
    });

    it("matches Node's default node-addons package condition", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#native-condition": {
                "node-addons": "./addon.js",
                default: "./fallback.js",
              },
            },
          }),
        );
        await writeTextFile(`${projectDir}/addon.js`, "export default 'addon';\n");
        await writeTextFile(`${projectDir}/fallback.js`, "export default 'fallback';\n");

        const result = await bundleProjectConfigSourceForImport(
          'export default { resolved: import.meta.resolve("#native-condition") };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(module.default.resolved, "/addon.js");
      }, { prefix: "vf-config-package-import-node-addons-" });
    });

    it("matches Node package import pattern specificity", async () => {
      await withTempDir(async (projectDir) => {
        await mkdir(`${projectDir}/broad`, { recursive: true });
        await mkdir(`${projectDir}/specific`, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#probe/*": "./broad/*.js",
              "#probe/*.js": "./specific/*.js",
            },
          }),
        );
        await writeTextFile(`${projectDir}/broad/value.js.js`, "export default 'broad';\n");
        await writeTextFile(`${projectDir}/specific/value.js`, "export default 'specific';\n");

        const result = await bundleProjectConfigSourceForImport(
          'export default { resolved: import.meta.resolve("#probe/value.js") };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(module.default.resolved, "/specific/value.js");
      }, { prefix: "vf-config-package-import-pattern-specificity-" });
    });

    it("matches Node package import pattern boundaries", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#empty*": "./empty.js",
              "#multi*": "./valid.js",
              "#multi**": "./invalid.js",
            },
          }),
        );
        await writeTextFile(`${projectDir}/empty.js`, "export default 'empty';\n");
        await writeTextFile(`${projectDir}/valid.js`, "export default 'valid';\n");
        await writeTextFile(`${projectDir}/invalid.js`, "export default 'invalid';\n");

        const result = await bundleProjectConfigSourceForImport(
          "let emptyFailureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#empty"); }\n' +
            "catch (error) { emptyFailureCode = error.code; }\n" +
            "export default {\n" +
            "  emptyFailureCode,\n" +
            '  multi: import.meta.resolve("#multivalue*"),\n' +
            "};",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { emptyFailureCode: string; multi: string };
        };

        assertEquals(module.default.emptyFailureCode, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
        assertStringIncludes(module.default.multi, "/valid.js");
      }, { prefix: "vf-config-package-import-pattern-boundaries-" });
    });

    it("uses Node's node-addons condition for package imports", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#conditional": {
                "node-addons": "./addons.js",
                default: "./default.js",
              },
            },
          }),
        );
        await writeTextFile(`${projectDir}/addons.js`, "export default 'addons';\n");
        await writeTextFile(`${projectDir}/default.js`, "export default 'default';\n");

        const result = await bundleProjectConfigSourceForImport(
          'export default { resolved: import.meta.resolve("#conditional") };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(module.default.resolved, "/addons.js");
      }, { prefix: "vf-config-package-import-node-addons-" });
    });

    it("uses active user conditions for package imports", () => {
      const target = {
        development: "./development.js",
        default: "./default.js",
      };

      assertEquals(
        __resolveNodeConfigPackageTargetForTests(target, ["node", "import", "development"]),
        "./development.js",
      );
      assertEquals(
        __resolveNodeConfigPackageTargetForTests(target, ["node", "import"]),
        "./default.js",
      );
    });

    it("rejects numeric package condition keys", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#numeric-condition": {
                "1": "./numeric.js",
                default: "./fallback.js",
              },
            },
          }),
        );
        await writeTextFile(`${projectDir}/numeric.js`, "export default 'numeric';\n");
        await writeTextFile(`${projectDir}/fallback.js`, "export default 'fallback';\n");

        const result = await bundleProjectConfigSourceForImport(
          "let failureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#numeric-condition"); }\n' +
            "catch (error) { failureCode = error.code; }\n" +
            "export default { failureCode };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { failureCode: string };
        };

        assertEquals(module.default.failureCode, "ERR_INVALID_PACKAGE_CONFIG");
      }, { prefix: "vf-config-numeric-condition-" });

      assertEquals(
        __resolveNodeConfigPackageTargetForTests(
          { "01": "./leading-zero.js", default: "./fallback.js" },
          ["node", "import", "01"],
        ),
        "./leading-zero.js",
      );
    });

    it("resolves missing package import targets without requiring the file", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "module", imports: { "#missing": "./missing.js" } }),
        );

        const result = await bundleProjectConfigSourceForImport(
          'export default { resolved: import.meta.resolve("#missing") };',
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertEquals(module.default.resolved, toFileUrl(`${projectDir}/missing.js`).href);
      }, { prefix: "vf-config-package-import-missing-target-" });
    });

    it("rejects a missing package import target behind a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          await writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({ type: "module", imports: { "#outside": "./linked.js" } }),
          );
          await symlink(`${outsideDir}/missing.js`, `${projectDir}/linked.js`);

          const result = await bundleProjectConfigSourceForImport(
            "let failureCode = 'not-thrown';\n" +
              'try { import.meta.resolve("#outside"); }\n' +
              "catch (error) { failureCode = error.code; }\n" +
              "export default { failureCode };",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { failureCode: string };
          };

          assertEquals(module.default.failureCode, "ENOENT");
        }, { prefix: "vf-config-package-import-missing-outside-" });
      }, { prefix: "vf-config-package-import-broken-symlink-" });
    });

    it("rejects invalid package import target path segments", async () => {
      await withTempDir(async (projectDir) => {
        await mkdir(`${projectDir}/node_modules`, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#invalid-segment": "./node_modules/inner.js" },
          }),
        );
        await writeTextFile(`${projectDir}/node_modules/inner.js`, "export default 'inner';\n");

        const result = await bundleProjectConfigSourceForImport(
          "let failureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#invalid-segment"); }\n' +
            "catch (error) { failureCode = error.code; }\n" +
            "export default { failureCode };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { failureCode: string };
        };

        assertEquals(module.default.failureCode, "ERR_INVALID_PACKAGE_TARGET");
      }, { prefix: "vf-config-package-import-invalid-segment-" });
    });

    it("rejects percent-encoded separators in package import targets", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#forward": "./features/%2fsecret.js",
              "#backward": "./features/%5Csecret.js",
            },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          "const failures = {};\n" +
            'try { import.meta.resolve("#forward"); } ' +
            "catch (error) { failures.forward = error.code; }\n" +
            'try { import.meta.resolve("#backward"); } ' +
            "catch (error) { failures.backward = error.code; }\n" +
            "export default failures;",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: Record<string, string>;
        };

        assertEquals(module.default, {
          forward: "ERR_INVALID_PACKAGE_TARGET",
          backward: "ERR_INVALID_PACKAGE_TARGET",
        });
      }, { prefix: "vf-config-package-import-encoded-separator-" });
    });

    it("rejects invalid package import segments introduced by pattern substitution", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#feature/*": "./features/*" },
          }),
        );

        const result = await bundleProjectConfigSourceForImport(
          "const failures = {};\n" +
            'try { import.meta.resolve("#feature/../secret.js"); }\n' +
            "catch (error) { failures.parent = error.code; }\n" +
            'try { import.meta.resolve("#feature/%2e%2e/secret.js"); }\n' +
            "catch (error) { failures.encoded = error.code; }\n" +
            'try { import.meta.resolve("#feature/node_modules/secret.js"); }\n' +
            "catch (error) { failures.nodeModules = error.code; }\n" +
            "export default failures;",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: Record<string, string>;
        };

        assertEquals(module.default, {
          parent: "ERR_INVALID_PACKAGE_TARGET",
          encoded: "ERR_INVALID_PACKAGE_TARGET",
          nodeModules: "ERR_INVALID_PACKAGE_TARGET",
        });
      }, { prefix: "vf-config-package-import-pattern-invalid-segment-" });
    });

    it("continues through invalid package import array targets", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#invalid-fallback": ["../unsupported.js", "./fallback.js"],
              "#null-fallback": [null, "./fallback.js"],
              "#invalid": ["../unsupported.js", "node:fs"],
            },
          }),
        );
        await writeTextFile(`${projectDir}/fallback.js`, "export default 'fallback';\n");

        const result = await bundleProjectConfigSourceForImport(
          "let failureCode = 'not-thrown';\n" +
            'try { import.meta.resolve("#invalid"); }\n' +
            "catch (error) { failureCode = error.code; }\n" +
            "export default {\n" +
            '  invalid: import.meta.resolve("#invalid-fallback"),\n' +
            '  nullTarget: import.meta.resolve("#null-fallback"),\n' +
            "  failureCode,\n" +
            "};",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { invalid: string; nullTarget: string; failureCode: string };
        };

        assertStringIncludes(module.default.invalid, "/fallback.js");
        assertStringIncludes(module.default.nullTarget, "/fallback.js");
        assertEquals(module.default.failureCode, "ERR_INVALID_PACKAGE_TARGET");
      }, { prefix: "vf-config-package-import-array-fallback-" });
    });

    it("uses an installed dependency when a same-named project has no exports", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/app`;
        const packageName = "shadowed-config-dependency";
        const dependencyDir = `${workspaceDir}/node_modules/${packageName}`;
        await mkdir(projectDir, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ name: packageName, type: "module" }),
        );
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({ name: packageName, type: "module", exports: "./index.js" }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, "export default 'dependency';\n");

        const result = await bundleProjectConfigSourceForImport(
          `export default { resolved: import.meta.resolve(${JSON.stringify(packageName)}) };`,
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(
          module.default.resolved,
          `/node_modules/${packageName}/index.js`,
        );
      }, { prefix: "vf-config-package-self-reference-without-exports-" });
    });

    it("uses an installed dependency when a same-named project has null exports", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/app`;
        const packageName = "null-exports-config-dependency";
        const dependencyDir = `${workspaceDir}/node_modules/${packageName}`;
        await mkdir(projectDir, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ name: packageName, type: "module", exports: null }),
        );
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({ name: packageName, type: "module", exports: "./index.js" }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, "export default 'dependency';\n");

        const result = await bundleProjectConfigSourceForImport(
          `export default { resolved: import.meta.resolve(${JSON.stringify(packageName)}) };`,
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(
          module.default.resolved,
          `/node_modules/${packageName}/index.js`,
        );
      }, { prefix: "vf-config-package-self-reference-null-exports-" });
    });

    it("uses a dependency legacy main when its exports field is null", async () => {
      await withTempDir(async (projectDir) => {
        const packageName = "null-exports-legacy-main-dependency";
        const dependencyDir = `${projectDir}/node_modules/${packageName}`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: packageName,
            type: "module",
            exports: null,
            main: "./legacy.js",
          }),
        );
        await writeTextFile(`${dependencyDir}/legacy.js`, "export default 'legacy-main';\n");

        const result = await bundleProjectConfigSourceForImport(
          `export default { resolved: import.meta.resolve(${JSON.stringify(packageName)}) };`,
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(module.default.resolved, `/node_modules/${packageName}/legacy.js`);
      }, { prefix: "vf-config-package-null-exports-legacy-main-" });
    });

    it("resolves missing legacy dependency subpaths when exports is null", async () => {
      await withTempDir(async (projectDir) => {
        const packageName = "null-exports-legacy-subpath-dependency";
        const dependencyDir = `${projectDir}/node_modules/${packageName}`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: packageName,
            type: "module",
            exports: null,
          }),
        );

        const specifier = `${packageName}/generated.js?raw#part`;
        const result = await bundleProjectConfigSourceForImport(
          `export default { resolved: import.meta.resolve(${JSON.stringify(specifier)}) };`,
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertEquals(
          module.default.resolved,
          `${toFileUrl(`${dependencyDir}/generated.js`).href}?raw#part`,
        );
      }, { prefix: "vf-config-package-null-exports-legacy-subpath-" });
    });

    it("rejects missing null-exports subpaths behind a symlink parent", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const packageName = "null-exports-symlink-subpath-dependency";
          const dependencyDir = `${projectDir}/node_modules/${packageName}`;
          await mkdir(dependencyDir, { recursive: true });
          await writeTextFile(
            `${dependencyDir}/package.json`,
            JSON.stringify({
              name: packageName,
              type: "module",
              exports: null,
            }),
          );
          await symlink(outsideDir, `${dependencyDir}/linked`);

          const result = await bundleProjectConfigSourceForImport(
            'let failureCode = "not-thrown";\n' +
              `try { import.meta.resolve(${
                JSON.stringify(`${packageName}/linked/missing.js`)
              }); }\n` +
              "catch (error) { failureCode = error.code; }\n" +
              "export default { failureCode };",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { failureCode: string };
          };

          assertEquals(module.default.failureCode, "ERR_PACKAGE_PATH_NOT_EXPORTED");
        }, { prefix: "vf-config-package-null-exports-symlink-outside-" });
      }, { prefix: "vf-config-package-null-exports-symlink-project-" });
    });

    it("resolves missing package-import leaves without allowing symlink-parent escape", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          await writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({
              type: "module",
              imports: {
                "#generated": "./generated/output.js",
                "#outside-missing": "./linked/missing.js",
              },
            }),
          );
          await mkdir(`${projectDir}/generated`, { recursive: true });
          await symlink(outsideDir, `${projectDir}/linked`);

          const result = await bundleProjectConfigSourceForImport(
            'let failureCode = "not-thrown";\n' +
              'try { import.meta.resolve("#outside-missing"); }\n' +
              "catch (error) { failureCode = error.code; }\n" +
              "export default {\n" +
              '  generated: import.meta.resolve("#generated"),\n' +
              "  failureCode,\n" +
              "};",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { generated: string; failureCode: string };
          };

          assertStringIncludes(module.default.generated, "/generated/output.js");
          assertEquals(module.default.failureCode, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
        }, { prefix: "vf-config-missing-package-target-outside-" });
      }, { prefix: "vf-config-missing-package-target-project-" });
    });

    it("rejects literal package exports that escape through a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const dependencyDir = `${projectDir}/node_modules/literal-symlink-config-dependency`;
          await mkdir(dependencyDir, { recursive: true });
          await writeTextFile(
            `${dependencyDir}/package.json`,
            JSON.stringify({
              name: "literal-symlink-config-dependency",
              type: "module",
              exports: "./linked.js",
            }),
          );
          await writeTextFile(`${outsideDir}/outside.js`, 'export default "outside";\n');
          await symlink(`${outsideDir}/outside.js`, `${dependencyDir}/linked.js`);

          const result = await bundleProjectConfigSourceForImport(
            "let failureCode = 'not-thrown';\n" +
              'try { import.meta.resolve("literal-symlink-config-dependency"); }\n' +
              "catch (error) { failureCode = error.code; }\n" +
              "export default { failureCode };",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { failureCode: string };
          };

          assertEquals(module.default.failureCode, "ERR_PACKAGE_PATH_NOT_EXPORTED");
        }, { prefix: "vf-config-literal-symlink-outside-" });
      }, { prefix: "vf-config-literal-symlink-project-" });
    });

    it("rejects missing package-export leaves behind a symlink parent", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const cases = [
            {
              packageName: "missing-root-export-config-dependency",
              exports: "./linked/missing.js",
              specifier: "missing-root-export-config-dependency",
            },
            {
              packageName: "missing-subpath-export-config-dependency",
              exports: { "./outside": "./linked/missing.js" },
              specifier: "missing-subpath-export-config-dependency/outside",
            },
          ] as const;
          for (const testCase of cases) {
            const dependencyDir = `${projectDir}/node_modules/${testCase.packageName}`;
            await mkdir(dependencyDir, { recursive: true });
            await writeTextFile(
              `${dependencyDir}/package.json`,
              JSON.stringify({
                name: testCase.packageName,
                type: "module",
                exports: testCase.exports,
              }),
            );
            await symlink(outsideDir, `${dependencyDir}/linked`);

            const result = await bundleProjectConfigSourceForImport(
              "let failureCode = 'not-thrown';\n" +
                `try { import.meta.resolve(${JSON.stringify(testCase.specifier)}); }\n` +
                "catch (error) { failureCode = error.code; }\n" +
                "export default { failureCode };",
              `${projectDir}/veryfront.config.ts`,
            );
            const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
              default: { failureCode: string };
            };

            assertEquals(module.default.failureCode, "ERR_PACKAGE_PATH_NOT_EXPORTED");
          }
        }, { prefix: "vf-config-missing-export-outside-" });
      }, { prefix: "vf-config-missing-export-project-" });
    });

    it("rejects literal package imports that escape through a symlink", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          await writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({
              type: "module",
              imports: { "#outside": "./linked.js" },
            }),
          );
          await writeTextFile(`${outsideDir}/outside.js`, 'export default "outside";\n');
          await symlink(`${outsideDir}/outside.js`, `${projectDir}/linked.js`);

          const result = await bundleProjectConfigSourceForImport(
            "let failureCode = 'not-thrown';\n" +
              'try { import.meta.resolve("#outside"); }\n' +
              "catch (error) { failureCode = error.code; }\n" +
              "export default { failureCode };",
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { failureCode: string };
          };

          assertEquals(module.default.failureCode, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
        }, { prefix: "vf-config-literal-import-symlink-outside-" });
      }, { prefix: "vf-config-literal-import-symlink-project-" });
    });

    it("fails closed before interpreting null computed package conditions", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/blocked-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "blocked-config-dependency",
            type: "module",
            exports: {
              ".": {
                import: null,
                default: "./fallback.js",
              },
            },
          }),
        );
        await writeTextFile(`${dependencyDir}/fallback.js`, 'export default "fallback";\n');

        const result = await bundleProjectConfigSourceForImport(
          'const packageName = "blocked-config-dependency";\n' +
            "export default { resolved: import.meta.resolve(packageName) };",
          `${projectDir}/veryfront.config.ts`,
        );

        await assertRejects(
          () => import(`data:application/javascript;base64,${btoa(result)}`),
          TypeError,
          "Computed package specifiers in import.meta.resolve() are unavailable",
        );
      }, { prefix: "vf-config-computed-resolve-blocked-" });
    });

    it("uses ESM import conditions for import.meta.resolve in bundled configs", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/runtime-resolve-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "runtime-resolve-config-dependency",
            type: "module",
            exports: {
              ".": {
                require: "./require.cjs",
                import: "./import.js",
              },
            },
          }),
        );
        await writeTextFile(`${dependencyDir}/require.cjs`, 'module.exports = "require";\n');
        await writeTextFile(`${dependencyDir}/import.js`, 'export default "import";\n');

        const result = await bundleProjectConfigSourceForImport(
          'const resolved = import.meta.resolve("runtime-resolve-config-dependency");\n' +
            "export default { resolved };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(
          module.default.resolved,
          "/runtime-resolve-config-dependency/import.js",
        );
      }, { prefix: "vf-config-runtime-resolve-conditions-" });
    });

    it("resolves bare legacy package main entries for runtime import.meta.resolve", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/legacy-resolve-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "legacy-resolve-config-dependency",
            type: "module",
            main: "index.js",
          }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, 'export default "legacy";\n');

        const result = await bundleProjectConfigSourceForImport(
          'const resolved = import.meta.resolve("legacy-resolve-config-dependency");\n' +
            "export default { resolved };",
          `${projectDir}/veryfront.config.ts`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { resolved: string };
        };

        assertStringIncludes(
          module.default.resolved,
          "/legacy-resolve-config-dependency/index.js",
        );
      }, { prefix: "vf-config-runtime-resolve-legacy-main-" });
    });

    it("uses ESM conditions when a custom bundler cannot resolve plugin specifiers", async () => {
      const previousBundler = tryResolveExtensionContract<Bundler>("Bundler");
      if (!previousBundler) throw new Error("Expected the default bundler to be registered");
      const resolverFailureMessage = "Invalid </script>\u2028resolver configuration";
      const passthroughBundler: Bundler = {
        async bundle(options) {
          if (options.stdin?.contents.includes("invalid-config-resolver")) {
            return {
              outputFiles: [],
              warnings: [],
              errors: [{ text: resolverFailureMessage }],
            };
          }
          if (options.stdin) return await previousBundler.bundle(options);
          let loadEntry:
            | ((
              args: OnLoadArgs,
            ) =>
              | OnLoadResult
              | null
              | undefined
              | void
              | Promise<OnLoadResult | null | undefined | void>)
            | undefined;
          const pluginBuild: BundlerPluginBuild = {
            onResolve() {},
            onLoad(pluginOptions, callback) {
              if (pluginOptions.namespace === "veryfront-config-entry") loadEntry = callback;
            },
            onDispose() {},
          };
          for (const plugin of options.plugins ?? []) await plugin.setup(pluginBuild);
          if (!loadEntry) throw new Error("Config entry loader was not registered");
          const loaded = await loadEntry({
            path: Array.isArray(options.entryPoints)
              ? options.entryPoints[0] ?? "veryfront:project-config-entry"
              : "veryfront:project-config-entry",
            namespace: "veryfront-config-entry",
          });
          if (!loaded || typeof loaded.contents !== "string") {
            throw new Error("Config entry loader did not return source text");
          }
          return {
            outputFiles: [{
              path: "",
              contents: new TextEncoder().encode(loaded.contents),
              text: loaded.contents,
            }],
            warnings: [],
            errors: [],
          };
        },
        transform(options) {
          return previousBundler.transform(options);
        },
      };

      unregisterExtensionContract("Bundler");
      registerExtensionContract("Bundler", passthroughBundler);
      try {
        await withTempDir(async (projectDir) => {
          const dependencyDir = `${projectDir}/node_modules/import-only-config-dependency`;
          await mkdir(dependencyDir, { recursive: true });
          await writeTextFile(
            `${dependencyDir}/package.json`,
            JSON.stringify({
              name: "import-only-config-dependency",
              type: "module",
              exports: { import: "./import.js" },
            }),
          );
          await writeTextFile(`${dependencyDir}/import.js`, 'export default "import";\n');

          const result = await bundleProjectConfigSourceForImport(
            'export default { resolved: import.meta.resolve("import-only-config-dependency") };',
            `${projectDir}/veryfront.config.ts`,
          );
          const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
            default: { resolved: string };
          };

          assertStringIncludes(
            module.default.resolved,
            "/import-only-config-dependency/import.js",
          );

          const failureResult = await bundleProjectConfigSourceForImport(
            'let failure; try { import.meta.resolve("invalid-config-resolver"); } ' +
              "catch (error) { failure = { message: error.message, code: error.code }; }\n" +
              "export default { failure };",
            `${projectDir}/veryfront.config.ts`,
          );
          const failureModule = await import(
            `data:application/javascript;base64,${btoa(failureResult)}`
          ) as { default: { failure: { message: string; code?: string } } };

          assert(!failureResult.includes("</script>"));
          assert(!failureResult.includes("\u2028"));
          assertEquals(failureModule.default.failure, {
            message: resolverFailureMessage,
            code: undefined,
          });

          const restore = replacePropertyForTest(JSON, "stringify", {
            value: () => {
              throw new Error("poisoned JSON.stringify");
            },
          });
          let primordialResult: string;
          try {
            primordialResult = await bundleProjectConfigSourceForImport(
              'export default { resolved: import.meta.resolve("./asset.ts") };',
              `${projectDir}/veryfront.config.ts`,
            );
          } finally {
            restore();
          }
          const primordialModule = await import(
            `data:application/javascript;base64,${btoa(primordialResult)}`
          ) as { default: { resolved: string } };
          assertEquals(
            primordialModule.default.resolved,
            toFileUrl(`${projectDir}/asset.ts`).href,
          );
        }, { prefix: "vf-config-custom-resolve-conditions-" });
      } finally {
        unregisterExtensionContract("Bundler");
        registerExtensionContract("Bundler", previousBundler);
      }
    });

    it("uses ESM import conditions for config import resolver fallbacks", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/fallback-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "fallback-config-dependency",
            type: "module",
            exports: {
              ".": {
                require: "./require.cjs",
                import: "./import.js",
              },
            },
          }),
        );
        await writeTextFile(`${dependencyDir}/require.cjs`, 'module.exports = "require";\n');
        await writeTextFile(`${dependencyDir}/import.js`, 'export default "import";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "fallback-config-dependency";\nexport default { value };',
          `${projectDir}/veryfront.config.ts`,
        );

        assertStringIncludes(
          rewritten,
          "/fallback-config-dependency/import.js",
          "config fallback resolution must follow ESM import conditions",
        );
      }, { prefix: "vf-config-fallback-resolve-conditions-" });
    });

    it("resolves local modules for config import resolver fallbacks", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(`${projectDir}/local.js`, 'export default "local";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "./local.js";\n' +
            'import { readFile } from "fs/promises";\n' +
            "export default { value, readFile };",
          `${projectDir}/veryfront.config.ts`,
        );

        assertStringIncludes(
          rewritten,
          "/local.js",
          "config fallback resolution must stay bound to the original project",
        );
        assertStringIncludes(
          rewritten,
          'from "node:fs/promises"',
          "config fallback resolution must preserve Node built-in imports",
        );
      }, { prefix: "vf-config-fallback-resolve-local-" });
    });

    it("resolves package export patterns for config import resolver fallbacks", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/fallback-pattern-config-dependency`;
        await mkdir(`${dependencyDir}/src/features`, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "fallback-pattern-config-dependency",
            type: "module",
            exports: { "./features/*": "./src/features/*.js" },
          }),
        );
        await writeTextFile(
          `${dependencyDir}/src/features/value.js`,
          'export default "pattern";\n',
        );

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "fallback-pattern-config-dependency/features/value";\n' +
            "export default { value };",
          `${projectDir}/veryfront.config.ts`,
        );

        assertStringIncludes(
          rewritten,
          "/fallback-pattern-config-dependency/src/features/value.js",
          "config fallback resolution must support package export patterns",
        );
      }, { prefix: "vf-config-fallback-resolve-pattern-" });
    });

    it("rejects package export symlink escapes in resolver fallbacks", async () => {
      await withTempDir(async (projectDir) => {
        await withTempDir(async (outsideDir) => {
          const dependencyDir = `${projectDir}/node_modules/fallback-symlink-config-dependency`;
          await mkdir(dependencyDir, { recursive: true });
          await writeTextFile(
            `${dependencyDir}/package.json`,
            JSON.stringify({
              name: "fallback-symlink-config-dependency",
              type: "module",
              exports: "./linked.js",
            }),
          );
          await writeTextFile(`${outsideDir}/outside.js`, 'export default "outside";\n');
          await symlink(`${outsideDir}/outside.js`, `${dependencyDir}/linked.js`);

          await assertRejects(
            () =>
              rewriteProjectConfigImportsFromProject(
                'import value from "fallback-symlink-config-dependency";\n' +
                  "export default { value };",
                `${projectDir}/veryfront.config.ts`,
              ),
            Error,
            "Config package resolution escaped its package",
          );
        }, { prefix: "vf-config-fallback-symlink-outside-" });
      }, { prefix: "vf-config-fallback-symlink-project-" });
    });

    it("resolves config package entries without loading their dependency graph", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/fallback-shallow-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "fallback-shallow-config-dependency",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(
          `${dependencyDir}/index.js`,
          'import "missing-transitive-dependency";\nexport default "entry";\n',
        );

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "fallback-shallow-config-dependency";\nexport default { value };',
          `${projectDir}/veryfront.config.ts`,
        );

        assertStringIncludes(
          rewritten,
          "/fallback-shallow-config-dependency/index.js",
          "config fallback resolution must stop after resolving the package entry",
        );
      }, { prefix: "vf-config-fallback-resolve-shallow-" });
    });

    it("resolves bare legacy package main entries for config import resolver fallbacks", async () => {
      await withTempDir(async (projectDir) => {
        const dependencyDir = `${projectDir}/node_modules/fallback-legacy-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "fallback-legacy-config-dependency",
            type: "module",
            main: "index.js",
          }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, 'export default "legacy";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "fallback-legacy-config-dependency";\nexport default { value };',
          `${projectDir}/veryfront.config.ts`,
        );

        assertStringIncludes(
          rewritten,
          "/fallback-legacy-config-dependency/index.js",
          "config fallback resolution must accept bare legacy package main entries",
        );
      }, { prefix: "vf-config-fallback-resolve-legacy-main-" });
    });

    it("resolves legacy package main entries while bundling configs", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const dependencyDir = `${projectDir}/node_modules/legacy-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "legacy-config-dependency",
            type: "module",
            main: "index.js",
          }),
        );
        await writeTextFile(`${dependencyDir}/index.js`, 'export default "legacy main";\n');

        const result = await bundleProjectConfigSourceForImport(
          'import value from "legacy-config-dependency";\nexport default { value };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(module.default.value, "legacy main");
      }, { prefix: "vf-config-legacy-main-" });
    });

    it("preserves native Node ESM export conditions while resolving packages", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const dependencyDir = `${projectDir}/node_modules/conditional-config-dependency`;
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "conditional-config-dependency",
            type: "module",
            exports: {
              ".": {
                module: "./bundler.js",
                import: "./import.js",
              },
            },
          }),
        );
        await writeTextFile(`${dependencyDir}/bundler.js`, 'export default "bundler";\n');
        await writeTextFile(`${dependencyDir}/import.js`, 'export default "node import";\n');

        const result = await bundleProjectConfigSourceForImport(
          'import value from "conditional-config-dependency";\nexport default { value };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(module.default.value, "node import");
        assertStringIncludes(result, "/conditional-config-dependency/import.js");
      }, { prefix: "vf-config-node-conditions-" });
    });

    it("declares native Node ESM package resolution to every config bundler", async () => {
      const previousBundler = tryResolveExtensionContract<Bundler>("Bundler");
      if (!previousBundler) throw new Error("Expected the default bundler to be registered");
      let observedConditions: unknown;
      let observedMainFields: unknown;
      const observingBundler: Bundler = {
        bundle(options) {
          observedConditions = options.conditions;
          observedMainFields = options.mainFields;
          return previousBundler.bundle(options);
        },
        transform(options) {
          return previousBundler.transform(options);
        },
      };

      unregisterExtensionContract("Bundler");
      registerExtensionContract("Bundler", observingBundler);
      try {
        await withTempDir(
          (projectDir) =>
            bundleProjectConfigSourceForImport(
              "export default {};",
              `${projectDir}/veryfront.config.ts`,
            ),
          { prefix: "vf-config-node-resolution-options-" },
        );
        assertEquals(observedConditions, ["node", "node-addons"]);
        assertEquals(observedMainFields, ["main"]);
      } finally {
        unregisterExtensionContract("Bundler");
        registerExtensionContract("Bundler", previousBundler);
      }
    });

    it("adds user-supplied Node export conditions to config bundlers", () => {
      assertEquals(
        __getNodeConfigPackageConditionsForTests(
          ["--conditions=development", "-C", "testing", "--conditions", "development"],
          '--conditions="feature flag" -C=ignored -Cignored',
        ),
        ["node", "import", "node-addons", "feature flag", "development", "testing"],
      );
      assertEquals(
        __getNodeConfigBundleConditionsForTests(
          ["--conditions=import", "--conditions=development"],
          undefined,
        ),
        ["node", "node-addons", "import", "development"],
      );
    });

    it("matches Node option backslash parsing for export conditions", () => {
      assertEquals(
        __getNodeConfigPackageConditionsForTests(
          [],
          String.raw`--conditions=a\b --conditions='c\d' --conditions="e\f"`,
        ),
        ["node", "import", "node-addons", String.raw`a\b`, String.raw`c\d`, "ef"],
      );
    });

    it("matches Node's option precedence for the node-addons condition", () => {
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--no-addons"], undefined),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--no-addons=true"], undefined),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--no-addons=false"], undefined),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--addons=false"], undefined),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--addons=true"], undefined),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], "--trace-warnings --no-addons"),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], '"--no-addons"'),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], "--conditions=--no-addons"),
        ["node", "import", "node-addons", "--no-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--addons"], "--no-addons"),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--no-addons"], "--addons"),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(["--no-addons", "--addons"], undefined),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], "--no-addons=false --addons=false"),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests([], "--addons=false --no-addons=false"),
        ["node", "import"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(
          ["--addons=false"],
          "--no-addons=false",
        ),
        ["node", "import", "node-addons"],
      );
      assertEquals(
        __getNodeConfigPackageConditionsForTests(
          ["--conditions=development"],
          undefined,
          "require",
        ),
        ["node", "require", "node-addons", "development"],
      );
    });

    it("bundles TypeScript exported by a linked workspace package", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/app`;
        const dependencyDir = `${workspaceDir}/packages/workspace-config-dependency`;
        const linkedDependencyDir = `${projectDir}/node_modules/workspace-config-dependency`;
        const dependencyPath = `${dependencyDir}/index.ts`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(`${projectDir}/node_modules`, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "workspace-config-dependency",
            type: "module",
            exports: "./index.ts",
          }),
        );
        await writeTextFile(
          dependencyPath,
          'export { value } from "./value.ts";\n',
        );
        await writeTextFile(
          `${dependencyDir}/value.ts`,
          'export const value: string = "workspace TypeScript";\n',
        );
        await symlink(dependencyDir, linkedDependencyDir);

        const result = await bundleProjectConfigSourceForImport(
          'import { value } from "workspace-config-dependency";\nexport default { value };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(result.includes(toFileUrl(dependencyPath).href), false);
        assertStringIncludes(result, "workspace TypeScript");
        assertEquals(module.default.value, "workspace TypeScript");
      }, { prefix: "vf-config-linked-workspace-" });
    });

    it("bundles TypeScript imported by a linked workspace JavaScript entry", async () => {
      await withTempDir(async (workspaceDir) => {
        const projectDir = `${workspaceDir}/app`;
        const dependencyDir = `${workspaceDir}/packages/workspace-config-dependency`;
        const linkedDependencyDir = `${projectDir}/node_modules/workspace-config-dependency`;
        const dependencyPath = `${dependencyDir}/index.js`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(`${projectDir}/node_modules`, { recursive: true });
        await mkdir(dependencyDir, { recursive: true });
        await writeTextFile(
          `${dependencyDir}/package.json`,
          JSON.stringify({
            name: "workspace-config-dependency",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(
          dependencyPath,
          'export { value } from "./value.ts";\n',
        );
        await writeTextFile(
          `${dependencyDir}/value.ts`,
          'export const value: string = "workspace JavaScript entry";\n',
        );
        await symlink(dependencyDir, linkedDependencyDir);

        const result = await bundleProjectConfigSourceForImport(
          'import { value } from "workspace-config-dependency";\nexport default { value };',
          configPath,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(result.includes(toFileUrl(dependencyPath).href), false);
        assertStringIncludes(result, "workspace JavaScript entry");
        assertEquals(module.default.value, "workspace JavaScript entry");
      }, { prefix: "vf-config-linked-workspace-js-entry-" });
    });

    it("defers package resolution to custom bundlers without plugin resolve support", async () => {
      const previousBundler = tryResolveExtensionContract<Bundler>("Bundler");
      let packageResolution: OnResolveResult | null | undefined | void;
      const customBundler: Bundler = {
        async bundle(options) {
          let onResolve:
            | ((
              args: OnResolveArgs,
            ) =>
              | OnResolveResult
              | null
              | undefined
              | void
              | Promise<OnResolveResult | null | undefined | void>)
            | undefined;
          const pluginBuild: BundlerPluginBuild = {
            onResolve(_options, callback) {
              onResolve = callback;
            },
            onLoad() {},
            onDispose() {},
          };
          for (const plugin of options.plugins ?? []) await plugin.setup(pluginBuild);
          if (!onResolve) throw new Error("Config resolver plugin was not registered");
          packageResolution = await onResolve({
            path: "custom-config-dependency",
            importer: "/project/veryfront.config.ts",
            namespace: "file",
            resolveDir: "/project",
            kind: "import-statement",
          });
          return {
            outputFiles: [{ path: "", contents: new Uint8Array(), text: "export default {};" }],
            warnings: [],
            errors: [],
          };
        },
        transform(options) {
          return Promise.resolve({ code: options.code, warnings: [] });
        },
      };

      unregisterExtensionContract("Bundler");
      registerExtensionContract("Bundler", customBundler);
      try {
        await withTempDir(
          (projectDir) =>
            bundleProjectConfigSourceForImport(
              "export default {};",
              `${projectDir}/veryfront.config.ts`,
            ),
          { prefix: "vf-config-custom-bundler-" },
        );
        assertEquals(
          packageResolution,
          undefined,
          "an optional resolver must not become mandatory for existing custom bundlers",
        );
      } finally {
        unregisterExtensionContract("Bundler");
        if (previousBundler) registerExtensionContract("Bundler", previousBundler);
      }
    });

    it("uses captured Set membership while resolving built-in config imports", async () => {
      const previousBundler = tryResolveExtensionContract<Bundler>("Bundler");
      let builtInResolution: OnResolveResult | null | undefined | void;
      const customBundler: Bundler = {
        async bundle(options) {
          let onResolve:
            | ((args: OnResolveArgs) =>
              | OnResolveResult
              | null
              | undefined
              | void
              | Promise<OnResolveResult | null | undefined | void>)
            | undefined;
          const pluginBuild: BundlerPluginBuild = {
            onResolve(_options, callback) {
              onResolve = callback;
            },
            onLoad() {},
            onDispose() {},
          };
          for (const plugin of options.plugins ?? []) await plugin.setup(pluginBuild);
          if (!onResolve) throw new Error("Config resolver plugin was not registered");
          builtInResolution = await onResolve({
            path: "path",
            importer: "/project/veryfront.config.ts",
            namespace: "file",
            resolveDir: "/project",
            kind: "import-statement",
          });
          return {
            outputFiles: [{ path: "", contents: new Uint8Array(), text: "export default {};" }],
            warnings: [],
            errors: [],
          };
        },
        transform(options) {
          return Promise.resolve({ code: options.code, warnings: [] });
        },
      };

      unregisterExtensionContract("Bundler");
      registerExtensionContract("Bundler", customBundler);
      const restore = replacePropertyForTest(Set.prototype, "has", {
        value: () => {
          throw new Error("project-controlled Set.prototype.has");
        },
      });
      try {
        await withTempDir(
          (projectDir) =>
            bundleProjectConfigSourceForImport(
              "export default {};",
              `${projectDir}/veryfront.config.ts`,
            ),
          { prefix: "vf-config-captured-set-has-" },
        );
        assertEquals(builtInResolution, { path: "node:path", external: true });
      } finally {
        restore();
        unregisterExtensionContract("Bundler");
        if (previousBundler) registerExtensionContract("Bundler", previousBundler);
      }
    });

    it("preserves module-relative computed dynamic imports in JavaScript configs", async () => {
      await withTempDir(async (projectDir) => {
        await writeTextFile(
          `${projectDir}/config-helper.mjs`,
          'export const value = "computed JavaScript import";\n',
        );
        const result = await bundleProjectConfigSourceForImport(
          'const selected = "./config-helper.mjs";\n' +
            "const loaded = await import(selected);\n" +
            "export default { value: loaded.value };",
          `${projectDir}/veryfront.config.mjs`,
        );
        const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
          default: { value: string };
        };

        assertEquals(module.default.value, "computed JavaScript import");
      }, { prefix: "vf-config-computed-js-import-" });
    });

    it("rejects computed dynamic imports instead of rebasing them to the staging directory", async () => {
      await withTempDir(async (projectDir) => {
        await assertRejects(
          () =>
            bundleProjectConfigSourceForImport(
              "const selected = globalThis.CONFIG_MODULE; export default await import(selected);",
              `${projectDir}/veryfront.config.ts`,
            ),
          TypeError,
          "must use a static specifier",
        );
      }, { prefix: "vf-config-computed-import-" });
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
      assert(
        rewritten.includes("data:text/javascript;base64,"),
        "specifier must point at the shim",
      );
    });

    it("handles single quotes and leaves other specifiers untouched", async () => {
      const rewritten = await rewriteBareVeryfrontConfigImports(
        "import { defineConfig } from 'veryfront';\nimport other from './local.ts';\nimport 'veryfront';",
      );

      assert(!rewritten.includes("'veryfront'"));
      assert(rewritten.includes("./local.ts"), "relative imports must stay untouched");
    });

    it("rewrites a dynamic bare veryfront import to the config shim", async () => {
      const restore = replacePropertyForTest(JSON, "stringify", {
        value: () => {
          throw new Error("poisoned JSON.stringify");
        },
      });
      let rewritten: string;
      try {
        rewritten = await rewriteBareVeryfrontConfigImports(
          'const { defineConfig } = await import("veryfront");\nexport default defineConfig({});',
        );
      } finally {
        restore();
      }

      assertEquals(rewritten.includes('import("veryfront")'), false);
      assertStringIncludes(rewritten, 'import("data:text/javascript;base64,');
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

    it("rewrites staged imports through the original project resolver", async () => {
      const resolved: string[] = [];
      const rewritten = await rewriteProjectConfigImports(
        'import dependency from "config-stage-dependency";\n' +
          'import local from "./local.js";\n' +
          'import { defineConfig } from "veryfront";\n' +
          "export default defineConfig({ dependency, local });\n",
        (specifier) => {
          resolved.push(specifier);
          return specifier === "config-stage-dependency"
            ? "file:///project/node_modules/config-stage-dependency/index.js"
            : "file:///project/local.js";
        },
      );

      assertEquals(resolved, ["./local.js", "config-stage-dependency"]);
      assertStringIncludes(
        rewritten,
        'from "file:///project/node_modules/config-stage-dependency/index.js"',
      );
      assertStringIncludes(rewritten, 'from "file:///project/local.js"');
      assertEquals(rewritten.includes('from "veryfront"'), false);
    });

    it("resolves relative staged imports with URL suffixes", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(`${projectDir}/helper.ts`, 'export default "helper";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import query from "./helper.ts?mode=config";\n' +
            'import fragment from "./helper.ts#entry";\n' +
            "export default { query, fragment };\n",
          configPath,
        );

        assertStringIncludes(rewritten, "/helper.ts?mode=config");
        assertStringIncludes(rewritten, "/helper.ts#entry");
      }, { prefix: "vf-config-relative-suffix-" });
    });

    it("does not reject a staged config for a disabled optional import", async () => {
      const source = 'if (false) await import("optional-plugin");\nexport default {};\n';
      const rewritten = await rewriteProjectConfigImports(source, () => {
        throw new Error("optional-plugin is not installed");
      });

      assertEquals(rewritten, source);
    });

    it("binds unresolved staged dynamic imports to the original project", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const source = 'export default async () => await import("missing-config-plugin");\n';
        const rewritten = await rewriteProjectConfigImportsFromProject(source, configPath);

        assertEquals(rewritten.includes('import("missing-config-plugin")'), false);
        assertStringIncludes(rewritten, "data:text/javascript,");
        assertStringIncludes(rewritten, "missing-config-plugin");
      }, { prefix: "vf-config-bound-dynamic-import-" });
    });

    it("fails an executed unresolved dynamic import without using the temp module root", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const source = 'await import("missing-config-plugin");\nexport default {};\n';
        const rewritten = await rewriteProjectConfigImportsFromProject(source, configPath);

        const error = await assertRejects(() =>
          import(`data:application/javascript;base64,${btoa(rewritten)}`)
        );
        assertInstanceOf(error, Error);
        assertStringIncludes(error.message, 'Cannot find package "missing-config-plugin"');
        assertEquals(error.message.includes(projectDir), false);
      }, { prefix: "vf-config-executed-bound-dynamic-import-" });
    });

    it("keeps resolved staged dynamic imports syntactically lazy", async () => {
      const rewritten = await rewriteProjectConfigImports(
        'export default async () => import("installed-plugin");\n',
        () => "file:///project/node_modules/installed-plugin/index.js",
      );

      assertEquals(
        rewritten,
        'export default async () => import("file:///project/node_modules/installed-plugin/index.js");\n',
      );
    });

    it("wraps literal dynamic imports so deferred execution refreshes tracking", async () => {
      const rewritten = await __rewriteComputedDynamicProjectConfigImportsForTests(
        'export const load = () => import("file:///project/config-child.cjs");\n',
        "__observeConfigImport",
      );

      assertStringIncludes(
        rewritten,
        'import __observeConfigImport from "data:text/javascript,',
      );
      assertStringIncludes(
        rewritten,
        '__observeConfigImport.settle(import(__observeConfigImport.resolve("file:///project/config-child.cjs")))',
      );
    });

    it("uses ESM import conditions for staged project package imports", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-dual-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-dual-package",
            type: "module",
            exports: {
              ".": {
                import: "./import.js",
                require: "./require.js",
              },
              "./features/*": [
                { browser: "./browser/*.js" },
                {
                  node: {
                    import: "./features/*.js",
                    require: "./require-features/*.js",
                  },
                },
              ],
            },
          }),
        );
        await writeTextFile(`${packageDir}/import.js`, 'export default "import";\n');
        await writeTextFile(`${packageDir}/require.js`, 'module.exports = "require";\n');
        await mkdir(`${packageDir}/features`, { recursive: true });
        await mkdir(`${packageDir}/require-features`, { recursive: true });
        await writeTextFile(
          `${packageDir}/features/marker.js`,
          'export default "import-feature";\n',
        );
        await writeTextFile(
          `${packageDir}/require-features/marker.js`,
          'module.exports = "require-feature";\n',
        );

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import marker from "config-dual-package";\n' +
            'import feature from "config-dual-package/features/marker";\n' +
            "export default { title: `${marker}:${feature}` };\n",
          configPath,
        );

        assertStringIncludes(rewritten, "/config-dual-package/import.js");
        assertStringIncludes(rewritten, "/config-dual-package/features/marker.js");
        assertEquals(rewritten.includes("/config-dual-package/require.js"), false);
        assertEquals(rewritten.includes("/require-features/marker.js"), false);
      }, { prefix: "vf-config-esm-conditions-" });
    });

    it("uses ESM conditions for project package import aliases", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#config": { import: "./import.js", require: "./require.cjs" },
            },
          }),
        );
        await writeTextFile(`${projectDir}/import.js`, 'export default "import";\n');
        await writeTextFile(`${projectDir}/require.cjs`, 'module.exports = "require";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "#config";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/import.js");
        assertEquals(rewritten.includes("/require.cjs"), false);
      }, { prefix: "vf-config-import-alias-" });
    });

    it("rejects invalid slash-prefixed project package import names", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "module", imports: { "#valid": "./import.js" } }),
        );

        for (const specifier of ["#", "#/", "#/nested"]) {
          await assertRejects(
            () =>
              rewriteProjectConfigImportsFromProject(
                `import value from ${JSON.stringify(specifier)};\nexport default value;\n`,
                configPath,
              ),
            TypeError,
            `Package import "${specifier}" is not a valid internal import name`,
          );
        }
      }, { prefix: "vf-config-invalid-import-alias-" });
    });

    it("resolves external package targets from project import aliases", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-external-alias`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: { "#config": "config-external-alias" },
          }),
        );
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-external-alias",
            type: "module",
            exports: { import: "./import.js", require: "./require.cjs" },
          }),
        );
        await writeTextFile(`${packageDir}/import.js`, 'export default "import";\n');
        await writeTextFile(`${packageDir}/require.cjs`, 'module.exports = "require";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "#config";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/config-external-alias/import.js");
        assertEquals(rewritten.includes("/config-external-alias/require.cjs"), false);
      }, { prefix: "vf-config-external-import-alias-" });
    });

    it("prefers the most specific project import-alias pattern", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            type: "module",
            imports: {
              "#*x": "./less-specific.js",
              "#*xx": "./more-specific.js",
            },
          }),
        );
        await writeTextFile(`${projectDir}/less-specific.js`, "export default 'less';\n");
        await writeTextFile(`${projectDir}/more-specific.js`, "export default 'more';\n");

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "#axx";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/more-specific.js");
        assertEquals(rewritten.includes("/less-specific.js"), false);
      }, { prefix: "vf-config-specific-import-pattern-" });
    });

    it("uses ESM conditions for package self-references", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({
            name: "config-self-package",
            type: "module",
            exports: { import: "./import.js", require: "./require.cjs" },
          }),
        );
        await writeTextFile(`${projectDir}/import.js`, 'export default "import";\n');
        await writeTextFile(`${projectDir}/require.cjs`, 'module.exports = "require";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-self-package";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/import.js");
        assertEquals(rewritten.includes("/require.cjs"), false);
      }, { prefix: "vf-config-self-reference-" });
    });

    it("rejects forbidden package export path segments", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-forbidden-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(`${packageDir}/node_modules`, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-forbidden-package",
            exports: "./node_modules/entry.js",
          }),
        );
        await writeTextFile(`${packageDir}/node_modules/entry.js`, "export default {};\n");

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-forbidden-package";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          "contains a forbidden path segment",
        );
      }, { prefix: "vf-config-forbidden-export-" });
    });

    it("requires a nonempty capture for wildcard package exports", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-wildcard-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-wildcard-package",
            type: "module",
            exports: { "./feature*": "./index.js" },
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "feature";\n');

        // A nonempty capture still selects the pattern, even when the target
        // does not substitute it.
        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-wildcard-package/featurex";\nexport default value;\n',
          configPath,
        );
        assertStringIncludes(rewritten, "/config-wildcard-package/index.js");

        // Native pattern matching never lets "./feature*" match "./feature".
        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-wildcard-package/feature";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Package import "config-wildcard-package/feature" is not exported',
        );
      }, { prefix: "vf-config-empty-wildcard-" });
    });

    it("rejects forbidden wildcard captures before resolving package exports", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-capture-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(`${packageDir}/assets`, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-capture-package",
            type: "module",
            exports: { "./assets/*": "./index.js" },
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "assets";\n');

        for (const subpath of ["inner//gap", "inner/"]) {
          const rewritten = await rewriteProjectConfigImportsFromProject(
            `import value from ${
              JSON.stringify(`config-capture-package/assets/${subpath}`)
            };\nexport default value;\n`,
            configPath,
          );
          assertStringIncludes(rewritten, "/config-capture-package/index.js");
        }

        for (const subpath of ["node_modules", "..", "%2E%2E"]) {
          await assertRejects(
            () =>
              rewriteProjectConfigImportsFromProject(
                `import value from ${
                  JSON.stringify(`config-capture-package/assets/${subpath}`)
                };\nexport default value;\n`,
                configPath,
              ),
            TypeError,
            "path segment",
          );
        }
      }, { prefix: "vf-config-forbidden-capture-" });
    });

    it("rejects dot-prefixed bare package names", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/.plugin`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: ".plugin",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "dot";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from ".plugin";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Package import ".plugin" is not a valid package specifier',
        );
      }, { prefix: "vf-config-dot-package-" });
    });

    it("rejects URL delimiters in bare package names", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        for (const specifier of ["config-package?variant", "config-package#variant"]) {
          const packageDir = `${projectDir}/node_modules/${specifier}`;
          await mkdir(packageDir, { recursive: true });
          await writeTextFile(
            `${packageDir}/package.json`,
            JSON.stringify({ name: specifier, type: "module", exports: "./index.js" }),
          );
          await writeTextFile(`${packageDir}/index.js`, 'export default "shadow";\n');

          await assertRejects(
            () =>
              rewriteProjectConfigImportsFromProject(
                `import value from ${JSON.stringify(specifier)};\nexport default value;\n`,
                configPath,
              ),
            TypeError,
            `Package import "${specifier}" is not a valid package specifier`,
          );
        }
      }, { prefix: "vf-config-package-url-delimiter-" });
    });

    it("leaves relative imports to the project resolver when the project defines exports", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        await mkdir(configDirectory, { recursive: true });
        await writeTextFile(
          `${configDirectory}/package.json`,
          JSON.stringify({ name: "config-project", exports: "./index.js" }),
        );
        await writeTextFile(`${projectDir}/shared.js`, 'export default "shared";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import shared from "../shared.js";\nexport default { title: shared };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/shared.js");
      }, { prefix: "vf-config-relative-import-" });
    });

    it("continues through unusable package export array entries", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-array-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-array-package",
            type: "module",
            exports: [null, "invalid-target", "./node_modules/bad.js", "./index.js"],
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "array";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-array-package";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/config-array-package/index.js");
      }, { prefix: "vf-config-export-array-" });
    });

    it("continues past invalid active conditional targets in export arrays", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-array-target-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-array-target-package",
            type: "module",
            exports: [{ import: 42 }, "./index.js"],
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "array-target";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-array-target-package";\nexport default value;\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/config-array-target-package/index.js");
      }, { prefix: "vf-config-export-array-invalid-target-" });
    });

    it("gives bare Node built-ins precedence over shadow packages", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/fs`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "fs", exports: "./shadow.js" }),
        );
        await writeTextFile(`${packageDir}/shadow.js`, "export default 'shadow';\n");

        const source = 'import fs from "fs";\nexport default { title: String(fs) };\n';
        const rewritten = await rewriteProjectConfigImportsFromProject(source, configPath);

        assertEquals(rewritten, source);
        assertEquals(rewritten.includes("/node_modules/fs/shadow.js"), false);
      }, { prefix: "vf-config-builtin-precedence-" });
    });

    it("does not fall back to require-only package exports", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-require-only`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-require-only",
            exports: { require: "./require.cjs" },
          }),
        );
        await writeTextFile(`${packageDir}/require.cjs`, "module.exports = 'require';\n");

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-require-only";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Package import "config-require-only" is not exported',
        );
      }, { prefix: "vf-config-require-only-export-" });
    });

    it("rejects numeric conditional export keys as invalid package configuration", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-numeric-condition`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-numeric-condition",
            type: "module",
            exports: { ".": { "0": "./bad.js", default: "./good.js" } },
          }),
        );
        await writeTextFile(`${packageDir}/good.js`, 'export default "good";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-numeric-condition";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          "Package export conditions cannot contain numeric property keys",
        );
      }, { prefix: "vf-config-numeric-condition-" });
    });

    it("preserves invalid package configuration inside export arrays", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-array-condition`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-array-condition",
            type: "module",
            exports: [{ "0": "./bad.js", default: "./bad.js" }, "./good.js"],
          }),
        );
        await writeTextFile(`${packageDir}/good.js`, 'export default "good";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-array-condition";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          "Package export conditions cannot contain numeric property keys",
        );
      }, { prefix: "vf-config-array-condition-" });
    });

    it("rejects invalid active conditional export targets", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-invalid-condition`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-invalid-condition",
            type: "module",
            exports: { import: 42, default: "./good.js" },
          }),
        );
        await writeTextFile(`${packageDir}/good.js`, 'export default "good";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "config-invalid-condition";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          "Package export target is invalid",
        );
      }, { prefix: "vf-config-invalid-condition-target-" });
    });

    it("preserves query and fragment suffixes in package export targets", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-suffixed-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-suffixed-package",
            type: "module",
            exports: "./index.js?mode=config#entry",
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "suffix";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-suffixed-package";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/config-suffixed-package/index.js?mode=config#entry");
        assertEquals(rewritten.includes("index.js%3Fmode=config"), false);
      }, { prefix: "vf-config-export-suffix-" });
    });

    it("uses the captured URL href getter for package export targets", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-href-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-href-package",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "href";\n');

        const restoreHref = replacePropertyForTest(URL.prototype, "href", {
          get() {
            throw new Error("project-controlled URL href getter");
          },
        });
        try {
          const rewritten = await rewriteProjectConfigImportsFromProject(
            'import value from "config-href-package";\nexport default value;\n',
            configPath,
          );
          assertStringIncludes(rewritten, "/config-href-package/index.js");
        } finally {
          restoreHref();
        }
      }, { prefix: "vf-config-captured-href-" });
    });

    it("uses captured URL accessors for package export containment", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-url-accessor-package`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-url-accessor-package",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "accessors";\n');

        const restores = ["protocol", "hostname", "pathname"].map((key) =>
          replacePropertyForTest(URL.prototype, key, {
            get() {
              throw new Error(`project-controlled URL ${key} getter`);
            },
          })
        );
        try {
          const rewritten = await rewriteProjectConfigImportsFromProject(
            'import value from "config-url-accessor-package";\nexport default value;\n',
            configPath,
          );
          assertStringIncludes(rewritten, "/config-url-accessor-package/index.js");
        } finally {
          for (let index = restores.length - 1; index >= 0; index--) restores[index]!();
        }
      }, { prefix: "vf-config-captured-url-accessors-" });
    });

    it("rejects a non-object nearest package manifest", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        await mkdir(configDirectory, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ imports: { "#config": "./ancestor.js" } }),
        );
        await writeTextFile(`${configDirectory}/package.json`, "null\n");
        await writeTextFile(`${projectDir}/ancestor.js`, 'export default "ancestor";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "#config";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          "Package manifest must contain a JSON object",
        );
      }, { prefix: "vf-config-non-object-manifest-" });
    });

    it("rejects dot-relative package import targets", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        await mkdir(configDirectory, { recursive: true });
        await writeTextFile(
          `${configDirectory}/package.json`,
          JSON.stringify({ type: "module", imports: { "#config": "../outside.js" } }),
        );
        await writeTextFile(`${projectDir}/outside.js`, 'export default "outside";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "#config";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Package import "#config" is not exported',
        );
      }, { prefix: "vf-config-dot-relative-import-target-" });
    });

    it("rejects encoded separators in bare package specifiers", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/p%2Fq`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "p%2Fq", type: "module", exports: "./index.js" }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "encoded";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "p%2Fq";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Package import "p%2Fq" is not a valid package specifier',
        );
      }, { prefix: "vf-config-encoded-separator-" });
    });

    it("rejects scheme-shaped imports before project package lookup", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/p:q`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "p:q", type: "module", exports: "./index.js" }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "package";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              'import value from "p:q";\nexport default value;\n',
              configPath,
            ),
          TypeError,
          'Config import "p:q" uses an unsupported URL scheme',
        );
      }, { prefix: "vf-config-scheme-shaped-import-" });
    });

    it("resolves external import-map targets from the declaring package scope", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        await mkdir(configDirectory, { recursive: true });
        await writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ type: "module", imports: { "#dep": "config-scope-dep" } }),
        );
        const rootDependency = `${projectDir}/node_modules/config-scope-dep`;
        await mkdir(rootDependency, { recursive: true });
        await writeTextFile(
          `${rootDependency}/package.json`,
          JSON.stringify({
            name: "config-scope-dep",
            type: "module",
            exports: "./root.js",
          }),
        );
        await writeTextFile(`${rootDependency}/root.js`, 'export default "root";\n');
        const nestedDependency = `${configDirectory}/node_modules/config-scope-dep`;
        await mkdir(nestedDependency, { recursive: true });
        await writeTextFile(
          `${nestedDependency}/package.json`,
          JSON.stringify({
            name: "config-scope-dep",
            type: "module",
            exports: "./nested.js",
          }),
        );
        await writeTextFile(`${nestedDependency}/nested.js`, 'export default "nested";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "#dep";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/node_modules/config-scope-dep/root.js");
        assertEquals(rewritten.includes("/app/node_modules/config-scope-dep/"), false);
      }, { prefix: "vf-config-import-map-scope-" });
    });

    it("stops package lookup at the nearest installed directory", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        const nearerPackage = `${configDirectory}/node_modules/config-nearest-pkg`;
        const ancestorPackage = `${projectDir}/node_modules/config-nearest-pkg`;
        await mkdir(nearerPackage, { recursive: true });
        await mkdir(ancestorPackage, { recursive: true });
        // The nearer installation has no package.json: project resolution
        // stops there and uses its legacy entry point.
        await writeTextFile(`${nearerPackage}/index.js`, 'module.exports = "nearer";\n');
        await writeTextFile(
          `${ancestorPackage}/package.json`,
          JSON.stringify({
            name: "config-nearest-pkg",
            type: "module",
            exports: "./ancestor.js",
          }),
        );
        await writeTextFile(`${ancestorPackage}/ancestor.js`, 'export default "ancestor";\n');

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'import value from "config-nearest-pkg";\nexport default { title: value };\n',
          configPath,
        );

        assertStringIncludes(rewritten, "/app/node_modules/config-nearest-pkg/index.js");
        assertEquals(rewritten.includes("/ancestor.js"), false);
      }, { prefix: "vf-config-nearest-install-" });
    });

    it("does not bypass an unusable nearest manifestless package", async () => {
      await withTempDir(async (projectDir) => {
        const configDirectory = `${projectDir}/app`;
        const configPath = `${configDirectory}/veryfront.config.ts`;
        const packageName = "config-nearest-unusable";
        await mkdir(`${configDirectory}/node_modules/${packageName}`, { recursive: true });
        const ancestorPackage = `${projectDir}/node_modules/${packageName}`;
        await mkdir(ancestorPackage, { recursive: true });
        await writeTextFile(
          `${ancestorPackage}/package.json`,
          JSON.stringify({ name: packageName, type: "module", exports: "./ancestor.js" }),
        );
        await writeTextFile(`${ancestorPackage}/ancestor.js`, 'export default "ancestor";\n');

        await assertRejects(
          () =>
            rewriteProjectConfigImportsFromProject(
              `import value from "${packageName}";\nexport default value;\n`,
              configPath,
            ),
          Error,
          packageName,
        );
      }, { prefix: "vf-config-nearest-unusable-" });
    });

    it("preserves non-not-found dynamic import resolution failures", async () => {
      await withTempDir(async (projectDir) => {
        const packageDir = `${projectDir}/node_modules/config-require-only-dynamic`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-require-only-dynamic",
            exports: { require: "./require.cjs" },
          }),
        );
        await writeTextFile(`${packageDir}/require.cjs`, "module.exports = 'require';\n");

        const rewritten = await rewriteProjectConfigImportsFromProject(
          'await import("config-require-only-dynamic");\nexport default {};\n',
          configPath,
        );

        const error = await assertRejects(() =>
          import(`data:application/javascript;base64,${btoa(rewritten)}`)
        );
        assertInstanceOf(error, Error);
        assertStringIncludes(
          error.message,
          'Package import "config-require-only-dynamic" is not exported',
        );
        assertEquals(error.message.includes("Cannot find package"), false);
      }, { prefix: "vf-config-preserved-dynamic-failure-" });
    });
  });

  describe("Bun async config preflight", () => {
    it("distinguishes module-evaluation awaits from deferred awaits", async () => {
      assertEquals(
        await __bunConfigHasTopLevelAwaitForTests(
          "const value = await Promise.resolve(1); export default value;",
        ),
        true,
      );
      assertEquals(
        await __bunConfigHasTopLevelAwaitForTests(
          "const value = { [await Promise.resolve('key')]: true }; export default value;",
        ),
        true,
      );
      assertEquals(
        await __bunConfigHasTopLevelAwaitForTests(
          "async function deferred() { await Promise.resolve(); } export default deferred;",
        ),
        false,
      );
    });
  });

  describe("clearConfigCache", () => {
    it("should not throw when called on empty cache", () => {
      clearConfigCache();
    });

    it("evicts Bun project modules without ambient array iteration or Set.add", () => {
      const cacheKey = "/project/config-helper.js";
      const cache = TestObjectCreate(null) as Record<string, unknown>;
      cache[cacheKey] = { children: [] };
      const entry = {
        cache,
        keys: [cacheKey],
        projectDirectory: "/project",
      };
      const restoreIterator = replacePropertyForTest(
        Array.prototype,
        Symbol.iterator,
        {
          value: () => {
            throw new Error("ambient array iterator used");
          },
        },
      );
      const restoreSetAdd = replacePropertyForTest(Set.prototype, "add", {
        value: () => {
          throw new Error("ambient Set.add used");
        },
      });
      try {
        __evictBunProjectConfigModulesForTests(entry);
      } finally {
        restoreSetAdd();
        restoreIterator();
      }

      assertEquals(TestObjectGetOwnPropertyDescriptor(cache, cacheKey), undefined);
    });

    it("retains descendants of Bun config modules referenced by external modules", () => {
      const consumerKey = "/project/application-consumer.js";
      const entryKey = "/project/config-entry.js";
      const helperKey = "/project/config-helper.js";
      const disposableKey = "/project/config-disposable.js";
      const cache = TestObjectCreate(null) as Record<string, unknown>;
      cache[consumerKey] = {
        children: [{ filename: entryKey, id: entryKey }],
      };
      cache[entryKey] = {
        children: [{ filename: helperKey, id: helperKey }],
      };
      cache[helperKey] = { children: [] };
      cache[disposableKey] = { children: [] };

      __evictBunProjectConfigModulesForTests({
        cache,
        keys: [entryKey, helperKey, disposableKey],
        projectDirectory: "/project",
      });

      assert(TestObjectGetOwnPropertyDescriptor(cache, entryKey) !== undefined);
      assert(TestObjectGetOwnPropertyDescriptor(cache, helperKey) !== undefined);
      assertEquals(TestObjectGetOwnPropertyDescriptor(cache, disposableKey), undefined);
    });

    it("evicts Bun config modules despite unrelated post-load application modules", () => {
      const postLoadKey = "/project/unrelated-post-load.js";
      const helperKey = "/project/config-helper.js";
      const cache = TestObjectCreate(null) as Record<string, unknown>;
      cache[postLoadKey] = { children: [] };
      cache[helperKey] = { children: [] };

      __evictBunProjectConfigModulesForTests({
        cache,
        keys: [helperKey],
        projectDirectory: "/project",
      });

      // A project-local module that appeared after config evaluation, with no
      // observable edge into the tracked graph, must not pin stale config
      // helpers in require.cache across reloads.
      assertEquals(TestObjectGetOwnPropertyDescriptor(cache, helperKey), undefined);
      assert(TestObjectGetOwnPropertyDescriptor(cache, postLoadKey) !== undefined);
    });

    it("does not claim unrelated concurrent Bun modules as config dependencies", () => {
      const configEntryKey = "/project/config-entry.cjs";
      const configChildKey = "/project/config-child.cjs";
      const unrelatedKey = "/project/application-loaded-while-config-awaits.cjs";
      const cache = TestObjectCreate(null) as Record<string, unknown>;
      cache[configEntryKey] = {
        children: [{ filename: configChildKey, id: configChildKey }],
      };
      cache[configChildKey] = { children: [] };
      cache[unrelatedKey] = { children: [] };

      const entry = __collectBunProjectConfigModulesForTests({
        cache,
        eligibleKeys: new Set([configEntryKey]),
        projectDirectory: "/project",
        includeAllNewModules: true,
      });

      assertEquals(Array.from(entry.keys).sort(), [configChildKey, configEntryKey].sort());
    });

    it("retains config modules that post-load application modules reference", () => {
      const postLoadKey = "/project/consuming-post-load.js";
      const helperKey = "/project/config-helper.js";
      const disposableKey = "/project/config-disposable.js";
      const cache = TestObjectCreate(null) as Record<string, unknown>;
      cache[postLoadKey] = { children: [{ filename: helperKey, id: helperKey }] };
      cache[helperKey] = { children: [] };
      cache[disposableKey] = { children: [] };

      __evictBunProjectConfigModulesForTests({
        cache,
        keys: [helperKey, disposableKey],
        projectDirectory: "/project",
      });

      assert(TestObjectGetOwnPropertyDescriptor(cache, helperKey) !== undefined);
      assertEquals(TestObjectGetOwnPropertyDescriptor(cache, disposableKey), undefined);
    });

    it("retains accessor-backed Bun modules referenced through a proxied cache", () => {
      // Bun's require cache serves entries through gets while reporting
      // undefined own-descriptor values, and its Module objects expose
      // children/filename/id through prototype accessors.
      class AccessorModule {
        #filename: string;
        #children: AccessorModule[];
        constructor(filename: string, children: AccessorModule[]) {
          this.#filename = filename;
          this.#children = children;
        }
        get filename(): string {
          return this.#filename;
        }
        get id(): string {
          return this.#filename;
        }
        get children(): AccessorModule[] {
          return this.#children;
        }
      }
      const consumerKey = "/project/application-consumer.cjs";
      const helperKey = "/project/config-helper.cjs";
      const disposableKey = "/project/config-disposable.cjs";
      const backing = new Map<string, AccessorModule>();
      const helper = new AccessorModule(helperKey, []);
      backing.set(consumerKey, new AccessorModule(consumerKey, [helper]));
      backing.set(helperKey, helper);
      backing.set(disposableKey, new AccessorModule(disposableKey, []));
      const cache = new Proxy(TestObjectCreate(null) as Record<string, unknown>, {
        ownKeys: () => Array.from(backing.keys()),
        getOwnPropertyDescriptor: (_target, key) =>
          typeof key === "string" && backing.has(key)
            ? { value: undefined, writable: true, enumerable: true, configurable: true }
            : undefined,
        get: (_target, key) => typeof key === "string" ? backing.get(key) : undefined,
        deleteProperty: (_target, key) => {
          if (typeof key === "string") backing.delete(key);
          return true;
        },
      });

      __evictBunProjectConfigModulesForTests({
        cache,
        keys: [helperKey, disposableKey],
        projectDirectory: "/project",
      });

      assert(backing.has(helperKey));
      assertEquals(backing.has(disposableKey), false);
    });

    it("widens Bun module tracking only to declaring workspace members", () => {
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", [
          "packages/*",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/..member", ["*"]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app/nested", [
          "packages/*",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", {
          packages: ["packages/*"],
        }),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/apps/deep/site", [
          "apps/**",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/tools/cli", [
          "tools/cli",
        ]),
        true,
      );
      // The reported widening bug: a config under packages/ must not adopt a
      // root that only declares services/*.
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", [
          "services/*",
        ]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages", ["packages/*"]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo", ["packages/*"]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/outside", ["**"]),
        false,
      );
      // Negation patterns are ignored rather than trusted for widening.
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", [
          "!packages/app",
        ]),
        false,
      );
    });

    it("matches Bun workspace brace and character-class globs", () => {
      for (const member of ["app", "api"]) {
        assertEquals(
          __isBunWorkspaceMemberDirectoryForTests("/repo", `/repo/packages/${member}`, [
            "packages/{app,api}",
          ]),
          true,
        );
      }
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/web", [
          "packages/{app,api}",
        ]),
        false,
      );
      // An alternative may span a path separator.
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/tools/nested/lib", [
          "{packages/app,tools/nested/lib}",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", [
          "packages/[ab]*",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/web", [
          "packages/[ab]*",
        ]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/lib-c", [
          "packages/lib-[a-d]",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/lib-z", [
          "packages/lib-[a-d]",
        ]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/app", [
          "packages/[!x]*",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/xen", [
          "packages/[!x]*",
        ]),
        false,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/ab", [
          "packages/a?",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/abc", [
          "packages/a?",
        ]),
        false,
      );
      // Unmatched braces and brackets stay literal.
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/{app", [
          "packages/{app",
        ]),
        true,
      );
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/[a", [
          "packages/[a",
        ]),
        true,
      );

      const alternatives = Array.from({ length: 70 }, (_, index) => `p${index}`).join(",");
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", "/repo/packages/p69", [
          `packages/{${alternatives}}`,
        ]),
        true,
      );

      const deepSegments = Array.from({ length: 32 }, (_, index) => `s${index}`).join("/");
      const globstars = Array.from({ length: 32 }, () => "**").join("/");
      assertEquals(
        __isBunWorkspaceMemberDirectoryForTests("/repo", `/repo/${deepSegments}`, [
          `${globstars}/missing`,
        ]),
        false,
      );
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
      const projectDir = await makeTempDir({
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
      const dirA = await makeTempDir({ prefix: "vf-config-project-a-" });
      const dirB = await makeTempDir({ prefix: "vf-config-project-b-" });
      const sourceA = 'export default { title: "A" };';
      const sourceB = 'export default { title: "B" };';

      try {
        await Deno.writeTextFile(`${dirA}/veryfront.config.js`, sourceA);
        adapter.fs.files.set(`${dirA}/veryfront.config.js`, sourceA);
        await Deno.writeTextFile(`${dirB}/veryfront.config.js`, sourceB);
        adapter.fs.files.set(`${dirB}/veryfront.config.js`, sourceB);

        const configA = await getConfig(dirA, adapter);
        const configB = await getConfig(dirB, adapter);

        assertEquals(configA.title, "A", "project A keeps its own config");
        assertEquals(
          configB.title,
          "B",
          "project B must not read project A's cached config",
        );
        assertStrictEquals(
          getCachedConfigSync(dirA),
          configA,
          "the sync cache serves project A the config it loaded",
        );
        assertStrictEquals(
          getCachedConfigSync(dirB),
          configB,
          "the sync cache serves project B the config it loaded",
        );
      } finally {
        await Deno.remove(dirA, { recursive: true });
        await Deno.remove(dirB, { recursive: true });
      }
    });

    describe("trusted config single-flight", () => {
      it("executes one exact concurrent config module once and shares its identity", async () => {
        const adapter = setup();
        const projectDir = await makeTempDir({
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
        const projectDir = await makeTempDir({
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

      it("names why the config module failed, not just which file failed", async () => {
        // Reproduced against published 0.1.1232 in a `veryfront init --template
        // minimal` scaffold. A reader following the CSS-optimizer hint writes
        // the natural first guess, `import { defineConfig } from
        // "veryfront/config"` -- a subpath the package does not export. The
        // build reports:
        //
        //   ! Failed to load config file  configFile=veryfront.config.ts
        //   ✗ [config-parse-error] Failed to parse configuration
        //     Detail: Failed to load veryfront.config.ts
        //     Suggestion: Ensure your configuration file contains valid
        //                 JavaScript or TypeScript
        //
        // The runtime said exactly what was wrong -- "Package subpath './config'
        // is not defined by exports" -- and the loader dropped it, then advised
        // checking syntax that was never the problem. `cause` is attached but
        // nothing on the way to the terminal reads it, at any log level.
        const adapter = setup();
        const projectDir = await makeTempDir({
          prefix: "vf-config-load-cause-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        // Not the literal `veryfront/config` from the field report: this
        // repository's own deno.json maps that specifier to src/config/index.ts
        // for internal callers, so inside the test process it resolves. That
        // asymmetry is why the guess is natural in the first place -- the
        // subpath is real in the monorepo and absent from the package's exports
        // map. A specifier no map claims reproduces the same class of failure
        // and needs no network.
        const source = 'import { defineConfig } from "veryfront/not-an-export";\n' +
          "export default defineConfig({});\n";

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          const error = await assertRejects(
            () => getConfig(projectDir, adapter),
            VeryfrontError,
          ) as VeryfrontError;

          assert(
            error.message.includes("veryfront.config.js"),
            `error must still name the file, got: ${error.message}`,
          );
          // Both runtimes name the subpath rather than the joined specifier:
          // Deno says "Unknown export './not-an-export' for 'veryfront'", Node
          // says "Package subpath './config' is not defined by exports".
          assert(
            error.message.includes("not-an-export"),
            `error must name the subpath that failed to resolve, got: ${error.message}`,
          );
          assertEquals(error.message.includes(projectDir), false);
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      // veryfront-issue-inbox#787. A config whose imports do not resolve was
      // reported as `config-parse-error` with "Ensure your configuration file
      // contains valid JavaScript or TypeScript", for a file whose syntax was
      // fine -- the fix was `npm install`. The classification, suggestion, and
      // docs link all pointed at file validity.
      //
      // What separates the two is the shape of the specifier the resolver
      // names, not the error code: every runtime reports a missing relative
      // *file* through the same phrasing and the same ERR_MODULE_NOT_FOUND.
      // Each case below is one runtime's real wording, so a phrasing change in
      // any of them fails here rather than silently reverting the reader to the
      // syntax advice.
      /**
       * The `VeryfrontError` a config source fails to load with.
       *
       * The source is written to a real temp dir *and* seeded into the mock
       * adapter, so the failure comes from the runtime's own module resolver
       * rather than from a stubbed message -- which is what makes each row's
       * wording a real regression test.
       */
      async function loadFailure(prefix: string, source: string): Promise<VeryfrontError> {
        const adapter = setup();
        return await withTempDir(async (projectDir) => {
          const configPath = `${projectDir}/${CONFIG_FILE_NAME}`;
          await writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);
          return await assertRejects(
            () => getConfig(projectDir, adapter),
            VeryfrontError,
          ) as VeryfrontError;
        }, { prefix });
      }

      it("names the uninstalled package and drops the syntax advice", async () => {
        // Not the field report's own `@veryfront/ext-observability-opentelemetry`:
        // an uninstalled first-party extension is resolved through the contract
        // registry, which raises its own `missing-extension` error before the
        // import is attempted. An ordinary third-party package is what reaches
        // the module resolver, which is the path under test.
        const error = await loadFailure(
          "vf-config-missing-dep-",
          'import "some-uninstalled-telemetry-sdk";\nexport default {};\n',
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assert(
          error.message.includes("some-uninstalled-telemetry-sdk"),
          `error must name the unresolved package, got: ${error.message}`,
        );
        assert(
          error.message.includes(CONFIG_FILE_NAME),
          `error must still name the config file, got: ${error.message}`,
        );
        assert(
          !/valid JavaScript or TypeScript/i.test(
            `${error.message} ${error.suggestion ?? ""}`,
          ),
          "a missing dependency must not advise checking the file's syntax",
        );
      });

      it("does not claim a package is absent when only its subpath failed", async () => {
        // Node reports `require("installed-pkg/missing")` for an *installed*
        // package identically to one that is genuinely absent. Naming the
        // package root would tell the reader to install what they already have,
        // and the subpath -- the real fault -- is not installable at all. The
        // runtime's own message, which names the whole specifier, is the honest
        // answer here.
        const error = await loadFailure(
          "vf-config-subpath-",
          `throw new Error("Cannot find module 'installed-pkg/missing'\nRequire stack:\n- /app/veryfront.config.js");\n`,
        );

        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
      });

      it("classifies even when the config replaces a built-in it walks with", async () => {
        // A trusted config shares the host realm and can swap `globalThis.Set`
        // before throwing. The cause-chain cycle guard must not construct the
        // project's replacement, or the classification would be lost to that
        // constructor's exception.
        const originalSet = globalThis.Set;
        let error: VeryfrontError;
        try {
          error = await loadFailure(
            "vf-config-poisoned-set-",
            'globalThis.Set = function () { throw new Error("poisoned Set"); };\n' +
              `throw new Error("Cannot find package 'left-pad' imported from /app/veryfront.config.ts");\n`,
          );
        } finally {
          globalThis.Set = originalSet;
        }

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assert(
          error.message.includes("left-pad"),
          `error must still name the package, got: ${error.message}`,
        );
      });

      it("classifies an original error after the config replaces globalThis.Error", async () => {
        const originalError = globalThis.Error;
        let caught: unknown;
        try {
          const adapter = setup();
          await withTempDir(async (projectDir) => {
            const configPath = `${projectDir}/${CONFIG_FILE_NAME}`;
            const source =
              "const failure = new Error(\"Cannot find package 'left-pad' imported from /app/veryfront.config.ts\");\n" +
              "globalThis.Error = class ProjectError {};\n" +
              "throw failure;\n";
            await writeTextFile(configPath, source);
            adapter.fs.files.set(configPath, source);
            try {
              await getConfig(projectDir, adapter);
            } catch (error) {
              caught = error;
            }
          }, { prefix: "vf-config-poisoned-error-" });
        } finally {
          globalThis.Error = originalError;
        }

        assertInstanceOf(caught, VeryfrontError);
        const error = caught as VeryfrontError;
        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "left-pad");
      });

      it("contains a parse failure after the config replaces globalThis.Error", async () => {
        const originalError = globalThis.Error;
        let caught: unknown;
        try {
          const adapter = setup();
          await withTempDir(async (projectDir) => {
            const configPath = `${projectDir}/${CONFIG_FILE_NAME}`;
            const source = 'const failure = new Error("ordinary config failure");\n' +
              "globalThis.Error = {};\n" +
              "throw failure;\n";
            await writeTextFile(configPath, source);
            adapter.fs.files.set(configPath, source);
            try {
              await getConfig(projectDir, adapter);
            } catch (error) {
              caught = error;
            }
          }, { prefix: "vf-config-poisoned-error-fallback-" });
        } finally {
          globalThis.Error = originalError;
        }

        assertInstanceOf(caught, VeryfrontError);
        const error = caught as VeryfrontError;
        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        assertStringIncludes(error.message, "ordinary config failure");
      });

      it("contains a config that poisons RegExp Symbol.replace", async () => {
        const originalReplace = RegExp.prototype[Symbol.replace];
        for (
          const [message, expectedSlug] of [
            [
              "Cannot find package 'left-pad' imported from /app/veryfront.config.ts",
              DEPENDENCY_MISSING_SLUG,
            ],
            ["ordinary project failure", CONFIG_PARSE_ERROR_SLUG],
          ] as const
        ) {
          let error: VeryfrontError;
          try {
            error = await loadFailure(
              "vf-config-poisoned-regexp-replace-",
              `const failure = new Error(${JSON.stringify(message)});\n` +
                'RegExp.prototype[Symbol.replace] = function () { throw new Error("poisoned replace"); };\n' +
                "throw failure;\n",
            );
          } finally {
            RegExp.prototype[Symbol.replace] = originalReplace;
          }

          assertEquals(error.slug, expectedSlug);
        }
      });

      it("redacts machine paths while retaining the actionable package subpath", async () => {
        const error = await loadFailure(
          "vf-config-path-redaction-",
          `throw new Error("Package subpath './config' is not defined by exports in /home/example/project/node_modules/pkg/package.json imported from C:\\\\Users\\\\example\\\\project\\\\veryfront.config.ts");\n`,
        );

        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        assertStringIncludes(error.message, "./config");
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("/home/example"), false);
        assertEquals(error.message.includes("C:\\Users\\example"), false);
      });

      it("redacts a hosted config URL cleanly instead of mangling it into a path", async () => {
        const error = await loadFailure(
          "vf-config-url-redaction-",
          `throw new Error("Failed to fetch https://cdn.example.test/hosted/config.ts from /home/example/project/veryfront.config.ts");\n`,
        );

        // The drive-letter alternative matches the `s:/` inside `https:/`, so an
        // unguarded pass reported `http[path]` -- neither the URL nor an honest
        // redaction marker. AGENTS.md counts private hostnames among the values
        // user-facing output must not carry, so the URL is redacted whole rather
        // than preserved (veryfront-issue-inbox#836).
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("http[path]"), false);
        assertEquals(error.message.includes("cdn.example.test"), false);
        // The machine path on the same line is still redacted separately.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("/home/example"), false);
      });

      it("redacts a URL whose scheme is glued to preceding text", async () => {
        const error = await loadFailure(
          "vf-config-glued-url-",
          `throw new Error("Attempt 3https://registry.internal/config.ts failed");\n`,
        );

        // SCHEME_URL is unanchored on the left for this: with a left boundary
        // the glued scheme is not recognised as a URL, and the hostname survives
        // into a caller-visible detail.
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("registry.internal"), false);
      });

      it("redacts a URL with parenthesized userinfo without consuming trailing prose", async () => {
        const error = await loadFailure(
          "vf-config-parenthesized-userinfo-",
          `throw new Error("Fetch https://user(name):<TOKEN>@registry.internal/config.ts) failed");\n`,
        );

        assertStringIncludes(error.message, "Fetch [url]) failed");
        assertEquals(error.message.includes("user(name)"), false);
        assertEquals(error.message.includes("registry.internal"), false);
      });

      it("redacts a URL whose userinfo nests parentheses", async () => {
        const error = await loadFailure(
          "vf-config-nested-paren-userinfo-",
          `throw new Error("Fetch https://u((x))y@registry.internal/config.ts failed");\n`,
        );

        // The balanced-pair alternative matches one flat `(...)`, so a nested
        // userinfo ended the token at the first `(` and left the hostname behind.
        // RFC 3986 sub-delims include `(` and `)`, so this is a legal authority.
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("registry.internal"), false);
        assertEquals(error.message.includes("((x))"), false);
      });

      it("keeps a left boundary when a CSI introducer is glued to preceding text", async () => {
        const error = await loadFailure(
          "vf-config-csi-between-text-and-path-",
          `throw new Error("Failed at" + String.fromCharCode(27) + "[/home/alice/veryfront.config.ts");\n`,
        );

        // The introducer is replaced with a space, not removed. Removing it would
        // join `at` to `/home/alice`, and POSIX_ABSOLUTE_PATH's lookbehind refuses
        // a slash following an alphanumeric -- manufacturing the exact adjacency
        // that defeats the pass meant to catch it.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("alice"), false);
        assertEquals(error.message.includes("at/home"), false);
      });

      it("treats a drive letter with a doubled separator as a path, not a URL", async () => {
        const error = await loadFailure(
          "vf-config-drive-double-slash-",
          `throw new Error("Load " + String.fromCharCode(67) + "://Users/alice/veryfront.config.ts");\n`,
        );

        // Node normalises `C://Users/...` as an absolute drive path. A one-letter
        // scheme would claim it as a URL, which is the path-as-URL mislabel this
        // PR exists to remove; no registered scheme is a single character.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("alice"), false);
      });

      it("redacts a zero-slash special-scheme URL", async () => {
        const error = await loadFailure(
          "vf-config-zero-slash-scheme-",
          `throw new Error("Fetch https:registry.internal/config.ts failed");\n`,
        );

        // `https:host/x` parses to `https://host/x`, so the hostname is as real
        // as in the two-slash form. Both URL patterns above require a slash, and
        // POSIX_ABSOLUTE_PATH refuses `/config.ts` after an alphanumeric.
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("registry.internal"), false);
      });

      it("redacts a zero-slash URL and a file URL whatever the scheme's case", async () => {
        const upper = await loadFailure(
          "vf-config-uppercase-zero-slash-",
          `throw new Error("Fetch HTTPS:registry.internal/config.ts failed");\n`,
        );

        // A URL scheme is case-insensitive. The sibling patterns get that free
        // from `[A-Za-z]`; a literal scheme list does not.
        assertStringIncludes(upper.message, "[url]");
        assertEquals(upper.message.includes("registry.internal"), false);

        const fileUrl = await loadFailure(
          "vf-config-uppercase-file-url-",
          `throw new Error("Load FILE:///home/alice/veryfront.config.ts");\n`,
        );

        // Reported as a path, not a URL: an uppercase scheme previously fell
        // past FILE_URL_ABSOLUTE_PATH to SCHEME_URL and came back as `[url]`.
        assertStringIncludes(fileUrl.message, "[path]");
        assertEquals(fileUrl.message.includes("alice"), false);
      });

      it("does not treat a drive letter or ordinary prose as a zero-slash URL", async () => {
        const drive = await loadFailure(
          "vf-config-zero-slash-drive-",
          `throw new Error("Load " + String.fromCharCode(67) + ":/Users/alice/veryfront.config.ts");\n`,
        );

        assertStringIncludes(drive.message, "[path]");
        assertEquals(drive.message.includes("alice"), false);

        // The scheme list is closed for exactly this reason: a generic
        // `scheme:` shape would claim prose, and at one character, drive letters.
        const prose = await loadFailure(
          "vf-config-zero-slash-prose-",
          `throw new Error("warning:something happened");\n`,
        );

        assertStringIncludes(prose.message, "warning:something happened");

        // URL schemes are ASCII. With both `i` and `u` on the literal scheme
        // pattern, Unicode case folding made the long-s match ASCII `s` and
        // incorrectly redacted this ordinary diagnostic.
        const unicodeFold = await loadFailure(
          "vf-config-zero-slash-unicode-fold-",
          `throw new Error("The parser reported httpſ:failure code");\n`,
        );

        assertStringIncludes(unicodeFold.message, "httpſ:failure code");
      });

      it("redacts a URL whose userinfo contains an apostrophe", async () => {
        const error = await loadFailure(
          "vf-config-apostrophe-userinfo-",
          `throw new Error("Fetch https://user'name:<TOKEN>@registry.internal/config.ts failed");\n`,
        );

        // `'` is an RFC 3986 sub-delim, so this is a legal authority. The tail of
        // the token still stops at an apostrophe, which is what keeps quoted
        // config messages intact.
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("registry.internal"), false);
        assertEquals(error.message.includes("user'name"), false);
      });

      it("redacts a URL whose path nests parentheses", async () => {
        const error = await loadFailure(
          "vf-config-nested-paren-path-",
          `throw new Error("Fetch https://registry.internal/a((TOKENVALUE1234)) failed");\n`,
        );

        // The residue here is a URL path fragment, not decoration: whatever sat
        // inside the parentheses survived into the caller-visible detail.
        assertStringIncludes(error.message, "[url]");
        assertEquals(error.message.includes("TOKENVALUE1234"), false);
        assertEquals(error.message.includes("registry.internal"), false);
      });

      it("redacts a file URL whose path nests parentheses", async () => {
        const error = await loadFailure(
          "vf-config-nested-paren-file-url-",
          `throw new Error("Fetch file:///home/alice/a((TOKENVALUE1234)) failed");\n`,
        );

        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("TOKENVALUE1234"), false);
        assertEquals(error.message.includes("/home/alice"), false);
      });

      it("redacts a single-slash URL-like token without misclassifying Windows paths", async () => {
        const error = await loadFailure(
          "vf-config-single-slash-url-",
          `throw new Error("Fetch https:/registry.internal/config.ts beside C:/Users/alice/config.ts");\n`,
        );

        assertStringIncludes(error.message, "Fetch [url] beside [path]");
        assertEquals(error.message.includes("registry.internal"), false);
        assertEquals(error.message.includes("C:/Users"), false);
        assertEquals(error.message.includes("http[path]"), false);
      });

      it("redacts a machine path glued to the preceding diagnostic text", async () => {
        const error = await loadFailure(
          "vf-config-glued-path-",
          `throw new Error("Failed at" + String.fromCharCode(67) + ":\\\\Users\\\\alice\\\\veryfront.config.ts");\n`,
        );

        // A left boundary on WINDOWS_ABSOLUTE_PATH refuses this, and neither
        // SCHEME_URL nor MALFORMED_SCHEME_URL can claim a backslash form, so the
        // path would reach the caller.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("Users"), false);
        assertEquals(error.message.includes("alice"), false);
      });

      it("labels a glued double-separator drive path [url] -- a documented limit", async () => {
        const error = await loadFailure(
          "vf-config-glued-drive-scheme-",
          `throw new Error("Failed atC://Users/alice/veryfront.config.ts");\n`,
        );

        // Documented limit, decided on inbox#852. Glued prose turns the drive
        // letter into the legal three-character scheme `atC`, and that token is
        // structurally identical to `...s://host`: a drive-letter rescue rule
        // that relabels this [path] re-opens the http[path] regression #4236
        // fixed, and narrowing SCHEME_URL to known schemes would under-redact
        // real URLs. The label is cosmetic; the redaction is what matters, and
        // it holds -- nothing from the path survives.
        assertStringIncludes(error.message, "Failed [url]");
        assertEquals(error.message.includes("Users"), false);
        assertEquals(error.message.includes("alice"), false);
      });

      /**
       * Fastest of `runs` timed `loadFailure` calls, with the error it raised.
       *
       * A single timing is the wrong instrument here. `loadFailure` writes a temp
       * file and loads a module, which costs tens of milliseconds before any
       * redaction runs, while the backtracking these two tests exist to catch
       * costs about 16ms at 100k characters when it is bounded. The signal is
       * therefore smaller than the harness noise, and one scheduler hiccup on a
       * shared runner is enough to fail the ratio: this went red at
       * `probe 5450ms vs control 39ms` on a change measured to leave every
       * pattern's cost byte-identical.
       *
       * Noise only ever adds time, so the minimum of several runs is the closest
       * available estimate of the true cost. Unbounded backtracking is not
       * intermittent -- it is paid on every run -- so taking the minimum cannot
       * hide the thing being guarded against, which is what makes this safe
       * rather than a way of making a red test green.
       */
      async function fastestLoad(
        prefix: string,
        source: string,
        runs = 3,
      ): Promise<{ ms: number; error: VeryfrontError }> {
        const start = Date.now();
        let error = await loadFailure(prefix, source);
        let ms = Date.now() - start;
        for (let run = 1; run < runs; run += 1) {
          const runStart = Date.now();
          error = await loadFailure(prefix, source);
          ms = Math.min(ms, Date.now() - runStart);
        }

        return { ms, error };
      }

      it("summarizes a very long cause in time proportional to its length", async () => {
        // A wall-clock bound would couple this to runner speed, and a partial
        // reintroduction of backtracking that stayed under it would pass
        // silently. Instead time two inputs of the SAME length on the SAME
        // machine, differing only in whether the pathological retry can start:
        // digits cannot begin a scheme, letters can, so the ratio isolates the
        // backtracking cost from the harness overhead both inputs pay.
        //
        // That overhead is the same in expectation but NOT run to run, which is
        // why each side is the fastest of several runs -- see `fastestLoad`. A
        // single pair of timings failed here once at 5450ms vs 39ms on a change
        // measured to leave every pattern's cost unchanged.
        const size = 100000;

        const control = await fastestLoad(
          "vf-config-long-control-",
          `throw new Error("1".repeat(${size}));\n`,
        );
        const controlMs = Math.max(1, control.ms);
        const { ms: probeMs, error } = await fastestLoad(
          "vf-config-long-probe-",
          `throw new Error("a".repeat(${size}));\n`,
        );

        // Bounded, the two are within noise of each other. Unbounded, the probe
        // measured ~17.9s against an unchanged control.
        assertEquals(
          probeMs < controlMs * 20,
          true,
          `probe ${probeMs}ms vs control ${controlMs}ms`,
        );
        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
      });

      it("summarizes many failed URL starts in time proportional to length", async () => {
        // A different pathological shape from the long-alphabetic case above: here
        // every `a://` starts a URL match that then fails on `(`, and an unbounded
        // parenthesised interior rescans the rest of the message from each one.
        // Measured unbounded: 2.6s for 20k repeats, growing 4x per doubling.
        // Bounded: 47ms, growing 2x. Same control/probe ratio method -- a digit
        // cannot begin a scheme, so the control never starts a match at all.
        //
        // Two characters, not one: SCHEME_URL requires a scheme of at least two,
        // so `a://` stops matching entirely and the probe measures nothing. That
        // is how this guard silently went vacuous once, and why it is `ab://`.
        const repeats = 20000;

        const control = await fastestLoad(
          "vf-config-starts-control-",
          `throw new Error("1b://(".repeat(${repeats}));\n`,
        );
        const controlMs = Math.max(1, control.ms);
        const { ms: probeMs, error } = await fastestLoad(
          "vf-config-starts-probe-",
          `throw new Error("ab://(".repeat(${repeats}));\n`,
        );

        assertEquals(
          probeMs < controlMs * 20,
          true,
          `probe ${probeMs}ms vs control ${controlMs}ms`,
        );
        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
      });

      it("redacts a path with a CSI introducer glued to its first character", async () => {
        const posix = await loadFailure(
          "vf-config-csi-glued-posix-",
          `throw new Error(String.fromCharCode(27) + "[/home/alice/veryfront.config.ts");\n`,
        );

        // `/` is a valid CSI intermediate byte and `h` a valid final, so the CSI
        // pass consumes `ESC[/h` and leaves `ome/alice/...`, which no later path
        // pattern recognises. Both are legal CSI sequences, so the grammar cannot
        // tell them from a path -- the path has to be matched while still intact.
        assertEquals(posix.message.includes("alice"), false);
        assertEquals(posix.message.includes("ome/alice"), false);
        // Assert the marker, not only the absence of the secret. Redacting the
        // path before the CSI pass instead of removing just the introducer
        // produced `ESC[[path]`, and `[` is a valid CSI final byte, so the pass
        // ate the marker's own bracket and emitted `path]`.
        assertStringIncludes(posix.message, "[path]");

        const drive = await loadFailure(
          "vf-config-csi-glued-drive-",
          `throw new Error(String.fromCharCode(27) + "[" + String.fromCharCode(67) + ":\\\\Users\\\\alice\\\\veryfront.config.ts");\n`,
        );

        // Same shape: `C` is a valid final byte, so the drive letter is consumed
        // and `:\Users\alice` no longer matches WINDOWS_ABSOLUTE_PATH.
        assertEquals(drive.message.includes("alice"), false);
        assertEquals(drive.message.includes("Users"), false);
        assertStringIncludes(drive.message, "[path]");
      });

      it("keeps a path intact when CSI parameter or intermediate bytes precede it", async () => {
        const drive = await loadFailure(
          "vf-config-csi-param-drive-",
          `throw new Error(String.fromCharCode(27) + "[31" + String.fromCharCode(67) + ":\\\\Users\\\\alice\\\\veryfront.config.ts");\n`,
        );

        // `ESC[31C` is a legal cursor-forward sequence whose final byte is the
        // drive letter itself. Removing only the bare introducer left `:\Users`
        // behind, which WINDOWS_ABSOLUTE_PATH does not match -- so the parameter
        // run has to be part of what the pre-pass removes.
        assertEquals(drive.message.includes("alice"), false);
        assertEquals(drive.message.includes("Users"), false);
        assertStringIncludes(drive.message, "[path]");

        const posix = await loadFailure(
          "vf-config-csi-param-posix-",
          `throw new Error(String.fromCharCode(27) + "[31/home/alice/veryfront.config.ts");\n`,
        );

        // Same sequence shape, POSIX side: `31` are parameter bytes, `/` an
        // intermediate and `h` the final, so the CSI pass ate `ESC[31/h` and
        // emitted `ome/alice/...`.
        assertEquals(posix.message.includes("alice"), false);
        assertEquals(posix.message.includes("ome/alice"), false);
        assertStringIncludes(posix.message, "[path]");

        const intermediate = await loadFailure(
          "vf-config-csi-intermediate-posix-",
          `throw new Error(String.fromCharCode(27) + "['/home/alice/veryfront.config.ts");\n`,
        );

        // An intermediate byte can precede the path with no parameters at all
        // (`'` is 0x27), which is why the pre-pass carries both runs.
        assertEquals(intermediate.message.includes("alice"), false);
        assertEquals(intermediate.message.includes("ome/alice"), false);
        assertStringIncludes(intermediate.message, "[path]");

        const colorized = await loadFailure(
          "vf-config-csi-param-sgr-",
          `throw new Error(String.fromCharCode(27) + "[38:2:255:0:0m/home/alice/veryfront.config.ts");\n`,
        );

        // The widened pre-pass must not claim an ordinary colour sequence: its
        // final byte `m` is not a path start, so the sequence still falls through
        // to the full CSI pass and the path is redacted after de-colorization.
        assertEquals(colorized.message.includes("alice"), false);
        assertEquals(colorized.message.includes("38:2"), false);
        assertStringIncludes(colorized.message, "[path]");
      });

      it("keeps a special-scheme URL intact when a CSI introducer precedes it", async () => {
        const zeroSlash = await loadFailure(
          "vf-config-csi-zero-slash-url-",
          `throw new Error(String.fromCharCode(27) + "[https:registry.internal/veryfront.config.ts");\n`,
        );

        // `h` is a legal CSI final byte, so the CSI pass consumed `ESC[h` and left
        // `ttps:registry.internal/...`. ZERO_SLASH_SCHEME_URL no longer recognises
        // the damaged scheme, and POSIX_ABSOLUTE_PATH refuses a `/` that follows a
        // hostname, so the private host reached the caller-visible error.
        assertEquals(zeroSlash.message.includes("registry.internal"), false);
        assertStringIncludes(zeroSlash.message, "[url]");

        const upper = await loadFailure(
          "vf-config-csi-zero-slash-upper-",
          `throw new Error(String.fromCharCode(27) + "[WSS:registry.internal/veryfront.config.ts");\n`,
        );

        // Every special scheme leaks the same way, and schemes are case-insensitive.
        assertEquals(upper.message.includes("registry.internal"), false);
        assertStringIncludes(upper.message, "[url]");

        const eightBit = await loadFailure(
          "vf-config-csi-zero-slash-8bit-",
          `throw new Error(String.fromCharCode(155) + "ftp:registry.internal/veryfront.config.ts");\n`,
        );

        assertEquals(eightBit.message.includes("registry.internal"), false);
        assertStringIncludes(eightBit.message, "[url]");

        const singleSlash = await loadFailure(
          "vf-config-csi-single-slash-url-",
          `throw new Error(String.fromCharCode(27) + "[https:/registry.internal/veryfront.config.ts");\n`,
        );

        // This form did not leak -- the damaged `ttp` still hit the drive-letter
        // alternative -- but it emitted `ttp[path]`, the path-as-URL mislabel this
        // change exists to remove.
        assertEquals(singleSlash.message.includes("registry.internal"), false);
        assertEquals(singleSlash.message.includes("[path]"), false);
        assertStringIncludes(singleSlash.message, "[url]");

        const prose = await loadFailure(
          "vf-config-csi-reset-prose-",
          `throw new Error(String.fromCharCode(27) + "[0mError: cannot find module");\n`,
        );

        // The scheme lookahead is restricted to the special schemes for this case:
        // a generic `[A-Za-z][A-Za-z0-9+.-]*:` would match the `mError:` prose here,
        // strip `ESC[0`, and leave a stray `m` in an ordinary diagnostic.
        assertStringIncludes(prose.message, "Error: cannot find module");
        assertEquals(prose.message.includes("mError"), false);
      });

      it("keeps a boundary when a completed CSI sequence sits before a path", async () => {
        const posix = await loadFailure(
          "vf-config-csi-final-byte-posix-",
          `throw new Error("Failed at" + String.fromCharCode(27) + "[3~/home/alice/veryfront.config.ts");\n`,
        );

        // `ESC[3~` is a complete, legal CSI whose final byte is `~`. Removing it
        // during de-colorization joined `at` to the path, and POSIX_ABSOLUTE_PATH's
        // lookbehind refuses a slash after an alphanumeric -- so the whole local
        // path reached the caller-visible error.
        assertEquals(posix.message.includes("alice"), false);
        assertEquals(posix.message.includes("at/home"), false);
        assertStringIncludes(posix.message, "[path]");

        const drive = await loadFailure(
          "vf-config-csi-final-byte-drive-",
          `throw new Error("Failed at" + String.fromCharCode(27) + "[3~C:\\\\Users\\\\alice\\\\veryfront.config.ts");\n`,
        );

        assertEquals(drive.message.includes("alice"), false);
        assertEquals(drive.message.includes("Users"), false);
        assertStringIncludes(drive.message, "[path]");

        const url = await loadFailure(
          "vf-config-csi-final-byte-url-",
          `throw new Error("Failed at" + String.fromCharCode(27) + "[3~https:registry.internal/veryfront.config.ts");\n`,
        );

        assertEquals(url.message.includes("registry.internal"), false);
        assertStringIncludes(url.message, "[url]");

        const credential = await loadFailure(
          "vf-config-csi-final-byte-credential-",
          `throw new Error("Using token sk-" + String.fromCharCode(27) + "[0mABCD1234EFGH5678");\n`,
        );

        // The counterpart that pins why this is a pre-pass and not a change to
        // de-colorization itself. That pass must keep replacing with nothing: a
        // sequence inside a credential only rejoins into a contiguous secret if
        // removal leaves no gap, and the sanitiser after it matches nothing
        // otherwise. Emitting a space there would fix the path boundary above and
        // reopen this.
        assertEquals(credential.message.includes("ABCD1234EFGH5678"), false);
      });

      it("keeps both UNC separators when a CSI introducer precedes them", async () => {
        const unc = await loadFailure(
          "vf-config-csi-unc-",
          `throw new Error(String.fromCharCode(27) + "[\\\\\\\\server\\\\share\\\\veryfront.config.ts");\n`,
        );

        // A backslash is 0x5C, inside the CSI final-byte range, so the optional
        // final byte consumed the first of the two separators while the lookahead
        // was satisfied by the second. The pre-pass emitted a single-separator
        // path, WINDOWS_ABSOLUTE_PATH requires a doubled one, and the whole UNC
        // path reached the caller. `origin/main` redacts this input, so the
        // pre-pass introduced the leak rather than inheriting it.
        assertEquals(unc.message.includes("server"), false);
        assertEquals(unc.message.includes("share"), false);
        assertStringIncludes(unc.message, "[path]");

        const eightBit = await loadFailure(
          "vf-config-csi-unc-eight-bit-",
          `throw new Error(String.fromCharCode(155) + "\\\\\\\\server\\\\share\\\\veryfront.config.ts");\n`,
        );

        assertEquals(eightBit.message.includes("server"), false);
        assertStringIncludes(eightBit.message, "[path]");

        // The completed form already worked: `m` is consumed as the final byte, so
        // both separators survived. Pinned so a later change cannot regress the
        // half that was never broken while fixing the half that was.
        const completed = await loadFailure(
          "vf-config-csi-unc-completed-",
          `throw new Error(String.fromCharCode(27) + "[31m\\\\\\\\server\\\\share\\\\veryfront.config.ts");\n`,
        );

        assertEquals(completed.message.includes("server"), false);
        assertStringIncludes(completed.message, "[path]");
      });

      it("redacts a URL whose parentheses do not balance", async () => {
        // The shared interior matched either a non-paren character or a BALANCED
        // `(...)` pair, so a lone paren ended the match: the hostname redacted
        // and the tail printed verbatim, which is where a query-string token
        // sits (veryfront-issue-inbox#845). Reproduces on `origin/main`, so this
        // is a pre-existing gap, not one introduced with the URL passes.
        const unclosed = await loadFailure(
          "vf-config-paren-unclosed-",
          `throw new Error("https://registry.internal/a(SUPERSECRET/c.ts");\n`,
        );

        assertEquals(unclosed.message.includes("SUPERSECRET"), false);
        assertEquals(unclosed.message.includes("registry.internal"), false);
        assertStringIncludes(unclosed.message, "[url]");

        const unopened = await loadFailure(
          "vf-config-paren-unopened-",
          `throw new Error("https://registry.internal/a)SUPERSECRET/c.ts");\n`,
        );

        assertEquals(unopened.message.includes("SUPERSECRET"), false);
        assertStringIncludes(unopened.message, "[url]");

        // The counterpart that keeps the fix honest. A trailing `)` has nothing
        // but the end of the token after it, so the lookahead leaves it outside
        // the match and the sentence keeps its own bracket. Without this the
        // obvious wider fix -- taking any paren -- would swallow it.
        const prose = await loadFailure(
          "vf-config-paren-prose-",
          `throw new Error("Failed (see https://registry.internal/x)");\n`,
        );

        assertEquals(prose.message.includes("registry.internal"), false);
        assertStringIncludes(prose.message, "(see [url])");

        const period = await loadFailure(
          "vf-config-paren-period-",
          `throw new Error("Failed (see https://registry.internal/x). Retry");\n`,
        );

        assertEquals(period.message.includes("registry.internal"), false);
        assertStringIncludes(period.message, "Failed (see [url]). Retry");

        const comma = await loadFailure(
          "vf-config-paren-comma-",
          `throw new Error("Failed (see https://registry.internal/x), then retry");\n`,
        );

        assertEquals(comma.message.includes("registry.internal"), false);
        assertStringIncludes(comma.message, "Failed (see [url]), then retry");

        // `!` and `?` are the cases a list of allowed trailing characters kept
        // missing. The lookahead asks whether the rest of the token is only
        // punctuation instead of enumerating which marks count, so a sentence
        // ending keeps its bracket whatever the mark is.
        const bang = await loadFailure(
          "vf-config-paren-bang-",
          `throw new Error("Failed (see https://registry.internal/x)! Retry");\n`,
        );

        assertEquals(bang.message.includes("registry.internal"), false);
        assertStringIncludes(bang.message, "Failed (see [url])! Retry");

        const question = await loadFailure(
          "vf-config-paren-question-",
          `throw new Error("Failed (see https://registry.internal/x)? Retry");\n`,
        );

        assertEquals(question.message.includes("registry.internal"), false);
        assertStringIncludes(question.message, "Failed (see [url])? Retry");

        for (
          const punctuation of ["…", "。", "¿", "»", "🙂", "❤️", "⚠️", "👩‍💻"] as const
        ) {
          const unicode = await loadFailure(
            "vf-config-paren-unicode-punctuation-",
            `throw new Error(${
              JSON.stringify(
                `Failed (see https://registry.internal/x)${punctuation} Retry`,
              )
            });\n`,
          );

          assertEquals(unicode.message.includes("registry.internal"), false);
          assertStringIncludes(unicode.message, `Failed (see [url])${punctuation} Retry`);
        }
      });

      it("keeps prose that follows a redacted URL without a space", async () => {
        // Keep the space-separated control next to the glued case. Both must
        // preserve the sentence mark and following prose; the no-space input
        // proves the URL token ends at characters that cannot appear unencoded
        // in an RFC 3986 URI, not only at whitespace.
        const spaced = await loadFailure(
          "vf-config-paren-cjk-spaced-",
          `throw new Error("Failed (see https://registry.internal/x)。 Retry");\n`,
        );

        assertStringIncludes(spaced.message, "Failed (see [url])。 Retry");

        const glued = await loadFailure(
          "vf-config-paren-cjk-glued-",
          `throw new Error("Failed (see https://registry.internal/x)。次を試してください");\n`,
        );

        assertStringIncludes(glued.message, "Failed (see [url])。次を試してください");
        assertEquals(glued.message.includes("registry.internal"), false);

        // Cover the ordinary tail independently of the parenthesis branches.
        // It must stop before the first non-ASCII prose character while still
        // redacting the complete host and ASCII path.
        const noParen = await loadFailure(
          "vf-config-cjk-glued-",
          `throw new Error("Failed https://registry.internal/x次を試してください");\n`,
        );

        assertEquals(noParen.message.includes("registry.internal"), false);
        assertStringIncludes(noParen.message, "Failed [url]次を試してください");

        // Percent-encoding keeps the complete URI in ASCII, so an encoded path
        // and query remain inside the redacted token.
        const encoded = await loadFailure(
          "vf-config-cjk-percent-encoded-",
          `throw new Error("Failed https://registry.internal/x%E6%AC%A1?t=SUPERSECRET");\n`,
        );

        assertEquals(encoded.message.includes("registry.internal"), false);
        assertEquals(encoded.message.includes("SUPERSECRET"), false);
        assertStringIncludes(encoded.message, "Failed [url]");

        // A non-ASCII authority has no completed ASCII host prefix to redact.
        // Treat it as an IRI and fail closed on the whole token rather than
        // exposing the hostname while trying to preserve following prose.
        const iriHost = await loadFailure(
          "vf-config-iri-host-",
          `throw new Error("Failed https://例え.internal/config.ts");\n`,
        );

        assertEquals(iriHost.message.includes("例え.internal"), false);
        assertStringIncludes(iriHost.message, "Failed [url]");

        const mixedIriHost = await loadFailure(
          "vf-config-mixed-iri-host-",
          `throw new Error("Failed https://a例.internal/config.ts");\n`,
        );

        assertEquals(mixedIriHost.message.includes("例.internal"), false);
        assertStringIncludes(mixedIriHost.message, "Failed [url]");

        const iriUrlPath = await loadFailure(
          "vf-config-iri-url-path-",
          `throw new Error("Failed https://registry.internal/秘密/config.ts");\n`,
        );

        assertEquals(iriUrlPath.message.includes("秘密"), false);
        assertEquals(iriUrlPath.message.includes("registry.internal"), false);
        assertStringIncludes(iriUrlPath.message, "Failed [url]");

        const iriFilePath = await loadFailure(
          "vf-config-iri-file-path-",
          `throw new Error("Failed file:///home/alice/秘密/config.ts");\n`,
        );

        assertEquals(iriFilePath.message.includes("秘密"), false);
        assertEquals(iriFilePath.message.includes("/home/alice"), false);
        assertStringIncludes(iriFilePath.message, "Failed [path]");

        const iriTerminalPath = await loadFailure(
          "vf-config-iri-terminal-path-",
          `throw new Error("Failed https://registry.internal/秘密");\n`,
        );

        assertEquals(iriTerminalPath.message.includes("秘密"), false);
        assertStringIncludes(iriTerminalPath.message, "Failed [url]");

        const iriQuery = await loadFailure(
          "vf-config-iri-query-",
          `throw new Error("Failed https://registry.internal/x?q=秘密");\n`,
        );

        assertEquals(iriQuery.message.includes("秘密"), false);
        assertStringIncludes(iriQuery.message, "Failed [url]");

        const iriPrefixedQuery = await loadFailure(
          "vf-config-iri-prefixed-query-",
          `throw new Error("Failed https://registry.internal/x?q=abc秘密");\n`,
        );

        assertEquals(iriPrefixedQuery.message.includes("秘密"), false);
        assertEquals(iriPrefixedQuery.message.includes("abc"), false);
        assertStringIncludes(iriPrefixedQuery.message, "Failed [url]");

        const iriParenthesizedPath = await loadFailure(
          "vf-config-iri-parenthesized-path-",
          `throw new Error("Failed https://registry.internal/x(秘密)/config.ts");\n`,
        );

        assertEquals(iriParenthesizedPath.message.includes("秘密"), false);
        assertEquals(iriParenthesizedPath.message.includes("registry.internal"), false);
        assertStringIncludes(iriParenthesizedPath.message, "Failed [url]");

        const iriUnbalancedParenthesizedPath = await loadFailure(
          "vf-config-iri-unbalanced-parenthesized-path-",
          `throw new Error("Failed https://registry.internal/x(秘密/config.ts");\n`,
        );

        assertEquals(iriUnbalancedParenthesizedPath.message.includes("秘密"), false);
        assertEquals(
          iriUnbalancedParenthesizedPath.message.includes("registry.internal"),
          false,
        );
        assertStringIncludes(iriUnbalancedParenthesizedPath.message, "Failed [url]");

        const fileIriParenthesizedPath = await loadFailure(
          "vf-config-file-iri-parenthesized-path-",
          `throw new Error("Failed file:///home/alice/x(秘密)/config.ts");\n`,
        );

        assertEquals(fileIriParenthesizedPath.message.includes("秘密"), false);
        assertEquals(fileIriParenthesizedPath.message.includes("/home/alice"), false);
        assertStringIncludes(fileIriParenthesizedPath.message, "Failed [path]");

        const acceptedRawPath = await loadFailure(
          "vf-config-raw-accepted-url-path-",
          `throw new Error("Failed https://registry.internal/{PRIVATE}/config.ts");\n`,
        );

        assertEquals(acceptedRawPath.message.includes("{PRIVATE}"), false);
        assertEquals(acceptedRawPath.message.includes("registry.internal"), false);
        assertStringIncludes(acceptedRawPath.message, "Failed [url]");

        const acceptedRawTerminalPath = await loadFailure(
          "vf-config-raw-accepted-terminal-path-",
          `throw new Error("Failed https://registry.internal/account{PRIVATE}");\n`,
        );

        assertEquals(acceptedRawTerminalPath.message.includes("PRIVATE"), false);
        assertEquals(acceptedRawTerminalPath.message.includes("registry.internal"), false);
        assertStringIncludes(acceptedRawTerminalPath.message, "Failed [url]");

        const backslashUrlPath = await loadFailure(
          "vf-config-backslash-url-path-",
          `throw new Error("Failed https://registry.internal\\\\PRIVATE\\\\config.ts");\n`,
        );

        assertEquals(backslashUrlPath.message.includes("PRIVATE"), false);
        assertEquals(backslashUrlPath.message.includes("registry.internal"), false);
        assertStringIncludes(backslashUrlPath.message, "Failed [url]");

        for (const rawCharacter of ["<", ">", "`", "^", "|"]) {
          const rawValue = `${rawCharacter}PRIVATE${rawCharacter}`;
          const acceptedRawUrlPath = await loadFailure(
            "vf-config-raw-accepted-url-path-",
            `throw new Error("Failed https://registry.internal/${rawValue}/config.ts");\n`,
          );

          assertEquals(acceptedRawUrlPath.message.includes("PRIVATE"), false);
          assertEquals(acceptedRawUrlPath.message.includes("registry.internal"), false);
          assertStringIncludes(acceptedRawUrlPath.message, "Failed [url]");

          const acceptedRawFilePath = await loadFailure(
            "vf-config-raw-accepted-file-path-",
            `throw new Error("Failed file:///home/alice/${rawValue}/config.ts");\n`,
          );

          assertEquals(acceptedRawFilePath.message.includes("PRIVATE"), false);
          assertEquals(acceptedRawFilePath.message.includes("/home/alice"), false);
          assertStringIncludes(acceptedRawFilePath.message, "Failed [path]");
        }

        const longIriPrefix = "a".repeat(2049);
        const longIriPath = await loadFailure(
          "vf-config-long-iri-prefix-",
          `throw new Error("Failed https://registry.internal/${longIriPrefix}/秘密/config.ts");\n`,
        );

        assertEquals(longIriPath.message.includes("秘密"), false);
        assertEquals(longIriPath.message.includes("registry.internal"), false);
        assertStringIncludes(longIriPath.message, "Failed [url]");

        const closingAngleProse = await loadFailure(
          "vf-config-closing-angle-prose-",
          `throw new Error("Failed (see https://registry.internal/x)> Retry");\n`,
        );

        assertEquals(closingAngleProse.message.includes("registry.internal"), false);
        assertStringIncludes(closingAngleProse.message, "Failed (see [url])> Retry");

        const bareAuthorityProse = await loadFailure(
          "vf-config-iri-authority-prose-",
          `throw new Error("Failed (see https://registry.internal)。次を試してください");\n`,
        );

        assertStringIncludes(bareAuthorityProse.message, "Failed (see [url])。次を試してください");
        assertEquals(bareAuthorityProse.message.includes("registry.internal"), false);

        const iriTerminalFilePath = await loadFailure(
          "vf-config-iri-terminal-file-path-",
          `throw new Error("Failed file:///home/alice/秘密");\n`,
        );

        assertEquals(iriTerminalFilePath.message.includes("秘密"), false);
        assertStringIncludes(iriTerminalFilePath.message, "Failed [path]");

        const zeroSlashIri = await loadFailure(
          "vf-config-zero-slash-iri-host-",
          `throw new Error("Failed https:例え.internal/config.ts");\n`,
        );

        assertEquals(zeroSlashIri.message.includes("例え.internal"), false);
        assertStringIncludes(zeroSlashIri.message, "Failed [url]");

        const zeroSlashSymbolIri = await loadFailure(
          "vf-config-zero-slash-symbol-iri-host-",
          `throw new Error("Failed https:🙂.internal/config.ts");\n`,
        );

        assertEquals(zeroSlashSymbolIri.message.includes("🙂.internal"), false);
        assertStringIncludes(zeroSlashSymbolIri.message, "Failed [url]");

        const zeroSlashIriPath = await loadFailure(
          "vf-config-zero-slash-iri-path-",
          `throw new Error("Failed https:registry.internal/秘密/config.ts");\n`,
        );

        assertEquals(zeroSlashIriPath.message.includes("秘密"), false);
        assertStringIncludes(zeroSlashIriPath.message, "Failed [url]");

        const singleSlashIri = await loadFailure(
          "vf-config-single-slash-iri-host-",
          `throw new Error("Failed https:/例え.internal/config.ts");\n`,
        );

        assertEquals(singleSlashIri.message.includes("例え.internal"), false);
        assertStringIncludes(singleSlashIri.message, "Failed [url]");

        const singleSlashIriPath = await loadFailure(
          "vf-config-single-slash-iri-path-",
          `throw new Error("Failed https:/registry.internal/秘密/config.ts");\n`,
        );

        assertEquals(singleSlashIriPath.message.includes("秘密"), false);
        assertStringIncludes(singleSlashIriPath.message, "Failed [url]");
      });

      it("redacts raw IRI remainders after Unicode authorities", async () => {
        const cases = [
          ["two-slash-path", "https://例え.internal/秘密"],
          ["two-slash-ascii-symbol-host", "https://a$秘密.internal/private"],
          ["two-slash-ideographic-dot-host", "https://例え。internal/private"],
          ["two-slash-fullwidth-dot-host", "https://例え．internal/private"],
          ["two-slash-halfwidth-dot-host", "https://例え｡internal/private"],
          ["two-slash-latin-middle-dot-host", "https://l·l.internal/private"],
          ["two-slash-greek-lower-numeral-host", "https://͵α.internal/private"],
          ["two-slash-hebrew-geresh-host", "https://א׳ב.internal/private"],
          ["two-slash-hebrew-gershayim-host", "https://א״ב.internal/private"],
          ["two-slash-katakana-middle-dot-host", "https://カ・ナ.internal/private"],
          ["two-slash-joined-symbol-host", "https://👩‍💻.internal/private"],
          ["two-slash-symbol-host", "https://🙂🙂.internal/private"],
          ["two-slash-query", "https://例え.internal?q=秘密"],
          ["single-slash-ideographic-dot-host", "https:/例え。internal/private"],
          ["single-slash-latin-middle-dot-host", "https:/l·l.internal/private"],
          ["single-slash-path", "https:/例え.internal/秘密"],
          ["single-slash-symbol-host", "https:/🙂🙂.internal/private"],
          ["single-slash-query", "https:/例え.internal?q=秘密"],
          ["zero-slash-ideographic-dot-host", "https:例え。internal/private"],
          ["zero-slash-latin-middle-dot-host", "https:l·l.internal/private"],
          ["zero-slash-path", "https:例え.internal/秘密"],
          ["zero-slash-symbol-host", "https:🙂🙂.internal/private"],
          ["zero-slash-query", "https:例え.internal?q=秘密"],
        ] as const;

        for (const [label, url] of cases) {
          const error = await loadFailure(
            `vf-config-iri-authority-${label}-`,
            `throw new Error(${JSON.stringify(`Failed ${url}`)});\n`,
          );

          assertEquals(error.message.includes("例え.internal"), false, label);
          assertEquals(error.message.includes("🙂.internal"), false, label);
          assertEquals(error.message.includes("/private"), false, label);
          assertEquals(error.message.includes("秘密"), false, label);
          assertStringIncludes(error.message, "Failed [url]", label);
        }
      });

      it("redacts backslash paths after contextual IDNA authorities", async () => {
        for (
          const [label, url] of [
            ["two-slash", "https://l·l.internal\\PRIVATE"],
            ["single-slash", "https:/l·l.internal\\PRIVATE"],
            ["zero-slash", "https:l·l.internal\\PRIVATE"],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-iri-backslash-authority-${label}-`,
            `throw new Error(${JSON.stringify(`Failed ${url}`)});\n`,
          );

          assertEquals(error.message.endsWith("Failed [url]"), true, label);
        }
      });

      it("redacts a bare Unicode authority whole across host punctuation", async () => {
        const cases = [
          ["latin-middle-dot", "https://l·l.internal"],
          ["greek-lower-numeral", "https://͵α.internal"],
          ["hebrew-geresh", "https://א׳ב.internal"],
          ["hebrew-gershayim", "https://א״ב.internal"],
          ["katakana-middle-dot", "https://カ・ナ.internal"],
          ["tibetan-tsheg", "https://བོད་ཡིག.internal"],
          ["ideographic-dot", "https://例え。internal"],
          ["fullwidth-dot", "https://例え．internal"],
          ["halfwidth-dot", "https://例え｡internal"],
          ["guillemet", "https://l«l.internal"],
          ["en-dash", "https://l–l.internal"],
          ["ideographic-comma", "https://l、l.internal"],
          ["devanagari-danda", "https://l।l.internal"],
          ["symbol", "https://l→l.internal"],
          ["soft-hyphen", "https://l\u00adl.internal"],
          ["zero-width-non-joiner", "https://l\u200cl.internal"],
          ["single-slash", "https:/l·l.internal"],
          ["zero-slash", "https:l·l.internal"],
        ] as const;

        for (const [label, url] of cases) {
          const error = await loadFailure(
            `vf-config-iri-bare-authority-${label}-`,
            `throw new Error(${JSON.stringify(`Failed ${url}`)});\n`,
          );

          assertEquals(error.message.endsWith("Failed [url]"), true, label);
        }
      });

      it("keeps sentence punctuation after a bare Unicode authority", async () => {
        const cases = [
          [
            "ideographic-full-stop-space",
            "Failed https://l·l.internal。 Retry",
            "Failed [url]。 Retry",
          ],
          ["ideographic-full-stop-end", "Failed https://l·l.internal。", "Failed [url]。"],
          ["middle-dot-space", "Failed https://l·l.internal· Retry", "Failed [url]· Retry"],
          ["middle-dot-end", "Failed https://l·l.internal·", "Failed [url]·"],
          ["katakana-middle-dot", "Failed https://例え.internal・ Retry", "Failed [url]・ Retry"],
          [
            "non-special-scheme",
            "Failed foo://例え.internal。Retry",
            "Failed [url]。Retry",
          ],
          [
            "guillemets-comma",
            "Failed «https://例え.internal», réessayez",
            "Failed «[url]», réessayez",
          ],
          ["guillemets-period", "Failed «https://例え.internal».", "Failed «[url]»."],
        ] as const;

        for (const [label, input, expected] of cases) {
          const error = await loadFailure(
            `vf-config-iri-bare-authority-terminator-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertEquals(error.message.includes("internal"), false, label);
          assertStringIncludes(error.message, expected, label);
        }

        const asciiPeriod = await loadFailure(
          "vf-config-iri-bare-authority-terminator-ascii-period-",
          `throw new Error(${JSON.stringify("Failed https://l·l.internal. Retry")});\n`,
        );

        assertEquals(asciiPeriod.message.includes("internal"), false);
        assertStringIncludes(asciiPeriod.message, "Failed [url]");
        assertStringIncludes(asciiPeriod.message, " Retry");

        const glued = await loadFailure(
          "vf-config-iri-bare-authority-terminator-glued-",
          `throw new Error(${
            JSON.stringify("Failed https://例え.internal。次を試してください")
          });\n`,
        );

        assertEquals(glued.message.includes("internal"), false);
        assertEquals(glued.message.includes("次を試してください"), false);
        assertStringIncludes(glued.message, "Failed [url]");
      });

      it("keeps rejected host characters and quoted text after a Unicode authority", async () => {
        for (
          const [label, input, expected] of [
            [
              "quoted",
              'Failed https://例え.internal·"secret"',
              'Failed [url]·"secret"',
            ],
            ["rejected-symbol", "Failed https://例え.internal¨Retry", "Failed [url]¨Retry"],
            ["rejected-punctuation", "Failed https://例え.internal…Retry", "Failed [url]…Retry"],
            [
              "rejected-format-character",
              "Failed https://例え.internal\u200eRetry",
              "Failed [url]\u200eRetry",
            ],
            [
              "single-slash-rejected-symbol",
              "Failed https:/例え.internal¨Retry",
              "Failed [url]¨Retry",
            ],
            [
              "zero-slash-rejected-symbol",
              "Failed https:例え.internal¨Retry",
              "Failed [url]¨Retry",
            ],
            [
              "invalid-port-after-accepted-symbol",
              "Failed https://a🙂.internal:99999/private",
              "Failed [url]",
            ],
            [
              "invalid-port-after-userinfo-symbol",
              "Failed https://a¨value@例え.internal:99999/private",
              "Failed [url]",
            ],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-iri-bare-authority-boundary-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertStringIncludes(error.message, expected, label);
          assertEquals(error.message.includes("internal"), false, label);
        }
      });

      it("redacts a rejected userinfo symbol together with the whole candidate", async () => {
        // Suffix restoration must never cut before the userinfo terminator:
        // reparsing the prefix without the following `@` tests the symbol as
        // host data, and the invalid port then exposed
        // `¨value@例え.internal:99999/private` even though the same userinfo is
        // accepted and percent-encoded when the port is valid.
        for (
          const [label, input] of [
            ["two-slash-invalid-port", "Failed https://a¨value@例え.internal:99999/private"],
            ["single-slash-invalid-port", "Failed https:/a¨value@例え.internal:99999/private"],
            ["zero-slash-invalid-port", "Failed https:a¨value@例え.internal:99999/private"],
            ["two-slash-valid-port", "Failed https://a¨value@例え.internal:8080/private"],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-iri-userinfo-symbol-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertEquals(error.message.endsWith("Failed [url]"), true, label);
          assertEquals(error.message.includes("internal"), false, label);
          assertEquals(error.message.includes("value"), false, label);
          assertEquals(error.message.includes("private"), false, label);
          assertEquals(error.message.includes("¨"), false, label);
        }
      });

      it("keeps glued prose after a non-special IRI authority", async () => {
        // WHATWG accepts sentence punctuation and the following text as an
        // opaque percent-encoded host, so a successful parse proves nothing for
        // a non-special scheme. The structural sentence boundary applies before
        // the whole match is accepted.
        for (
          const [label, input, expected] of [
            ["ideographic-full-stop", "Failed foo://例え.internal。Retry", "Failed [url]。Retry"],
            ["latin-middle-dot", "Failed foo://例え.internal·Retry", "Failed [url]·Retry"],
            ["katakana-middle-dot", "Failed foo://例え.internal・Retry", "Failed [url]・Retry"],
            [
              "glued-unicode-prose",
              "Failed foo://例え.internal。次を試してください",
              "Failed [url]。次を試してください",
            ],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-opaque-authority-prose-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertStringIncludes(error.message, expected, label);
          assertEquals(error.message.includes("internal"), false, label);
        }
      });

      it("redacts a non-special IRI authority whole when punctuation is not a sentence boundary", async () => {
        // Confidentiality wins over prose recovery: URL structure after the
        // punctuation, an undotted authority prefix, or a host-shaped remainder
        // all keep the candidate redacted whole.
        for (
          const [label, input] of [
            ["path-after-punctuation", "Failed foo://例え。internal/private"],
            ["port-after-punctuation", "Failed foo://例え.internal。Retry:8080"],
            ["undotted-authority", "Failed foo://例え。internal"],
            ["host-shaped-remainder", "Failed foo://a.b。c.d"],
            ["userinfo-punctuation", "Failed foo://a。b@例え.internal"],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-opaque-authority-boundary-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertEquals(error.message.endsWith("Failed [url]"), true, label);
          assertEquals(error.message.includes("internal"), false, label);
          assertEquals(error.message.includes("private"), false, label);
          assertEquals(error.message.includes("c.d"), false, label);
        }
      });

      it("keeps special-scheme glued punctuation redacted whole", async () => {
        // For special schemes the same punctuation is genuine host data:
        // ideographic full stops are IDNA dot-equivalents, so `Retry` becomes a
        // host label, and contextual middle dots fail validation without a
        // restorable symbol boundary. `file:` is special too, and its two-slash
        // remote-host form reaches the generic authority matcher.
        for (
          const [label, input] of [
            ["https-ideographic-full-stop", "Failed https://例え.internal。Retry"],
            ["https-latin-middle-dot", "Failed https://l·l.internal·Retry"],
            ["https-katakana-middle-dot", "Failed https://例え.internal・Retry"],
            ["file-ideographic-full-stop", "Failed file://例え.internal。Retry"],
          ] as const
        ) {
          const error = await loadFailure(
            `vf-config-special-authority-glued-${label}-`,
            `throw new Error(${JSON.stringify(input)});\n`,
          );

          assertEquals(error.message.includes("internal"), false, label);
          assertEquals(error.message.includes("Retry"), false, label);
        }
      });

      it("does not split redaction at the Unicode authority probe bound", async () => {
        const cases = [
          ["split-run", `${"a".repeat(511)}秘密.internal`],
          ["overlong-prefix", `${"a".repeat(512)}秘密.internal`],
          ["overlong-prefix-mapped-dot", `${"a".repeat(512)}秘密。internal`],
          ["overlong-prefix-contextual-punctuation", `${"a".repeat(512)}l·l.internal`],
        ] as const;

        for (const [label, host] of cases) {
          const error = await loadFailure(
            `vf-config-iri-authority-bound-${label}-`,
            `throw new Error(${JSON.stringify(`Failed https://${host}/private`)});\n`,
          );

          assertEquals(error.message.includes("密.internal"), false, label);
          assertEquals(error.message.includes("/private"), false, label);
          assertStringIncludes(error.message, "Failed [url]", label);
        }
      });

      it("preserves prose after Unicode whitespace following an IRI authority", async () => {
        const error = await loadFailure(
          "vf-config-iri-authority-unicode-whitespace-",
          `throw new Error(${JSON.stringify("Failed https://例え.internal\u00a0\u00a0Retry")});\n`,
        );

        assertStringIncludes(error.message, "Failed [url]\u00a0\u00a0Retry");
      });

      it("redacts a URL tail that begins after a lone `)` and punctuation", async () => {
        // A URL-like payload after `)` remains part of the token.
        const period = await loadFailure(
          "vf-config-paren-tail-period-",
          `throw new Error("https://registry.internal/a).SUPERSECRET/c.ts");\n`,
        );

        assertEquals(period.message.includes("SUPERSECRET"), false);
        assertEquals(period.message.includes("registry.internal"), false);
        assertStringIncludes(period.message, "[url]");

        // `?` introduces a query when payload follows it.
        const query = await loadFailure(
          "vf-config-paren-tail-query-",
          `throw new Error("https://registry.internal/a)?t=SUPERSECRET");\n`,
        );

        assertEquals(query.message.includes("SUPERSECRET"), false);
        assertStringIncludes(query.message, "[url]");
      });

      it("reports a CSI-glued file URL as a path, not a remote URL", async () => {
        const error = await loadFailure(
          "vf-config-csi-glued-file-url-",
          `throw new Error(String.fromCharCode(27) + "[file:///home/alice/veryfront.config.ts");\n`,
        );

        // `f` is a legal CSI final byte, so the pass consumed `ESC[f` and SCHEME_URL
        // read the remaining `ile:///home/alice/...` as a remote URL. Nothing leaked,
        // but a local path was reported as `[url]` -- the path-as-URL mislabel this
        // change exists to remove, arrived at from the other direction.
        assertEquals(error.message.includes("alice"), false);
        assertEquals(error.message.includes("[url]"), false);
        assertStringIncludes(error.message, "[path]");
      });

      it("classifies a drive path glued to diagnostic text as a path, not a URL", async () => {
        const drive = await loadFailure(
          "vf-config-glued-fwd-drive-",
          `throw new Error("Failed at" + String.fromCharCode(67) + ":/Users/alice/veryfront.config.ts");\n`,
        );

        // A generic scheme shape claimed `atC` here, reporting `Failed [url]` --
        // mislabelling a local path and eating the word `at`. The single-slash
        // form is restricted to the special schemes for exactly this reason.
        assertStringIncludes(drive.message, "Failed at[path]");
        assertEquals(drive.message.includes("alice"), false);

        const url = await loadFailure(
          "vf-config-glued-single-slash-url-",
          `throw new Error("Failed athttps:/registry.internal/veryfront.config.ts");\n`,
        );

        // The glued URL still redacts; the match just starts later in the token,
        // so the diagnostic keeps `at` instead of losing it.
        assertStringIncludes(url.message, "Failed at[url]");
        assertEquals(url.message.includes("registry.internal"), false);
      });

      it("strips a colon-parameter CSI sequence, not only the digit-and-semicolon form", async () => {
        const escape = String.fromCharCode(27);
        const error = await loadFailure(
          "vf-config-truecolor-sgr-",
          `throw new Error("Failed to load ${escape}[38:2:255:0:0m/home/example/project/veryfront.config.ts");\n`,
        );

        // A true-colour sequence separates its parameters with colons. Matching
        // only [0-9;] left "[38:2:255:0:0m" in front of the path, which defeats
        // POSIX_ABSOLUTE_PATH's boundary exactly as an unstripped "[31m" would.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("/home/example"), false);
        assertEquals(error.message.includes("38:2"), false);
      });

      it("strips an eight-bit CSI sequence before redacting a machine path", async () => {
        const csi = String.fromCharCode(0x9b);
        const error = await loadFailure(
          "vf-config-eight-bit-csi-path-",
          `throw new Error("Failed to load ${csi}31m/home/example/project/veryfront.config.ts");\n`,
        );

        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("/home/example"), false);
        assertEquals(error.message.includes("31m"), false);
      });

      it("redacts credentials both before and after stripping CSI sequences", async () => {
        const escape = String.fromCharCode(27);
        const error = await loadFailure(
          "vf-config-ansi-credential-",
          `throw new Error("${escape}[API_KEY=<TOKEN>");\n`,
        );

        assertEquals(error.message.includes("<TOKEN>"), false);
        assertStringIncludes(error.message, "[REDACTED]");
      });

      it("redacts a colorized machine path instead of leaving SGR residue in front of it", async () => {
        const escape = String.fromCharCode(27);
        const error = await loadFailure(
          "vf-config-ansi-path-",
          `throw new Error("Failed to load ${escape}[31m/home/example/project/veryfront.config.ts");\n`,
        );

        // Dropping only the ESC as a control character leaves `[31m` sitting
        // between the boundary and the path, which defeats any pattern anchored
        // on what precedes it. The whole SGR sequence is removed first.
        assertStringIncludes(error.message, "[path]");
        assertEquals(error.message.includes("/home/example"), false);
        assertEquals(error.message.includes("31m"), false);
      });

      it("classifies Bun resolver objects that do not inherit from Error", async () => {
        const error = await loadFailure(
          "vf-config-bun-resolve-object-",
          "const inherited = Object.create(null, {\n" +
            "  code: { get() { throw new Error('inherited code getter'); } },\n" +
            "  message: { get() { throw new Error('inherited message getter'); } },\n" +
            "});\n" +
            "const failure = Object.create(inherited, {\n" +
            "  code: { value: 'ERR_MODULE_NOT_FOUND' },\n" +
            "  message: { value: \"Cannot find package 'left-pad' from '/app/veryfront.config.mjs'\" },\n" +
            "});\n" +
            "throw failure;\n",
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "left-pad");
      });

      it("classifies Bun ResolveMessage prototype accessors", async () => {
        const error = await loadFailure(
          "vf-config-bun-resolve-prototype-",
          "const resolveMessagePrototype = Object.create(Object.prototype);\n" +
            "Object.defineProperties(resolveMessagePrototype, {\n" +
            "  code: { get() { return 'ERR_MODULE_NOT_FOUND'; }, enumerable: true, configurable: false },\n" +
            "  message: {\n" +
            "    get() { return \"Cannot find package 'left-pad' from '/app/veryfront.config.mjs'\"; },\n" +
            "    set(_) {}, enumerable: true, configurable: false,\n" +
            "  },\n" +
            "  name: { value: 'ResolveMessage', enumerable: true, configurable: true },\n" +
            "});\n" +
            "throw Object.create(resolveMessagePrototype);\n",
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "left-pad");
      });

      it("classifies Bun ResolveMessage objects with the live native prototype surface", async () => {
        const error = await loadFailure(
          "vf-config-bun-resolve-native-prototype-",
          "const resolveMessagePrototype = Object.create(Object.prototype);\n" +
            "Object.defineProperties(resolveMessagePrototype, {\n" +
            "  code: { get() { return 'ERR_MODULE_NOT_FOUND'; }, enumerable: true, configurable: false },\n" +
            "  column: { get() { return 1; }, enumerable: true, configurable: false },\n" +
            "  importKind: { get() { return 'import-statement'; }, enumerable: true, configurable: false },\n" +
            "  level: { get() { return 'error'; }, enumerable: true, configurable: false },\n" +
            "  line: { get() { return 1; }, enumerable: true, configurable: false },\n" +
            "  message: {\n" +
            "    get() { return \"Cannot find package 'left-pad' from '/app/veryfront.config.mjs'\"; },\n" +
            "    set(_) {}, enumerable: true, configurable: false,\n" +
            "  },\n" +
            "  position: { get() { return 0; }, enumerable: true, configurable: false },\n" +
            "  referrer: { get() { return '/app/veryfront.config.mjs'; }, enumerable: true, configurable: false },\n" +
            "  specifier: { get() { return 'left-pad'; }, enumerable: true, configurable: false },\n" +
            "  toJSON: { value: function toJSON() { return {}; }, writable: true, enumerable: true, configurable: false },\n" +
            "  toString: { value: function toString() { return this.message; }, writable: true, enumerable: true, configurable: false },\n" +
            "  name: { value: 'ResolveMessage', writable: false, enumerable: true, configurable: true },\n" +
            "  constructor: { value: function ResolveMessage() {}, writable: true, enumerable: false, configurable: true },\n" +
            "  [Symbol.toPrimitive]: { value: function toPrimitive() { return this.message; }, writable: false, enumerable: false, configurable: true },\n" +
            "  [Symbol.toStringTag]: { value: 'ResolveMessage', writable: false, enumerable: false, configurable: true },\n" +
            "});\n" +
            "throw Object.create(resolveMessagePrototype);\n",
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "left-pad");
      });

      it("does not leak Bun-shaped prototype accessor failures", async () => {
        const codeError = await loadFailure(
          "vf-config-bun-resolve-throwing-prototype-",
          "const resolveMessagePrototype = Object.create(Object.prototype);\n" +
            "Object.defineProperties(resolveMessagePrototype, {\n" +
            "  code: { get() { throw new Error('hostile code getter'); }, enumerable: true, configurable: false },\n" +
            "  message: {\n" +
            "    get() { throw new Error('hostile message getter'); },\n" +
            "    set(_) {}, enumerable: true, configurable: false,\n" +
            "  },\n" +
            "  name: { value: 'ResolveMessage', enumerable: true, configurable: true },\n" +
            "});\n" +
            "throw Object.create(resolveMessagePrototype);\n",
        );
        const messageError = await loadFailure(
          "vf-config-bun-resolve-throwing-message-",
          "const resolveMessagePrototype = Object.create(Object.prototype);\n" +
            "Object.defineProperties(resolveMessagePrototype, {\n" +
            "  code: { get() { return 'ERR_MODULE_NOT_FOUND'; }, enumerable: true, configurable: false },\n" +
            "  message: {\n" +
            "    get() { throw new Error('hostile message getter'); },\n" +
            "    set(_) {}, enumerable: true, configurable: false,\n" +
            "  },\n" +
            "  name: { value: 'ResolveMessage', enumerable: true, configurable: true },\n" +
            "});\n" +
            "throw Object.create(resolveMessagePrototype);\n",
        );

        assertEquals(codeError.slug, CONFIG_PARSE_ERROR_SLUG);
        assertStringIncludes(codeError.message, "Failed to load veryfront.config.js");
        assertEquals(messageError.slug, CONFIG_PARSE_ERROR_SLUG);
        assertStringIncludes(messageError.message, "Failed to load veryfront.config.js");
      });

      it("does not accept Bun ResolveMessage lookalikes with extra prototype keys", async () => {
        const counterKey = "__veryfrontConfigBunLookalikeReads";
        try {
          const error = await loadFailure(
            "vf-config-bun-resolve-extra-prototype-",
            `globalThis.${counterKey} = 0;\n` +
              "const resolveMessagePrototype = Object.create(Object.prototype);\n" +
              "Object.defineProperties(resolveMessagePrototype, {\n" +
              "  code: { get() { globalThis.__veryfrontConfigBunLookalikeReads += 1; return 'ERR_MODULE_NOT_FOUND'; }, enumerable: true, configurable: false },\n" +
              "  message: {\n" +
              "    get() { globalThis.__veryfrontConfigBunLookalikeReads += 1; return \"Cannot find package 'left-pad' from '/app/veryfront.config.mjs'\"; },\n" +
              "    set(_) {}, enumerable: true, configurable: false,\n" +
              "  },\n" +
              "  name: { value: 'ResolveMessage', enumerable: true, configurable: true },\n" +
              "  veryfrontProjectControlledKey: { value: true, enumerable: true, configurable: false },\n" +
              "});\n" +
              "throw Object.create(resolveMessagePrototype);\n",
          );

          assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
          assertEquals(
            (globalThis as Record<string, unknown>)[counterKey],
            0,
          );
        } finally {
          delete (globalThis as Record<string, unknown>)[counterKey];
        }
      });

      it("does not invoke unbranded inherited resolver accessors", async () => {
        const counterKey = "__veryfrontConfigHostileResolverAccessorReads";
        try {
          const error = await loadFailure(
            "vf-config-unbranded-resolve-prototype-",
            `globalThis.${counterKey} = 0;\n` +
              "class ProjectResolveMessage {}\n" +
              "Object.defineProperties(ProjectResolveMessage.prototype, {\n" +
              "  code: { get() { globalThis.__veryfrontConfigHostileResolverAccessorReads += 1; return 'ERR_MODULE_NOT_FOUND'; } },\n" +
              "  message: { get() { globalThis.__veryfrontConfigHostileResolverAccessorReads += 1; return \"Cannot find package 'left-pad' from '/app/veryfront.config.mjs'\"; } },\n" +
              "});\n" +
              "throw new ProjectResolveMessage();\n",
          );

          assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
          assertEquals(
            (globalThis as Record<string, unknown>)[counterKey],
            0,
          );
        } finally {
          delete (globalThis as Record<string, unknown>)[counterKey];
        }
      });

      it("contains a cause getter that throws", async () => {
        // A trusted config runs in the shared host realm and can define `cause`
        // as a throwing accessor. Walking the chain must not let that escape in
        // place of the classification, as the sibling errorChain already avoids.
        const error = await loadFailure(
          "vf-config-hostile-cause-",
          'const e = new Error("boom");\n' +
            'Object.defineProperty(e, "cause", { get() { throw new Error("hostile"); } });\n' +
            "throw e;\n",
        );

        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        assert(
          error.message.includes("boom"),
          `error must still report the config's own message, got: ${error.message}`,
        );
      });

      it("contains a nested message getter that throws", async () => {
        const error = await loadFailure(
          "vf-config-hostile-message-",
          "const cause = new Error();\n" +
            'Object.defineProperty(cause, "message", {' +
            ' get() { throw new Error("hostile"); } });\n' +
            'throw new Error("wrapper", { cause });\n',
        );

        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        assert(
          error.message.includes("wrapper"),
          `error must still report the safe outer message, got: ${error.message}`,
        );
      });

      it("classifies dependencies without project-controlled string methods", async () => {
        const receiverValue = String.prototype.valueOf;
        const restores: Array<() => void> = [];
        /**
         * Make one `String.prototype` method throw for the config's specifier.
         *
         * A config file can install these before the loader runs, so the
         * classifier must reach its answer through captured intrinsics.
         */
        const poisonForSpecifier = (
          method: "startsWith" | "slice" | "includes" | "replace" | "trim",
        ) => {
          const original = String.prototype[method] as (...args: unknown[]) => unknown;
          restores.push(replacePropertyForTest(String.prototype, method, {
            value: function (this: string, ...args: unknown[]): unknown {
              const receiver = TestReflectApply(receiverValue, this, []) as string;
              if (receiver === "npm:left-pad" || receiver === "left-pad") {
                throw new Error(`poisoned ${String(method)}`);
              }
              return TestReflectApply(original, this, args);
            },
          }));
        };

        try {
          for (const method of ["startsWith", "slice", "includes", "replace", "trim"] as const) {
            poisonForSpecifier(method);
          }
          const error = await loadFailure(
            "vf-config-hostile-string-",
            "throw new Error('Module not found \"npm:left-pad\".');\n",
          );

          assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
          assertStringIncludes(error.message, "left-pad");
        } finally {
          for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]!();
        }
      });

      it("classifies dependencies without project-controlled array helpers", async () => {
        const originalPush = Array.prototype.push;
        const originalIterator = Array.prototype[Symbol.iterator];
        const message = 'Module not found "npm:left-pad".\n' +
          "  hint: If you want to use the npm package, try running `deno add npm:left-pad`\n" +
          "    at file:///app/veryfront.config.ts:1:8";
        let error: VeryfrontError;

        try {
          Array.prototype.push = function (...values: unknown[]): number {
            if (values[0] === 'Module not found "npm:left-pad".') {
              throw new Error("poisoned push");
            }
            return TestReflectApply(originalPush, this, values) as number;
          };
          Array.prototype[Symbol.iterator] = function (): ArrayIterator<unknown> {
            if (this[0] === message) throw new Error("poisoned iterator");
            return TestReflectApply(originalIterator, this, []) as ArrayIterator<unknown>;
          };

          error = await loadFailure(
            "vf-config-hostile-array-",
            `throw new Error(${JSON.stringify(message)});\n`,
          );
        } finally {
          Array.prototype.push = originalPush;
          Array.prototype[Symbol.iterator] = originalIterator;
        }

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "left-pad");
      });

      it("classifies an installable legacy uppercase npm package", async () => {
        const error = await loadFailure(
          "vf-config-uppercase-package-",
          `throw new Error("Cannot find package 'JSONStream' imported from /app/veryfront.config.ts");\n`,
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "JSONStream");
      });

      it("classifies an installable scoped npm package whose name starts with underscore", async () => {
        const error = await loadFailure(
          "vf-config-scoped-underscore-package-",
          `throw new Error("Cannot find package '@scope/_plugin' imported from /app/veryfront.config.ts");\n`,
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "@scope/_plugin");
      });

      for (const packageName of ["@scope/-plugin", "@_scope/plugin"]) {
        it(`classifies npm-valid punctuation in ${packageName}`, async () => {
          const error = await loadFailure(
            "vf-config-scoped-punctuation-package-",
            `throw new Error("Cannot find package '${packageName}' imported from /app/veryfront.config.ts");\n`,
          );

          assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
          assertStringIncludes(error.message, packageName);
        });
      }

      it("preserves the full accepted package name in diagnostics", async () => {
        const packageName = "a".repeat(214);
        const error = await loadFailure(
          "vf-config-long-package-",
          `throw new Error("Cannot find package '${packageName}' imported from /app/veryfront.config.ts");\n`,
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, packageName);
        assertEquals(
          Object.getOwnPropertyDescriptor(error.context ?? {}, "packageName")?.value,
          packageName,
        );
      });

      it("keeps a secret in a subpath out of any package claim", async () => {
        // Falling through to the parse error routes the text through
        // summarizeConfigLoadCause, which redacts and bounds it; the
        // dependency branch must not quietly reintroduce it.
        const error = await loadFailure(
          "vf-config-subpath-secret-",
          `throw new Error("Cannot find module 'pkg/token=SUPERSECRET123'");\n`,
        );

        assert(
          !error.message.includes("SUPERSECRET123"),
          `error must not repeat the secret, got: ${error.message}`,
        );
      });

      it("bounds an oversized specifier before it reaches the message", async () => {
        const error = await loadFailure(
          "vf-config-oversized-",
          `throw new Error("Cannot find module '${"a".repeat(400)}'");\n`,
        );

        assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        assert(
          error.message.length < 320,
          `error must bound the specifier, got ${error.message.length} characters`,
        );
      });

      // One failure, four spellings. Node names the importer with "imported
      // from", Bun with "from '<path>'" and sometimes a `ResolveMessage:`
      // prefix, and Deno has two forms of its own.
      const missingPackageWordings: ReadonlyArray<[string, string, string]> = [
        [
          "Deno's npm-referrer form",
          "vf-config-referrer-",
          `Could not find package 'left-pad' from referrer 'file:///app/veryfront.config.ts'.`,
        ],
        [
          "Bun's from-importer form",
          "vf-config-bun-",
          `Cannot find package 'left-pad' from '/app/veryfront.config.mjs'`,
        ],
        [
          "Bun's ResolveMessage prefix",
          "vf-config-bun-resolve-",
          `ResolveMessage: Cannot find package 'left-pad' from '/app/veryfront.config.mjs'`,
        ],
        [
          "Node's imported-from form",
          "vf-config-node-",
          `Cannot find package 'left-pad' imported from /app/veryfront.config.ts`,
        ],
        [
          // A version is legitimate here, unlike on a plain specifier.
          "an npm: specifier carrying a version",
          "vf-config-npm-version-",
          `Module not found "npm:left-pad@1.3.0".`,
        ],
        [
          "Deno's hint and location trailer form",
          "vf-config-deno-trailer-",
          'Module not found "npm:left-pad".\n' +
          "  hint: If you want to use the npm package, try running `deno add npm:left-pad`\n" +
          "    at file:///app/veryfront.config.ts:1:8",
        ],
        [
          // Node CommonJS, which is what a `.js` config without `"type":
          // "module"` gets. Legitimately multi-line, so it must be matched
          // whole -- the first-line retry deliberately rejects this trailer.
          "Node's CommonJS require-stack form",
          "vf-config-cjs-",
          `Cannot find module 'left-pad'\nRequire stack:\n- /app/veryfront.config.js`,
        ],
      ];

      for (const [label, prefix, message] of missingPackageWordings) {
        it(`classifies ${label} as a missing dependency`, async () => {
          const error = await loadFailure(
            prefix,
            `throw new Error(${JSON.stringify(message)});\n`,
          );

          assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
          assert(
            error.message.includes("left-pad"),
            `error must name the unresolved package, got: ${error.message}`,
          );
        });
      }

      it("classifies npm: packages whose names match Node built-ins as missing", async () => {
        const error = await loadFailure(
          "vf-config-npm-builtin-name-",
          `throw new Error('Module not found "npm:fs".');\n`,
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "fs");
      });

      it("classifies an npm-valid leading-hyphen package as missing", async () => {
        const error = await loadFailure(
          "vf-config-leading-hyphen-",
          'import "-foo";\nexport default {};\n',
        );

        assertEquals(error.slug, DEPENDENCY_MISSING_SLUG);
        assertStringIncludes(error.message, "-foo");
      });

      // Each of these reaches the classifier through a matched resolver
      // phrasing and must still come out as a parse error, because installing
      // a package would not help any of these readers.
      const notInstallable: ReadonlyArray<[string, string, string]> = [
        [
          "a missing relative import",
          "vf-config-missing-file-",
          'import "./not-written-yet.js";\nexport default {};\n',
        ],
        [
          "a missing relative file under Bun's from-importer form",
          "vf-config-bun-relative-",
          `throw new Error("Cannot find module './missing.js' from '/app/veryfront.config.mjs'");\n`,
        ],
        [
          "a Windows UNC path",
          "vf-config-windows-",
          `throw new Error("Cannot find module '\\\\\\\\server\\\\share\\\\missing.js'");\n`,
        ],
        [
          "the project-module alias",
          "vf-config-alias-",
          'import "@/lib/config";\nexport default {};\n',
        ],
        [
          "a single-line application module error without a runtime suffix",
          "vf-config-plain-module-error-",
          `throw new Error("Cannot find module 'db'");\n`,
        ],
        [
          "a single-line application package error with an arbitrary from suffix",
          "vf-config-plain-from-error-",
          `throw new Error("Cannot find package 'db' from initialization");\n`,
        ],
        [
          "an ordinary error that merely quotes a resolver phrase",
          "vf-config-quoted-",
          `throw new Error('Setup failed: Module not found "db"');\n`,
        ],
        [
          // The first-line retry exists for Deno's `hint:`/`at` trailer. Without
          // a guard it would defeat the end anchor for *any* multi-line message,
          // and an application error's own second line would be discarded.
          "an application error whose second line is not a runtime trailer",
          "vf-config-multiline-",
          `throw new Error("Cannot find module 'db'\\ninitialization failed");\n`,
        ],
        [
          "an application error whose second line only starts with at",
          "vf-config-at-application-line-",
          `throw new Error("Cannot find module 'db'\\nat initialization");\n`,
        ],
        [
          "an application error whose second line only starts with hint",
          "vf-config-generic-hint-line-",
          `throw new Error("Cannot find module 'db'\\nhint: inspect setup");\n`,
        ],
        [
          // Only npm:/jsr: specifiers carry a version; Node and Bun cannot
          // resolve a plain `left-pad@1.3.0` at all, so this is invalid import
          // syntax rather than an absent package.
          "a version pinned onto a plain bare specifier",
          "vf-config-versioned-",
          `throw new Error("Cannot find module 'left-pad@1.3.0'");\n`,
        ],
        [
          "a package name containing whitespace",
          "vf-config-malformed-package-",
          `throw new Error("Cannot find package 'foo bar' imported from /app/veryfront.config.ts");\n`,
        ],
        [
          "an unscoped package name beginning with underscore",
          "vf-config-leading-underscore-",
          `throw new Error("Cannot find package '_foo' imported from /app/veryfront.config.ts");\n`,
        ],
        [
          "an invalid Node built-in subpath",
          "vf-config-node-builtin-subpath-",
          `throw new Error("Cannot find package 'fs' imported from /app/veryfront.config.mjs");\n`,
        ],
        [
          "the npm-reserved node_modules root",
          "vf-config-reserved-node-modules-",
          `throw new Error("Cannot find package 'node_modules' imported from /app/veryfront.config.ts");\n`,
        ],
        [
          "the npm-reserved favicon.ico root",
          "vf-config-reserved-favicon-",
          `throw new Error("Cannot find package 'favicon.ico' imported from /app/veryfront.config.ts");\n`,
        ],
        [
          "the mixed-case npm-reserved Node_Modules root",
          "vf-config-reserved-node-modules-case-",
          `throw new Error("Cannot find package 'Node_Modules' imported from /app/veryfront.config.ts");\n`,
        ],
        [
          "the mixed-case npm-reserved FAVICON.ICO root",
          "vf-config-reserved-favicon-case-",
          `throw new Error("Cannot find package 'FAVICON.ICO' imported from /app/veryfront.config.ts");\n`,
        ],
      ];

      for (const [label, prefix, source] of notInstallable) {
        it(`does not blame ${label} on an uninstalled package`, async () => {
          const error = await loadFailure(prefix, source);

          assertEquals(error.slug, CONFIG_PARSE_ERROR_SLUG);
        });
      }

      it("carries a thrown config's own message through to the reader", async () => {
        const adapter = setup();
        const projectDir = await makeTempDir({
          prefix: "vf-config-throw-cause-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        const source = 'throw new Error("DATABASE_URL is required");\n';

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          const error = await assertRejects(
            () => getConfig(projectDir, adapter),
            VeryfrontError,
          ) as VeryfrontError;

          assert(
            error.message.includes("DATABASE_URL is required"),
            `error must repeat what the config threw, got: ${error.message}`,
          );
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("bounds a hostile cause instead of pasting it into the report", async () => {
        // The cause is authored by the project being loaded. A hosted build log
        // must not become a paste surface for an arbitrarily long, arbitrarily
        // formatted string, so the summary is one line and bounded.
        const adapter = setup();
        const projectDir = await makeTempDir({
          prefix: "vf-config-cause-bound-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        const noise = "A".repeat(4096);
        const source = `throw new Error("first line\\nsecond line ${noise}");\n`;

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          const error = await assertRejects(
            () => getConfig(projectDir, adapter),
            VeryfrontError,
          ) as VeryfrontError;

          assert(
            error.message.includes("first line"),
            `error must keep the first line, got: ${error.message}`,
          );
          assert(
            !error.message.includes("second line"),
            `error must stop at the first line, got: ${error.message}`,
          );
          assert(
            error.message.length < 512,
            `error must stay bounded, got ${error.message.length} characters`,
          );
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("redacts a credential the bound would otherwise cut in half", async () => {
        // Order matters, not just presence: the redactor recognizes userinfo by
        // the trailing `@host`. Cutting the message to 200 characters first can
        // drop that `@host` and leave the password prefix behind in a detail
        // that a 400 response carries all the way to the caller, so redaction
        // has to see the complete message. The padding is sized so the password
        // straddles the 200-character bound: `https://svc:` ends at character
        // 190 and the `@` sits at 209, so an unredacted cut keeps nine
        // characters of the secret and loses the marker that identifies it.
        const adapter = setup();
        const projectDir = await makeTempDir({
          prefix: "vf-config-cause-credential-",
        });
        const configPath = `${projectDir}/veryfront.config.js`;
        const padding = "B".repeat(160);
        const password = "sup3rsecretpassword";
        const source =
          `throw new Error("upstream refused ${padding} https://svc:${password}@registry.internal/pkg");\n`;

        try {
          await Deno.writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);

          const error = await assertRejects(
            () => getConfig(projectDir, adapter),
            VeryfrontError,
          ) as VeryfrontError;

          assert(
            !error.message.includes(password),
            `error must not carry the password, got: ${error.message}`,
          );
          // A prefix of the secret is still the secret: pin the exact cut the
          // 200-character bound produces when redaction runs too late.
          assert(
            !error.message.includes(password.slice(0, 9)),
            `error must not carry a prefix of the password, got: ${error.message}`,
          );
        } finally {
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
      const projectDir = await makeTempDir({ prefix: "vf-config-js-" });
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
      const projectDir = await makeTempDir({ prefix: "vf config #project-" });
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

    describe("evaluateHostedConfigSource", () => {
      it("rejects host APIs and dynamic or relative imports without executing them", async () => {
        clearConfigCache();
        const marker = "__veryfrontExactHostedConfigMutation";
        const host = globalThis as Record<string, unknown>;
        const previousMarker = Object.getOwnPropertyDescriptor(host, marker);
        Object.defineProperty(host, marker, {
          configurable: true,
          value: 0,
          writable: true,
        });
        const sources = [
          `const hidden = false || eval("globalThis.${marker} = 1"); export default {};`,
          'const hidden = true ? null : import("./evil.ts"); export default {};',
          'import { defineConfig } from "./local.ts"; export default defineConfig({});',
        ];

        try {
          for (let index = 0; index < sources.length; index += 1) {
            const error = await assertRejects(
              () =>
                evaluateHostedConfigSource({
                  cacheKey: `exact-hostile-${index}`,
                  source: {
                    source: sources[index]!,
                    fileName: "veryfront.config.ts",
                  },
                  environmentName: "release",
                  environment: {},
                }),
              VeryfrontError,
            ) as VeryfrontError;

            assertEquals(error.slug, "config-parse-error");
            assert(error.cause instanceof DeclarativeConfigEvaluationError);
          }
          assertEquals(host[marker], 0);
        } finally {
          if (previousMarker) Object.defineProperty(host, marker, previousMarker);
          else delete host[marker];
        }
      });

      it("explains a hosted rejection after the code and reason operators correlate on", async () => {
        clearConfigCache();

        const error = await assertRejects(
          () =>
            evaluateHostedConfigSource({
              cacheKey: "exact-hosted-rejection-detail",
              source: {
                source: `import extOther from "some-third-party-extension";\n` +
                  `export default { extensions: [extOther()] };\n`,
                fileName: "veryfront.config.ts",
              },
              environmentName: "release",
              environment: {},
            }),
          VeryfrontError,
        ) as VeryfrontError;

        assertEquals(error.slug, "config-parse-error");
        // The pair stays first and unchanged: it is what an operator matches on.
        assertStringIncludes(
          error.detail ?? "",
          "Hosted configuration rejected (unsupported-syntax: unsupported-import)",
        );
        // The sentences after it are for the developer whose project this is.
        assertStringIncludes(error.detail ?? "", "never imports project modules");
        assertStringIncludes(error.detail ?? "", "Remove the import");
      });

      it("warns that an accepted extension declaration is ignored", async () => {
        clearConfigCache();
        const warnings: Array<{ message: string; extensions: unknown }> = [];
        const unsubscribe = __subscribeLogRecordEmitter((entry) => {
          if (entry.level === "warn") {
            warnings.push({ message: entry.message, extensions: entry.context?.extensions });
          }
        });

        try {
          const config = await evaluateHostedConfigSource({
            cacheKey: "exact-declared-extension-warning",
            source: {
              fileName: "veryfront.config.ts",
              source: `import extRedis from "@veryfront/ext-redis";\n` +
                `export default { extensions: [extRedis(), { name: "ext-db-sqlite", enabled: false }] };\n`,
            },
            environmentName: "release",
            environment: {},
          });

          assertEquals(
            config.extensions,
            [
              { name: "ext-redis" },
              { name: "ext-db-sqlite", enabled: false },
            ] as unknown as typeof config.extensions,
          );
          const declarationWarnings = warnings.filter((entry) =>
            entry.message.includes("declarations are ignored")
          );
          assertEquals(
            declarationWarnings.length,
            1,
            `the ignored declaration must be warned about exactly once, got: ${
              JSON.stringify(warnings)
            }`,
          );
          assertEquals(
            declarationWarnings[0]!.extensions,
            ["ext-redis"],
            "the warning names the ignored declaration, never the honored disable directive",
          );
        } finally {
          unsubscribe();
        }
      });

      it("binds exact release evaluation to an empty tenant environment", async () => {
        clearConfigCache();
        const envKey = "VERYFRONT_EXACT_CONFIG_HOST_SECRET_TEST";
        const previousValue = getHostEnv(envKey);
        setEnv(envKey, "host-secret");

        try {
          const config = await evaluateHostedConfigSource({
            cacheKey: "exact-release-empty-environment",
            source: {
              fileName: "veryfront.config.ts",
              source: `
                import { defineConfigWithEnv, getEnv } from "veryfront";
                export default defineConfigWithEnv((environmentName) => ({
                  title: \`\${environmentName}:\${getEnv(${JSON.stringify(envKey)}) ?? "missing"}\`,
                }));
              `,
            },
            environmentName: "release",
            environment: {},
          });

          assertEquals(config.title, "release:missing");
        } finally {
          if (previousValue === undefined) deleteEnv(envKey);
          else setEnv(envKey, previousValue);
        }
      });

      it("rejects a pre-aborted request before invoking the worker evaluator", async () => {
        clearConfigCache();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          return {};
        });
        const controller = new AbortController();
        controller.abort();

        const error = await assertRejects(
          () =>
            evaluateHostedConfigSource({
              cacheKey: "exact-release-pre-aborted",
              source: {
                source: "export default {};",
                fileName: "veryfront.config.ts",
              },
              environmentName: "release",
              environment: {},
              signal: controller.signal,
            }),
          DeclarativeConfigEvaluationError,
        ) as DeclarativeConfigEvaluationError;

        assertEquals(error.reason, "worker-aborted");
        assertEquals(evaluations, 0);
      });

      it("returns deeply frozen defaults for an absent exact source", async () => {
        clearConfigCache();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          return {};
        });

        const config = await evaluateHostedConfigSource({
          cacheKey: "exact-release-defaults",
          source: null,
          environmentName: "release",
          environment: {},
        });
        const visited = new WeakSet<object>();
        const assertDeeplyFrozen = (value: unknown): void => {
          if (
            (typeof value !== "object" && typeof value !== "function") ||
            value === null || visited.has(value)
          ) return;
          visited.add(value);
          assert(Object.isFrozen(value));
          for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && "value" in descriptor) {
              assertDeeplyFrozen(descriptor.value);
            }
          }
        };

        assertDeeplyFrozen(config);
        assertEquals(evaluations, 0);
        assertThrows(() => {
          (config as { title?: string }).title = "mutated";
        }, TypeError);
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

    it("continues hosted config discovery after an API 404", async () => {
      const adapter = setup();
      const reads: string[] = [];
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          reads.push(path);
          if (path === "/veryfront.config.js") {
            throw Object.assign(new Error("Config candidate not found"), {
              status: 404,
            });
          }
          if (path === "/veryfront.config.ts") {
            return 'export default { title: "later-candidate" };';
          }
          throw configCandidateNotFound(path);
        },
      });
      __setHostedConfigEvaluatorForTests(async () => ({
        title: "later-candidate",
      }));
      const sourceContext = {
        productionMode: false,
        branch: "feature/api-not-found",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });

      const config = await runWithRequestContext(
        {
          projectSlug: "demo",
          projectId: "project-api-not-found",
          token: "token",
          branch: sourceContext.branch,
        },
        () =>
          getHostedConfig("/hosted-api-not-found", adapter, {
            cacheKey: "project-api-not-found",
            sourceContext,
            preparedContext,
          }),
      );

      assertEquals(reads, ["/veryfront.config.js", "/veryfront.config.ts"]);
      assertEquals(config.title, "later-candidate");
    });

    it("surfaces the 404 when every hosted candidate is missing at the API layer", async () => {
      // A release that publishes no config at all must keep 404ing out of
      // getHostedConfig: adapter-factory reads that 404 as "hosted-absent" and
      // substitutes process-wide defaults. Continuing discovery past a
      // candidate 404 must not convert total absence into a synthesized
      // default config.
      const adapter = setup();
      const reads: string[] = [];
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: (path: string) => {
          reads.push(path);
          return Promise.reject(
            Object.assign(new Error("API request failed: 404 Not Found"), {
              status: 404,
            }),
          );
        },
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/api-all-not-found",
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
              projectId: "project-api-all-not-found",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted-api-all-not-found", adapter, {
                cacheKey: "project-api-all-not-found",
                sourceContext,
                preparedContext,
              }),
          ),
        VeryfrontError,
      ) as VeryfrontError;

      // Every candidate was tried before giving up.
      assertEquals(reads, [
        "/veryfront.config.js",
        "/veryfront.config.ts",
        "/veryfront.config.mjs",
      ]);
      // The 404 survives on the cause chain, where adapter-factory's
      // hasNotFoundStatus finds it and reports the config as hosted-absent.
      assertEquals(error.slug, "config-parse-error");
      assertEquals((error.cause as { status?: number }).status, 404);
    });

    it("normalizes a proxy-backed hosted config read failure without invoking traps", async () => {
      const adapter = setup();
      let descriptorTrapCalls = 0;
      const hostileError = new Proxy(new Error("backend details"), {
        getOwnPropertyDescriptor() {
          descriptorTrapCalls += 1;
          throw new Error("descriptor trap must not run");
        },
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async () => {
          throw hostileError;
        },
      });
      const sourceContext = {
        productionMode: false,
        branch: "feature/proxy-backend-failure",
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
              projectId: "project-proxy-failure",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted-proxy-failure", adapter, {
                cacheKey: "project-proxy-failure",
                sourceContext,
                preparedContext,
              }),
          ),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "config-parse-error");
      assertEquals(descriptorTrapCalls, 0);
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

    it("rejects hosted cache capabilities and capacity before credential lookup or construction", async () => {
      const adapter = setup();
      const sourceContext = {
        productionMode: false,
        branch: "feature/hosted-cache-policy",
      } as const;
      const preparedContext = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      let hostedSource = "";
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          return hostedSource;
        },
      });

      const originalEnvGet = Deno.env.get.bind(Deno.env);
      let redisCredentialReads = 0;
      let downstreamConstructionAttempts = 0;
      const restoreEnvGet = replacePropertyForTest(Deno.env, "get", {
        value: (key: string): string | undefined => {
          if (key === "REDIS_PASSWORD" || key === "REDIS_USERNAME") {
            redisCredentialReads += 1;
            throw new Error("Hosted config must not read host Redis credentials");
          }
          return originalEnvGet(key);
        },
      });

      try {
        const loadThenConstruct = async (projectId: string) => {
          const config = await runWithRequestContext(
            {
              projectSlug: projectId,
              projectId,
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig(`/hosted-cache-policy/${projectId}`, adapter, {
                cacheKey: projectId,
                sourceContext,
                preparedContext,
              }),
          );
          downstreamConstructionAttempts += 1;
          return config;
        };

        for (
          const [projectId, source, reason] of [
            [
              "hosted-cache-distributed",
              `export default {
                cache: {
                  render: {
                    type: "distributed",
                  },
                },
              };`,
              "hosted-render-cache-backend",
            ],
            [
              "hosted-cache-capacity",
              `export default {
                cache: {
                  render: {
                    maxEntries: ${MAX_HOSTED_RENDER_CACHE_ENTRIES + 1},
                  },
                },
              };`,
              "hosted-render-cache-capacity",
            ],
            [
              "hosted-cache-bundle",
              `export default {
                cache: {
                  bundleManifest: { type: "distributed" },
                },
              };`,
              "hosted-bundle-manifest-backend",
            ],
            [
              "hosted-cache-future",
              `export default {
                cache: {
                  futurePersistentCache: { path: ".tenant-cache" },
                },
              };`,
              "hosted-cache-option",
            ],
          ] as const
        ) {
          hostedSource = source;
          const error = await assertRejects(
            () => loadThenConstruct(projectId),
            VeryfrontError,
          ) as VeryfrontError;
          assertEquals(error.slug, "config-parse-error");
          assert(error.cause instanceof DeclarativeConfigEvaluationError);
          const cause = error.cause as DeclarativeConfigEvaluationError;
          assertEquals(cause.code, "unsupported-hosted-feature");
          assertEquals(cause.phase, "result");
          assertEquals(cause.reason, reason);
          assertEquals(cause.retryable, false);
          assertEquals(cause.location?.fileName, "veryfront.config.ts");
        }
        assertEquals(redisCredentialReads, 0);
        assertEquals(downstreamConstructionAttempts, 0);
      } finally {
        restoreEnvGet();
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

      const error = await assertRejects(
        () =>
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
          ),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(
        error.slug,
        "cache-invariant-violation",
        "hosted multi-project getConfig without context must fail as a cache invariant violation",
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

    it("frames hosted source and environment identities without inherited toJSON hooks", async () => {
      const adapter = setup();
      const sourceContext = {
        productionMode: true,
        releaseId: "release-framed-identity",
        environmentName: "Production",
      } as const;
      const requestContext = {
        projectSlug: "framed-identity",
        projectId: "framed-identity",
        token: "token",
        productionMode: true,
        releaseId: sourceContext.releaseId,
        environmentName: sourceContext.environmentName,
      } as const;
      let source = "source-a";
      let reads = 0;
      let evaluations = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          reads += 1;
          return source;
        },
      });
      const tenantA = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: { TENANT: "tenant-a" },
      });
      const tenantB = await prepareDeclarativeConfigContext({
        environmentName: "Production",
        environment: { TENANT: "tenant-b" },
      });
      __setHostedConfigEvaluatorForTests(async (payload) => {
        evaluations += 1;
        const environment = payload.evaluationOptions.environment as Record<string, string>;
        return {
          title: `${environment.TENANT}:${payload.evaluationOptions.source}`,
        };
      });

      let inheritedIdentityHookCalls = 0;
      const restore = [
        definePropertyForTest(Array.prototype, "toJSON", {
          value: () => {
            inheritedIdentityHookCalls += 1;
            throw new Error("inherited Array toJSON must not participate in config identity");
          },
          writable: true,
        }),
        definePropertyForTest(Object.prototype, "toJSON", {
          value: function (this: unknown): string {
            // Logger serialization deliberately snapshots general toJSON
            // values. Count only the array shape used by the legacy cache
            // identity serializer.
            if (Array.isArray(this)) {
              inheritedIdentityHookCalls += 1;
              throw new Error(
                "inherited Object toJSON must not participate in config identity",
              );
            }
            return "non-identity-test-value";
          },
          writable: true,
        }),
      ];
      const load = (preparedContext: typeof tenantA) =>
        runWithRequestContext(
          requestContext,
          () =>
            getHostedConfig("/framed-hosted-identity", adapter, {
              cacheKey: requestContext.projectId,
              sourceContext,
              preparedContext,
            }),
        );

      let first: Awaited<ReturnType<typeof load>> | undefined;
      let repeated: Awaited<ReturnType<typeof load>> | undefined;
      let changedEnvironment: Awaited<ReturnType<typeof load>> | undefined;
      let changedSource: Awaited<ReturnType<typeof load>> | undefined;
      try {
        first = await load(tenantA);
        repeated = await load(tenantA);
        changedEnvironment = await load(tenantB);
        source = "source-b";
        changedSource = await load(tenantB);
      } finally {
        for (let index = restore.length - 1; index >= 0; index -= 1) {
          restore[index]!();
        }
      }

      assertEquals(inheritedIdentityHookCalls, 0);
      assertEquals(first?.title, "tenant-a:source-a");
      assert(first === repeated, "equivalent source and environment identities must reuse cache");
      assertEquals(changedEnvironment?.title, "tenant-b:source-a");
      assert(
        changedEnvironment !== repeated,
        "different tenant environment fingerprints must not share config cache entries",
      );
      assertEquals(changedSource?.title, "tenant-b:source-b");
      assert(
        changedSource !== changedEnvironment,
        "different source digests must not share config cache entries",
      );
      assertEquals(evaluations, 3);
      assertEquals(reads, 4);
    });

    describe("hosted config negative caching", () => {
      const productionSourceContext = {
        productionMode: true,
        releaseId: "release-negative-cache",
        environmentName: "Production",
      } as const;
      type PreparedContext = Awaited<
        ReturnType<typeof prepareDeclarativeConfigContext>
      >;
      type TestAdapter = ReturnType<typeof setup>;

      function createHostedAdapter(
        readSource: () => string = () => 'export default { title: "source" };',
      ): TestAdapter {
        const adapter = setup();
        Object.assign(adapter.fs, {
          getUnderlyingAdapter: () => adapter.fs,
          isMultiProjectMode: () => true,
          isVeryfrontAdapter: () => true,
          exists: async (path: string) => path === "/veryfront.config.ts",
          readFile: async (path: string) => {
            if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
            return readSource();
          },
        });
        return adapter;
      }

      function loadProductionHostedConfig(
        adapter: TestAdapter,
        preparedContext: PreparedContext,
      ) {
        const projectId = "project-negative-cache";
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
            }),
        );
      }

      function prepareProductionContext(): Promise<PreparedContext> {
        return prepareDeclarativeConfigContext({
          environmentName: "Production",
          environment: { TENANT: "tenant" },
        });
      }

      it("does not re-evaluate a deterministically rejected hosted config on later requests", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          throw new DeclarativeConfigEvaluationError({
            code: "forbidden-capability",
            phase: "validate",
            reason: "unsupported-call",
          });
        });

        const first = await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        ) as VeryfrontError;
        const second = await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        ) as VeryfrontError;

        assertEquals(first.slug, "config-parse-error");
        assertEquals(second.slug, "config-parse-error");
        assertStringIncludes(
          first.detail ?? "",
          "Hosted configuration rejected (forbidden-capability: unsupported-call)",
        );
        assertStringIncludes(
          second.detail ?? "",
          "Hosted configuration rejected (forbidden-capability: unsupported-call)",
        );
        assertEquals(
          evaluations,
          1,
          "a deterministic rejection must be negatively cached, not re-evaluated per request",
        );
      });

      it("re-evaluates a rejected hosted config after the source changes", async () => {
        let source = "const forbidden = process.env;\nexport default { title: 'source' };";
        const adapter = createHostedAdapter(() => source);
        const preparedContext = await prepareProductionContext();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          if (evaluations === 1) {
            throw new DeclarativeConfigEvaluationError({
              code: "forbidden-capability",
              phase: "validate",
              reason: "unsupported-call",
            });
          }
          return { title: "corrected" };
        });

        await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        );
        source = 'export default { title: "corrected" };';
        const corrected = await loadProductionHostedConfig(adapter, preparedContext);

        assertEquals(corrected.title, "corrected");
        assertEquals(evaluations, 2);
      });

      it("re-evaluates a rejected hosted config after clearConfigCache", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          throw new DeclarativeConfigEvaluationError({
            code: "forbidden-capability",
            phase: "validate",
            reason: "unsupported-call",
          });
        });

        await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        );
        clearConfigCache();
        await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        );

        assertEquals(evaluations, 2);
      });

      it("never negatively caches retryable infrastructure failures", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          if (evaluations === 1) {
            throw new DeclarativeConfigEvaluationError({
              code: "evaluator-unavailable",
              phase: "worker",
              reason: "worker-timeout",
              retryable: true,
            });
          }
          return { title: "recovered" };
        });

        await assertRejects(
          () => loadProductionHostedConfig(adapter, preparedContext),
          VeryfrontError,
        );
        const recovered = await loadProductionHostedConfig(adapter, preparedContext);

        assertEquals(recovered.title, "recovered");
        assertEquals(evaluations, 2);
      });
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

      it("settles an aborted caller while its admitted filesystem read remains blocked", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const readStarted = Promise.withResolvers<void>();
        const releaseRead = Promise.withResolvers<void>();
        const controller = new AbortController();
        let evaluations = 0;
        adapter.fs.readFile = async (path: string) => {
          if (path === "/veryfront.config.js") {
            readStarted.resolve();
            await releaseRead.promise;
            throw configCandidateNotFound(path);
          }
          if (path === "/veryfront.config.ts") {
            return 'export default { title: "source" };';
          }
          throw configCandidateNotFound(path);
        };
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          return { title: "must-not-evaluate" };
        });

        const request = loadProductionHostedConfig(adapter, preparedContext, {
          signal: controller.signal,
        });
        try {
          await readStarted.promise;
          await waitForHostedSourceReadState({
            active: 1,
            queued: 0,
            flights: 1,
            waiters: 1,
          });

          const failure = assertRejects(
            () => request,
            DeclarativeConfigEvaluationError,
          ) as Promise<DeclarativeConfigEvaluationError>;
          controller.abort();
          const error = await failure;
          assertEquals(error.reason, "worker-aborted");
          await waitForHostedSourceReadState({
            active: 1,
            queued: 0,
            flights: 1,
            waiters: 0,
          });
          assertEquals(evaluations, 0);
        } finally {
          releaseRead.resolve();
          await Promise.allSettled([request]);
        }
        await waitForHostedSourceReadState({
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
        });
      });

      it("coalesces one immutable production read before distinct environment evaluations", async () => {
        const adapter = createHostedAdapter();
        const firstContext = await prepareDeclarativeConfigContext({
          environmentName: "Production",
          environment: { TENANT: "tenant-a" },
        });
        const secondContext = await prepareDeclarativeConfigContext({
          environmentName: "Production",
          environment: { TENANT: "tenant-b" },
        });
        const readStarted = Promise.withResolvers<void>();
        const releaseRead = Promise.withResolvers<void>();
        let reads = 0;
        let evaluations = 0;
        adapter.fs.readFile = async (path: string) => {
          if (path !== "/veryfront.config.js") throw configCandidateNotFound(path);
          reads += 1;
          readStarted.resolve();
          await releaseRead.promise;
          return 'export default { title: "source" };';
        };
        __setHostedConfigEvaluatorForTests(async (payload) => {
          evaluations += 1;
          const environment = payload.evaluationOptions.environment as Record<
            string,
            string
          >;
          return { title: environment.TENANT ?? "missing" };
        });

        const first = loadProductionHostedConfig(adapter, firstContext);
        let second: ReturnType<typeof loadProductionHostedConfig> | undefined;
        try {
          await readStarted.promise;
          second = loadProductionHostedConfig(adapter, secondContext);
          await waitForHostedSourceReadState({
            active: 1,
            queued: 0,
            flights: 1,
            waiters: 2,
          });
          assertEquals(reads, 1);
          releaseRead.resolve();

          const [firstConfig, secondConfig] = await Promise.all([first, second]);
          assertEquals(firstConfig.title, "tenant-a");
          assertEquals(secondConfig.title, "tenant-b");
          assert(firstConfig !== secondConfig);
          assertEquals(evaluations, 2);
          assertEquals(reads, 1);
        } finally {
          releaseRead.resolve();
          await Promise.allSettled(
            [first, second].filter(
              (request): request is ReturnType<typeof loadProductionHostedConfig> =>
                request !== undefined,
            ),
          );
        }
        await waitForHostedSourceReadState({
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
        });
      });

      it("keeps concurrent preview reads distinct so each can observe its source snapshot", async () => {
        const adapter = createHostedAdapter();
        const sourceContext = {
          productionMode: false,
          branch: "feature/mutable-concurrent-source",
        } as const;
        const preparedContext = await prepareDeclarativeConfigContext({
          environmentName: "preview",
          environment: {},
        });
        const readStarted = [
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
        ] as const;
        const releaseRead = [
          Promise.withResolvers<void>(),
          Promise.withResolvers<void>(),
        ] as const;
        let revision = "first-source";
        let reads = 0;
        adapter.fs.readFile = async (path: string) => {
          if (path !== "/veryfront.config.js") throw configCandidateNotFound(path);
          const index = reads;
          const source = revision;
          reads += 1;
          readStarted[index]?.resolve();
          await releaseRead[index]!.promise;
          return source;
        };
        __setHostedConfigEvaluatorForTests(async (payload) => ({
          title: payload.evaluationOptions.source,
        }));
        const load = () =>
          runWithRequestContext(
            {
              projectSlug: "mutable-concurrent-project",
              projectId: "mutable-concurrent-project",
              token: "token",
              branch: sourceContext.branch,
            },
            () =>
              getHostedConfig("/hosted/mutable-concurrent-project", adapter, {
                cacheKey: "mutable-concurrent-project",
                sourceContext,
                preparedContext,
              }),
          );

        const first = load();
        let second: ReturnType<typeof load> | undefined;
        try {
          await readStarted[0].promise;
          revision = "second-source";
          second = load();
          await readStarted[1].promise;
          await waitForHostedSourceReadState({
            active: 2,
            queued: 0,
            flights: 2,
            waiters: 2,
          });
          const admission = __getHostedConfigSourceReadStateForTests();
          assert(admission.active <= admission.maxActive);
          assertEquals(reads, 2);

          releaseRead[1].resolve();
          const secondConfig = await second;
          releaseRead[0].resolve();
          const firstConfig = await first;
          assertEquals(firstConfig.title, "first-source");
          assertEquals(secondConfig.title, "second-source");
        } finally {
          for (const release of releaseRead) release.resolve();
          await Promise.allSettled(
            [first, second].filter(
              (request): request is ReturnType<typeof load> => request !== undefined,
            ),
          );
        }
        await waitForHostedSourceReadState({
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
        });
      });

      it("bounds source reads and retains orphaned active reads until capacity really recovers", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const releaseReads = Promise.withResolvers<void>();
        const admission = __getHostedConfigSourceReadStateForTests();
        const uniqueFlightCount = admission.maxActive + admission.maxQueued;
        const uniqueProjectIds = Array.from(
          { length: uniqueFlightCount },
          (_, index) => `source-read-bounded-${index}`,
        );
        const projectIds = [uniqueProjectIds[0]!, ...uniqueProjectIds];
        const controllers = projectIds.map(() => new AbortController());
        let reads = 0;
        const readProjectIds: Array<string | undefined> = [];
        adapter.fs.readFile = async (path: string) => {
          if (path !== "/veryfront.config.js") throw configCandidateNotFound(path);
          reads += 1;
          readProjectIds.push(getCurrentRequestContext()?.projectId);
          await releaseReads.promise;
          return 'export default { title: "source" };';
        };
        __setHostedConfigEvaluatorForTests(async () => ({
          title: "capacity-recovered",
        }));

        const pending = projectIds.map((projectId, index) =>
          loadProductionHostedConfig(adapter, preparedContext, {
            projectId,
            signal: controllers[index]!.signal,
          })
        );
        let recovered:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        try {
          await waitForHostedSourceReadState({
            active: admission.maxActive,
            queued: admission.maxQueued,
            flights: uniqueFlightCount,
            waiters: uniqueFlightCount + 1,
          });
          assertEquals(reads, admission.maxActive);

          const overflow = await assertRejects(
            () =>
              loadProductionHostedConfig(adapter, preparedContext, {
                projectId: "source-read-bounded-overflow",
              }),
            VeryfrontError,
          ) as VeryfrontError;
          assertEquals(overflow.slug, "service-overloaded");
          assert(overflow.cause instanceof DeclarativeConfigEvaluationError);
          assertEquals(
            (overflow.cause as DeclarativeConfigEvaluationError).reason,
            "worker-overloaded",
          );

          const failures = pending.map((request) =>
            assertRejects(() => request, DeclarativeConfigEvaluationError)
          );
          for (const controller of controllers) controller.abort();
          await Promise.all(failures);
          await waitForHostedSourceReadState({
            active: admission.maxActive,
            queued: 0,
            flights: admission.maxActive,
            waiters: 0,
          });
          assertEquals(reads, admission.maxActive);

          recovered = loadProductionHostedConfig(adapter, preparedContext, {
            projectId: "source-read-bounded-recovered",
          });
          await waitForHostedSourceReadState({
            active: admission.maxActive,
            queued: 1,
            flights: admission.maxActive + 1,
            waiters: 1,
          });
          assertEquals(reads, admission.maxActive);

          releaseReads.resolve();
          const config = await recovered;
          assertEquals(config.title, "capacity-recovered");
          assertEquals(reads, admission.maxActive + 1);
          assertEquals(
            readProjectIds[readProjectIds.length - 1],
            "source-read-bounded-recovered",
          );
        } finally {
          for (const controller of controllers) controller.abort();
          releaseReads.resolve();
          await Promise.allSettled([
            ...pending,
            ...(recovered ? [recovered] : []),
          ]);
        }
        await waitForHostedSourceReadState({
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
        });
      });

      it("uses captured abort and TextDecoder primordials for Uint8Array hosted sources", async () => {
        const adapter = createHostedAdapter();
        const firstContext = await prepareProductionContext();
        const secondContext = await prepareDeclarativeConfigContext({
          environmentName: "Production",
          environment: { TENANT: "poison-reset" },
        });
        const sourceBytes = new TextEncoder().encode(
          'export default { title: "byte-source" };',
        );
        const callerController = new AbortController();
        const callerSignal = callerController.signal;
        const secondEvaluationStarted = Promise.withResolvers<void>();
        const releaseSecondEvaluation = Promise.withResolvers<void>();
        let secondEvaluationSignal: AbortSignal | undefined;
        let evaluations = 0;
        Object.assign(adapter.fs, {
          readFile: async (path: string) => {
            if (path !== "/veryfront.config.js") throw configCandidateNotFound(path);
            return sourceBytes;
          },
        });
        __setHostedConfigEvaluatorForTests(async (_payload, options) => {
          evaluations += 1;
          if (evaluations === 1) return { title: "decoded-byte-source" };
          secondEvaluationSignal = options?.signal;
          secondEvaluationStarted.resolve();
          await releaseSecondEvaluation.promise;
          return { title: "must-be-aborted-by-reset" };
        });

        const abortSignalAborted = TestObjectGetOwnPropertyDescriptor(
          AbortSignal.prototype,
          "aborted",
        )?.get;
        if (!abortSignalAborted) throw new Error("Expected AbortSignal aborted getter");
        const abortSignalPrototype = AbortSignal.prototype;
        const textDecoderPrototype = TextDecoder.prototype;
        let poisonCalls = 0;
        const descriptorPoisonCalls: string[] = [];
        const poison = (): never => {
          poisonCalls += 1;
          throw new Error("ambient loader lifecycle primordial must not run");
        };
        const restore: Array<() => void> = [];
        let secondRequest:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        try {
          const replace = (
            target: object,
            key: PropertyKey,
            descriptor: PropertyDescriptor,
          ): void => {
            restore.push(replacePropertyForTest(target, key, descriptor));
          };
          replace(globalThis, "TextDecoder", { value: poison });
          replace(textDecoderPrototype, "decode", { value: poison });
          replace(AbortController.prototype, "signal", { get: poison });
          replace(AbortController.prototype, "abort", { value: poison });
          replace(AbortSignal.prototype, "aborted", { get: poison });
          replace(EventTarget.prototype, "addEventListener", { value: poison });
          replace(EventTarget.prototype, "removeEventListener", {
            value: poison,
          });
          for (
            const descriptorField of [
              "value",
              "writable",
              "get",
              "enumerable",
              "configurable",
            ] as const
          ) {
            const descriptorPoison = function (this: unknown): unknown {
              if (typeof this !== "object" || this === null) return undefined;
              const value = TestObjectGetOwnPropertyDescriptor(this, "value")
                ?.value;
              const getter = TestObjectGetOwnPropertyDescriptor(this, "get")
                ?.value;
              const isLoaderSignalDataDescriptor = typeof value === "object" &&
                value !== null &&
                TestReflectApply(
                    TestObjectGetPrototypeOf,
                    Object,
                    [value],
                  ) === abortSignalPrototype;
              const getterName = typeof getter === "function"
                ? TestObjectGetOwnPropertyDescriptor(getter, "name")?.value
                : undefined;
              if (
                isLoaderSignalDataDescriptor ||
                getterName === "intrinsicSignalAbortedOwnGetter"
              ) {
                descriptorPoisonCalls.push(descriptorField);
                return poison();
              }
              return undefined;
            };
            restore.push(
              defineNullPrototypeAccessorForTest(
                Object.prototype,
                descriptorField,
                descriptorPoison,
                descriptorPoison,
              ),
            );
          }

          const first = await loadProductionHostedConfig(adapter, firstContext, {
            projectId: "captured-byte-source",
            signal: callerSignal,
          });
          assertEquals(first.title, "decoded-byte-source");

          secondRequest = loadProductionHostedConfig(adapter, secondContext, {
            projectId: "captured-byte-source-reset",
            signal: callerSignal,
          });
          await secondEvaluationStarted.promise;
          __setHostedConfigEvaluatorForTests();
          assert(secondEvaluationSignal);
          assertEquals(
            TestReflectApply(abortSignalAborted, secondEvaluationSignal, []),
            true,
          );
          releaseSecondEvaluation.resolve();
          const error = await assertRejects(
            () => secondRequest!,
            DeclarativeConfigEvaluationError,
          ) as DeclarativeConfigEvaluationError;
          assertEquals(error.reason, "worker-aborted");
          assertEquals(
            poisonCalls,
            0,
            `Descriptor poison calls: ${descriptorPoisonCalls.join(", ")}`,
          );
        } finally {
          releaseSecondEvaluation.resolve();
          await Promise.allSettled(
            secondRequest ? [secondRequest] : [],
          );
          for (let index = restore.length - 1; index >= 0; index -= 1) {
            restore[index]!();
          }
          __setHostedConfigEvaluatorForTests();
        }
        assertEquals(poisonCalls, 0);
        await waitForHostedSourceReadState({
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
        });
      });

      it("keeps WebIDL conversion and source-read FIFO independent of poisoned prototypes", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const sourceBytes = new TextEncoder().encode(
          'export default { title: "poison-safe-source" };',
        );
        const firstReadStarted = Promise.withResolvers<void>();
        const secondReadStarted = Promise.withResolvers<void>();
        const thirdReadStarted = Promise.withResolvers<void>();
        const fourthReadStarted = Promise.withResolvers<void>();
        const releaseFirstRead = Promise.withResolvers<void>();
        const releaseSecondRead = Promise.withResolvers<void>();
        const releaseThirdRead = Promise.withResolvers<void>();
        const releaseFourthRead = Promise.withResolvers<void>();
        const firstEvaluationStarted = Promise.withResolvers<void>();
        const releaseFirstEvaluation = Promise.withResolvers<void>();
        let fourthStarted = false;
        Object.assign(adapter.fs, {
          readFile: async (path: string) => {
            if (path !== "/veryfront.config.js") throw configCandidateNotFound(path);
            switch (getCurrentRequestContext()?.projectId) {
              case "prototype-poison-first":
                firstReadStarted.resolve();
                await releaseFirstRead.promise;
                break;
              case "prototype-poison-second":
                secondReadStarted.resolve();
                await releaseSecondRead.promise;
                break;
              case "prototype-poison-third":
                thirdReadStarted.resolve();
                await releaseThirdRead.promise;
                break;
              case "prototype-poison-fourth":
                fourthStarted = true;
                fourthReadStarted.resolve();
                await releaseFourthRead.promise;
                break;
              default:
                throw new Error("Unexpected source-read request context");
            }
            return sourceBytes;
          },
        });
        let evaluations = 0;
        __setHostedConfigEvaluatorForTests(async () => {
          evaluations += 1;
          if (evaluations === 1) {
            firstEvaluationStarted.resolve();
            await releaseFirstEvaluation.promise;
          }
          return { title: "poison-safe-source" };
        });

        let poisonCalls = 0;
        const poison = (): never => {
          poisonCalls += 1;
          throw new Error("inherited WebIDL or array-index hook must not run");
        };
        const inheritedArrayIndexGetter = (): undefined => undefined;
        const inheritedArrayIndexSetter = function (
          this: unknown,
          value: unknown,
        ): void {
          const queuedState = typeof value === "object" && value !== null
            ? TestObjectGetOwnPropertyDescriptor(value, "state")?.value
            : undefined;
          const waiterCount = typeof value === "object" && value !== null
            ? TestObjectGetOwnPropertyDescriptor(value, "waiterCount")?.value
            : undefined;
          if (queuedState === "queued" && typeof waiterCount === "number") {
            poison();
          }
          if ((typeof this !== "object" && typeof this !== "function") || this === null) {
            poison();
          }
          const descriptor = TestReflectApply(
            TestObjectCreate,
            Object,
            [null],
          ) as PropertyDescriptor;
          descriptor.value = value;
          descriptor.writable = true;
          descriptor.enumerable = true;
          descriptor.configurable = true;
          TestReflectApply(TestObjectDefineProperty, Object, [
            this,
            "0",
            descriptor,
          ]);
        };
        let restoreCapture: (() => void) | undefined;
        let restoreIgnoreBOM: (() => void) | undefined;
        let restoreArrayIndex: (() => void) | undefined;
        let first:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        let second:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        let third:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        let fourth:
          | ReturnType<typeof loadProductionHostedConfig>
          | undefined;
        let firstConfig:
          | Awaited<ReturnType<typeof loadProductionHostedConfig>>
          | undefined;
        let secondConfig:
          | Awaited<ReturnType<typeof loadProductionHostedConfig>>
          | undefined;
        let thirdConfig:
          | Awaited<ReturnType<typeof loadProductionHostedConfig>>
          | undefined;
        let fourthConfig:
          | Awaited<ReturnType<typeof loadProductionHostedConfig>>
          | undefined;
        let queuedState:
          | ReturnType<typeof __getHostedConfigSourceReadStateForTests>
          | undefined;
        let fifoState:
          | ReturnType<typeof __getHostedConfigSourceReadStateForTests>
          | undefined;
        let finalState:
          | ReturnType<typeof __getHostedConfigSourceReadStateForTests>
          | undefined;
        let fourthStartedBeforeItsTurn = false;
        try {
          restoreCapture = defineNullPrototypeAccessorForTest(
            Object.prototype,
            "capture",
            poison,
            poison,
          );
          restoreIgnoreBOM = defineNullPrototypeAccessorForTest(
            Object.prototype,
            "ignoreBOM",
            poison,
            poison,
          );
          restoreArrayIndex = defineNullPrototypeAccessorForTest(
            Array.prototype,
            "0",
            inheritedArrayIndexGetter,
            inheritedArrayIndexSetter,
          );

          first = loadProductionHostedConfig(adapter, preparedContext, {
            projectId: "prototype-poison-first",
            signal: new AbortController().signal,
          });
          await firstReadStarted.promise;
          second = loadProductionHostedConfig(adapter, preparedContext, {
            projectId: "prototype-poison-second",
            signal: new AbortController().signal,
          });
          await secondReadStarted.promise;
          third = loadProductionHostedConfig(adapter, preparedContext, {
            projectId: "prototype-poison-third",
            signal: new AbortController().signal,
          });
          fourth = loadProductionHostedConfig(adapter, preparedContext, {
            projectId: "prototype-poison-fourth",
            signal: new AbortController().signal,
          });

          for (let attempt = 0; attempt < 100; attempt += 1) {
            queuedState = __getHostedConfigSourceReadStateForTests();
            if (
              queuedState.active === 2 &&
              queuedState.queued === 2 &&
              queuedState.flights === 4 &&
              queuedState.waiters === 4
            ) {
              break;
            }
            await Promise.resolve();
          }

          releaseFirstRead.resolve();
          await thirdReadStarted.promise;
          await firstEvaluationStarted.promise;
          // The first source selection remains leased while its caller
          // evaluates the selected config. It must therefore remain visible
          // even though its read slot has already dispatched the third read.
          fifoState = __getHostedConfigSourceReadStateForTests();
          fourthStartedBeforeItsTurn = fourthStarted;

          releaseThirdRead.resolve();
          await fourthReadStarted.promise;
          releaseFirstEvaluation.resolve();
          releaseSecondRead.resolve();
          releaseFourthRead.resolve();
          firstConfig = await first;
          secondConfig = await second;
          thirdConfig = await third;
          fourthConfig = await fourth;

          for (let attempt = 0; attempt < 100; attempt += 1) {
            finalState = __getHostedConfigSourceReadStateForTests();
            if (
              finalState.active === 0 &&
              finalState.queued === 0 &&
              finalState.flights === 0 &&
              finalState.waiters === 0
            ) {
              break;
            }
            await Promise.resolve();
          }
        } finally {
          // Restore the numeric array hook before aggregate cleanup: Deno's
          // assertion and console internals legitimately use ordinary arrays.
          restoreArrayIndex?.();
          restoreArrayIndex = undefined;
          releaseFirstRead.resolve();
          releaseSecondRead.resolve();
          releaseThirdRead.resolve();
          releaseFourthRead.resolve();
          releaseFirstEvaluation.resolve();
          await Promise.allSettled(
            [first, second, third, fourth].filter(
              (
                request,
              ): request is ReturnType<typeof loadProductionHostedConfig> => request !== undefined,
            ),
          );
          restoreIgnoreBOM?.();
          restoreCapture?.();
        }

        assertEquals(poisonCalls, 0);
        assertEquals(queuedState, {
          active: 2,
          queued: 2,
          flights: 4,
          waiters: 4,
          maxActive: 2,
          maxQueued: 16,
        });
        assertEquals(fifoState?.active, 2);
        assertEquals(fifoState?.queued, 1);
        assertEquals(fifoState?.flights, 4);
        assertEquals(fifoState?.waiters, 4);
        assertEquals(fourthStartedBeforeItsTurn, false);
        assertEquals(firstConfig?.title, "poison-safe-source");
        assertEquals(secondConfig?.title, "poison-safe-source");
        assertEquals(thirdConfig?.title, "poison-safe-source");
        assertEquals(fourthConfig?.title, "poison-safe-source");
        assertEquals(finalState, {
          active: 0,
          queued: 0,
          flights: 0,
          waiters: 0,
          maxActive: 2,
          maxQueued: 16,
        });
      });

      it("shields the captured Promise observer from poisoned constructor and species hooks", async () => {
        const source = Promise.resolve("promise-observer-safe");
        let poisonCalls = 0;
        const poison = (): never => {
          poisonCalls += 1;
          throw new Error("ambient Promise constructor hook must not run");
        };
        let restoreConstructor: (() => void) | undefined;
        let restoreSpecies: (() => void) | undefined;
        let observed: Promise<string> | undefined;
        let sourceRetainedOwnConstructor = false;
        try {
          restoreConstructor = definePropertyForTest(
            Promise.prototype,
            "constructor",
            { get: poison },
          );
          restoreSpecies = definePropertyForTest(
            Promise,
            Symbol.species,
            { get: poison },
          );

          observed = __observePromiseForTests(source);
          sourceRetainedOwnConstructor = TestObjectGetOwnPropertyDescriptor(
            source,
            "constructor",
          ) !== undefined;
        } finally {
          restoreSpecies?.();
          restoreConstructor?.();
        }

        assert(observed);
        assertEquals(await observed, "promise-observer-safe");
        assertEquals(poisonCalls, 0);
        assertEquals(sourceRetainedOwnConstructor, false);
      });

      it("shares one exact production evaluation and result across concurrent callers", async () => {
        const adapter = createHostedAdapter();
        const preparedContext = await prepareProductionContext();
        const started = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
        let selectedSourceReads = 0;
        adapter.fs.readFile = async (path: string) => {
          if (path === "/veryfront.config.ts") selectedSourceReads += 1;
          return await originalReadFile(path);
        };
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
        assertEquals(selectedSourceReads, 1);
        await waitForHostedFlightState({ flights: 0, waiters: 0 });

        const cached = await loadProductionHostedConfig(adapter, preparedContext);
        assert(cached === firstConfig);
        assertEquals(evaluations, 1);
        assertEquals(selectedSourceReads, 2);
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
        try {
          await waitForHostedFlightState({ flights: 1, waiters: 2 });
          rejectFirstEvaluation.resolve();

          const failures = await Promise.allSettled([first, second]);
          assert(failures.every((result) => result.status === "rejected"));
          assertEquals(evaluations, 1);
          await waitForHostedFlightState({ flights: 0, waiters: 0 });
        } finally {
          rejectFirstEvaluation.resolve();
          await Promise.allSettled([first, second]);
        }

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

    it("validates an explicit falsy default from a trusted virtual module", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        readFile: async () => "export default false;",
      });

      const error = await assertRejects(
        () => getConfig("/falsy-single-project-config", adapter),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "config-validation-failed");
      assertEquals(error.context, {
        field: "<root>",
        expected: "Invalid input: expected object, received boolean",
      });
    });

    it("retains named-export-only trusted virtual config modules", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        readFile: async () => 'export const title = "named-virtual-config";',
      });

      const config = await getConfig("/named-single-project-config", adapter);

      assertEquals(config.title, "named-virtual-config");
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

    it("frames trusted-flight source identities without inherited toJSON hooks", async () => {
      const adapter = setup();
      const firstReadStarted = Promise.withResolvers<void>();
      const secondReadStarted = Promise.withResolvers<void>();
      const secondLegacyIdentityObserved = Promise.withResolvers<void>();
      const resumeFirstRead = Promise.withResolvers<void>();
      const firstBranch = "feature/framed-source-a";
      const secondBranch = "feature/framed-source-b";
      let reads = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          if (path !== "/veryfront.config.ts") throw configCandidateNotFound(path);
          const branch = getCurrentRequestContext()?.branch;
          reads += 1;
          if (branch === firstBranch) {
            firstReadStarted.resolve();
            await resumeFirstRead.promise;
            return 'export default { title: "first-branch" };';
          }
          if (branch === secondBranch) {
            secondReadStarted.resolve();
            return 'export default { title: "second-branch" };';
          }
          throw new Error("unexpected trusted config branch");
        },
      });

      let inheritedIdentityHookCalls = 0;
      const restore = [
        definePropertyForTest(Array.prototype, "toJSON", {
          value: () => {
            inheritedIdentityHookCalls += 1;
            throw new Error("inherited Array toJSON must not run");
          },
          writable: true,
        }),
        definePropertyForTest(Object.prototype, "toJSON", {
          value: function (this: object): string {
            // Logger serialization deliberately snapshots general toJSON
            // values. Count only the normalized source record used by the
            // legacy trusted-flight identity serializer.
            const productionMode = TestObjectGetOwnPropertyDescriptor(
              this,
              "productionMode",
            );
            const branch = TestObjectGetOwnPropertyDescriptor(this, "branch");
            if (
              productionMode?.value === false &&
              typeof branch?.value === "string"
            ) {
              inheritedIdentityHookCalls += 1;
              if (inheritedIdentityHookCalls >= 2) {
                secondLegacyIdentityObserved.resolve();
              }
              return "collapsed-trusted-source-identity";
            }
            return "collapsed-trusted-source-identity";
          },
          writable: true,
        }),
      ];
      const load = (branch: string) =>
        runWithRequestContext(
          {
            projectSlug: "framed-trusted-source",
            projectId: "framed-trusted-source",
            token: "token",
            branch,
          },
          () => getConfig("/framed-trusted-source", adapter),
        );

      let firstRequest: ReturnType<typeof load> | undefined;
      let secondRequest: ReturnType<typeof load> | undefined;
      let first: Awaited<ReturnType<typeof load>> | undefined;
      let second: Awaited<ReturnType<typeof load>> | undefined;
      try {
        firstRequest = load(firstBranch);
        const firstProgress = await Promise.race([
          firstReadStarted.promise.then(() => "read-started" as const),
          firstRequest.then(
            () => "request-settled" as const,
            () => "request-settled" as const,
          ),
        ]);
        if (firstProgress === "request-settled") {
          await firstRequest;
          throw new Error("first trusted config request settled before its gated read");
        }
        secondRequest = load(secondBranch);
        const secondProgress = await Promise.race([
          secondReadStarted.promise.then(() => "read-started" as const),
          secondLegacyIdentityObserved.promise.then(() => "legacy-identity" as const),
          secondRequest.then(
            () => "request-settled" as const,
            () => "request-settled" as const,
          ),
        ]);
        if (secondProgress === "request-settled") {
          await secondRequest;
          throw new Error("second trusted config request settled before identity observation");
        }
        resumeFirstRead.resolve();
        [first, second] = await Promise.all([firstRequest, secondRequest]);
      } finally {
        resumeFirstRead.resolve();
        await Promise.allSettled(
          [firstRequest, secondRequest].filter(
            (request): request is ReturnType<typeof load> => request !== undefined,
          ),
        );
        for (let index = restore.length - 1; index >= 0; index -= 1) {
          restore[index]!();
        }
      }

      assertEquals(inheritedIdentityHookCalls, 0);
      assertEquals(reads, 2);
      assertEquals(first?.title, "first-branch");
      assertEquals(second?.title, "second-branch");
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
      const projectDir = await makeTempDir({ prefix: "vf-config-mjs-" });
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
      const projectDir = await makeTempDir({ prefix: "vf-config-invalid-" });
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
