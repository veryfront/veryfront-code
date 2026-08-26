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
import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { makeTempDir, waitFor, withTempDir } from "#veryfront/testing/deno-compat.ts";

/** Repeated across the config-load classification tests below. */
const CONFIG_FILE_NAME = "veryfront.config.js";
const DEPENDENCY_MISSING_SLUG = "dependency-missing";
const CONFIG_PARSE_ERROR_SLUG = "config-parse-error";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  __bunConfigHasTopLevelAwaitForTests,
  __collectBunProjectConfigModulesForTests,
  __evictBunProjectConfigModulesForTests,
  __getHostedConfigFlightStateForTests,
  __getHostedConfigSourceReadStateForTests,
  __getTrustedConfigFlightStateForTests,
  __isBunWorkspaceMemberDirectoryForTests,
  __observePromiseForTests,
  __rewriteComputedDynamicProjectConfigImportsForTests,
  __setHostedConfigEvaluatorForTests,
  clearConfigCache,
  evaluateHostedConfigSource,
  getCachedConfigSync,
  getConfig,
  getConfigWithProvenance,
  getHostedConfig,
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
      });

      it("redacts a URL tail that begins after a lone `)` and punctuation", async () => {
        // The other half of the structural rule, and the reason it is not a list
        // of characters prose may end with. Punctuation after a `)` does not make
        // the rest of the token prose -- what matters is whether anything follows
        // it. Here something does, so the tail is still URL and must be redacted.
        const period = await loadFailure(
          "vf-config-paren-tail-period-",
          `throw new Error("https://registry.internal/a).SUPERSECRET/c.ts");\n`,
        );

        assertEquals(period.message.includes("SUPERSECRET"), false);
        assertEquals(period.message.includes("registry.internal"), false);
        assertStringIncludes(period.message, "[url]");

        // `?` is why the exclusion-list spelling could not have worked. Excluding
        // it to protect `(see .../x)? Retry` would have stranded this query
        // string; including it would have mangled that sentence. The structural
        // question answers both -- `t=SUPERSECRET` follows, so this is URL.
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
                source: `import extCssLightning from "@veryfront/ext-css-lightning";\n` +
                  `export default { extensions: [extCssLightning()] };\n`,
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
