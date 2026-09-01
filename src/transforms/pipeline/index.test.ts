import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/pipeline/index.test */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import * as esbuild from "veryfront/extensions/bundler";
import { pipelineInternals, runPipeline, TransformStage, transformToESM } from "./index.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningCacheKey,
  getDependencyPinningSnapshot,
} from "../esm/package-registry.ts";
import {
  destroyTransformCache,
  generateCacheKey,
  setCachedTransformAsync,
} from "../esm/transform-cache.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setClockForTest,
  _setDependencyResolutionPosterForTest,
} from "../esm/npm-registry-client.ts";
import { computeConfigHash } from "../../cache/config-hash.ts";
import { computeShortContentHash } from "../esm/transform-utils.ts";
import { FRAMEWORK_SRC_DIR } from "#veryfront/platform/compat/framework-source-resolver.ts";

describe(
  "transformToESM readFile routing",
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    it("rejects dependency reads outside projectDir before reaching any filesystem", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-proj-" });
      const externalDir = await makeTempDir({ prefix: "vf-pipeline-ext-" });
      const mainFile = join(projectDir, "main.tsx");
      const externalFile = join(externalDir, "dep.ts");

      try {
        await writeTextFile(mainFile, "export const value = 1;");
        await writeTextFile(externalFile, "export const dep = 1;");

        const readCalls: string[] = [];
        const adapter = {
          fs: {
            readFile: async (path: string): Promise<string> => {
              readCalls.push(path);
              return await readTextFile(path);
            },
          },
        };
        const readFile = pipelineInternals.buildReadFile(adapter, projectDir);

        assertEquals(await readFile(mainFile), "export const value = 1;");
        await assertRejects(() => readFile(externalFile), Error, "outside project root");

        assertEquals(
          readCalls.includes(externalFile),
          false,
          "an escaping dependency must not reach the adapter",
        );
        assertEquals(
          readCalls.includes(mainFile),
          true,
          "in-project files must be read through the adapter so depsHash is computed",
        );
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(externalDir, { recursive: true });
      }
    });

    it("does not treat a project-directory prefix collision as contained", async () => {
      const parentDir = await makeTempDir({ prefix: "vf-pipeline-prefix-" });
      const projectDir = join(parentDir, "project");
      const collisionDir = join(parentDir, "project-external");
      const collisionFile = join(collisionDir, "dep.ts");

      try {
        await mkdir(projectDir);
        await mkdir(collisionDir);
        await writeTextFile(collisionFile, "export const dep = 1;");
        const readCalls: string[] = [];
        const readFile = pipelineInternals.buildReadFile({
          fs: {
            readFile: async (path: string): Promise<string> => {
              readCalls.push(path);
              return await readTextFile(path);
            },
          },
        }, projectDir);

        await assertRejects(() => readFile(collisionFile), Error, "outside project root");
        assertEquals(readCalls, []);
      } finally {
        await remove(parentDir, { recursive: true });
      }
    });

    it("reads verified framework sources locally without using the project adapter", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-framework-" });
      const frameworkFile = join(FRAMEWORK_SRC_DIR, "transforms/pipeline/index.ts");
      const readCalls: string[] = [];

      try {
        const readFile = pipelineInternals.buildReadFile({
          fs: {
            readFile: (path: string): Promise<string> => {
              readCalls.push(path);
              return Promise.reject(new Error("Framework source reached project adapter"));
            },
          },
        }, projectDir);

        assertStringIncludes(await readFile(frameworkFile), "function buildReadFile");
        assertEquals(readCalls, []);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("isolates module-server URL output in both sequential cache orders", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-module-base-" });
      const mainFile = join(projectDir, "main.ts");
      const source = `import "./dep.ts"; export const value = 1;`;
      const moduleServerUrl = "https://modules.example.test/_vf_modules";
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
        clearReactVersionCache();
        await writeTextFile(mainFile, source);

        for (
          const [firstBase, secondBase] of [
            [undefined, moduleServerUrl],
            [moduleServerUrl, undefined],
          ] as const
        ) {
          destroyTransformCache();
          const first = await runPipeline(source, mainFile, projectDir, {
            projectId: "module-base-cache-project",
            dev: false,
            ssr: false,
            moduleServerUrl: firstBase,
          });
          const second = await runPipeline(source, mainFile, projectDir, {
            projectId: "module-base-cache-project",
            dev: false,
            ssr: false,
            moduleServerUrl: secondBase,
          });

          assertEquals(first.cached, false);
          assertEquals(second.cached, false);
          assertEquals(
            first.code.includes(`${moduleServerUrl}/dep.js`),
            firstBase !== undefined,
          );
          assertEquals(
            second.code.includes(`${moduleServerUrl}/dep.js`),
            secondBase !== undefined,
          );
          assertEquals(first.code.includes("./dep.js"), firstBase === undefined);
          assertEquals(second.code.includes("./dep.js"), secondBase === undefined);
        }
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("invalidates cached transforms when the project import map changes", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-import-map-" });
      const mainFile = join(projectDir, "main.ts");
      const denoJsonPath = join(projectDir, "deno.json");
      const source = `import value from "project-alias"; export default value;`;
      const options = {
        projectId: "import-map-cache-project",
        dev: false,
        ssr: true,
      };

      try {
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(
          denoJsonPath,
          JSON.stringify({ imports: { "project-alias": "/project-v1.js" } }),
        );
        const first = await runPipeline(source, mainFile, projectDir, options);

        await writeTextFile(
          denoJsonPath,
          JSON.stringify({ imports: { "project-alias": "/project-v2.js" } }),
        );
        const second = await runPipeline(source, mainFile, projectDir, options);

        assertEquals(first.code.includes("/project-v1.js"), true);
        assertEquals(second.cached, false);
        assertEquals(second.code.includes("/project-v2.js"), true);
        assertEquals(second.code.includes("/project-v1.js"), false);
      } finally {
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("uses one preloaded SSR import-map snapshot for cache identity and stages", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-preloaded-map-" });
      const mainFile = join(projectDir, "main.ts");
      const denoJsonPath = join(projectDir, "deno.json");
      const source = `import value from "project-alias"; export default value;`;
      const options = {
        projectId: "preloaded-import-map-cache-project",
        dev: false,
        ssr: true,
        preloadedImportMap: {
          imports: { "project-alias": "/preloaded-v1.js" },
          scopes: {},
        },
      };

      try {
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(
          denoJsonPath,
          JSON.stringify({ imports: { "project-alias": "/disk-v2.js" } }),
        );

        const first = await runPipeline(source, mainFile, projectDir, options);
        const second = await runPipeline(source, mainFile, projectDir, options);
        const changed = await runPipeline(source, mainFile, projectDir, {
          ...options,
          preloadedImportMap: {
            imports: { "project-alias": "/preloaded-v2.js" },
            scopes: {},
          },
        });

        assertEquals(first.cached, false);
        assertEquals(first.code.includes("/preloaded-v1.js"), true);
        assertEquals(first.code.includes("/disk-v2.js"), false);
        assertEquals(second.cached, true);
        assertEquals(second.code.includes("/preloaded-v1.js"), true);
        assertEquals(changed.cached, false);
        assertEquals(changed.code.includes("/preloaded-v2.js"), true);
        assertEquals(changed.code.includes("/preloaded-v1.js"), false);
      } finally {
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("isolates identified custom plugin output and disables caching without an identity", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-custom-plugin-" });
      const mainFile = join(projectDir, "main.ts");
      const source = "export const value = 1;";
      const options = {
        projectId: "custom-plugin-cache-project",
        dev: false,
        ssr: false,
      };

      try {
        destroyTransformCache();
        const first = await runPipeline(source, mainFile, projectDir, options, {
          plugins: [{
            name: "custom-output",
            stage: TransformStage.FINALIZE,
            cacheIdentity: "custom-output@1",
            transform: (ctx) => `${ctx.code}\n/* custom-v1 */`,
          }],
        });
        const changed = await runPipeline(source, mainFile, projectDir, options, {
          plugins: [{
            name: "custom-output",
            stage: TransformStage.FINALIZE,
            cacheIdentity: "custom-output@2",
            transform: (ctx) => `${ctx.code}\n/* custom-v2 */`,
          }],
        });

        assertEquals(first.code.includes("custom-v1"), true);
        assertEquals(changed.cached, false);
        assertEquals(changed.code.includes("custom-v2"), true);
        assertEquals(changed.code.includes("custom-v1"), false);

        destroyTransformCache();
        let calls = 0;
        const unidentified = {
          plugins: [{
            name: "unidentified-output",
            stage: TransformStage.FINALIZE,
            transform: (ctx: { code: string }) => {
              calls++;
              return `${ctx.code}\n/* unidentified-${calls} */`;
            },
          }],
        };
        const uncachedFirst = await runPipeline(
          source,
          mainFile,
          projectDir,
          options,
          unidentified,
        );
        const uncachedSecond = await runPipeline(
          source,
          mainFile,
          projectDir,
          options,
          unidentified,
        );

        assertEquals(uncachedFirst.cached, false);
        assertEquals(uncachedSecond.cached, false);
        assertEquals(calls, 2);
        assertEquals(uncachedSecond.code.includes("unidentified-2"), true);
      } finally {
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("binds custom plugin execution to its cache-identity snapshot", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-plugin-snapshot-" });
      const mainFile = join(projectDir, "main.ts");
      const dependencyFile = join(projectDir, "dependency.ts");
      const source = `import "./dependency.ts"; export const value = 1;`;
      const plugin = {
        name: "mutable-output",
        stage: TransformStage.FINALIZE,
        cacheIdentity: "mutable-output@1",
        transform: (ctx: { code: string }) => `${ctx.code}\n/* snapshot-v1 */`,
      };

      try {
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(dependencyFile, "export const dependency = 1;");

        const result = await runPipeline(
          source,
          mainFile,
          projectDir,
          {
            projectId: "plugin-snapshot-cache-project",
            dev: false,
            ssr: false,
            readFile: async (path) => {
              plugin.transform = (ctx) => `${ctx.code}\n/* mutated-v2 */`;
              return await readTextFile(path);
            },
          },
          { plugins: [plugin] },
        );

        assertEquals(result.code.includes("snapshot-v1"), true);
        assertEquals(result.code.includes("mutated-v2"), false);
      } finally {
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("uses captured array operations for custom plugin execution", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-plugin-primordials-" });
      const mainFile = join(projectDir, "main.ts");
      const source = "export const value = 1;";
      const originalArrayIterator = Array.prototype[Symbol.iterator];
      const originalArraySort = Array.prototype.sort;
      const isSentinelPipeline = (values: unknown[]): boolean => {
        for (let index = 0; index < values.length; index++) {
          const value = values[index] as { name?: unknown } | undefined;
          if (value?.name === "sentinel-early" || value?.name === "sentinel-late") return true;
        }
        return false;
      };

      try {
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        Reflect.set(Array.prototype, Symbol.iterator, function (this: unknown[]) {
          const values = this as unknown[];
          if (isSentinelPipeline(values)) {
            return { next: () => ({ done: true, value: undefined }) };
          }
          return Reflect.apply(originalArrayIterator, values, []);
        });
        Reflect.set(Array.prototype, "sort", function (
          this: unknown[],
          compare?: (left: unknown, right: unknown) => number,
        ) {
          if (isSentinelPipeline(this)) return this;
          return Reflect.apply(originalArraySort, this, [compare]);
        });

        const result = await runPipeline(
          source,
          mainFile,
          projectDir,
          { projectId: "plugin-primordial-project", dev: false, ssr: false },
          {
            plugins: [{
              name: "sentinel-late",
              stage: TransformStage.FINALIZE + 0.75,
              cacheIdentity: "sentinel-late@1",
              transform: (ctx) => `${ctx.code}\n/* sentinel-late */`,
            }, {
              name: "sentinel-early",
              stage: TransformStage.FINALIZE + 0.25,
              cacheIdentity: "sentinel-early@1",
              transform: (ctx) => `${ctx.code}\n/* sentinel-early */`,
            }],
          },
        );

        assertEquals(result.code.includes("sentinel-early"), true);
        assertEquals(result.code.includes("sentinel-late"), true);
        assertEquals(
          result.code.indexOf("sentinel-early") < result.code.indexOf("sentinel-late"),
          true,
        );
      } finally {
        Reflect.set(Array.prototype, Symbol.iterator, originalArrayIterator);
        Reflect.set(Array.prototype, "sort", originalArraySort);
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("replays cached unresolved dependencies through TTL and current-snapshot gates", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-retry-replay-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = `import value from "retry-dependency"; export default value;`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const attempts: string[][] = [];
      let now = 0;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        _clearNpmVersionCache();
        _setClockForTest(() => now);
        _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
          attempts.push([...specifiers]);
          return Promise.reject(new Error("platform unavailable"));
        });
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "retry-dependency": "^1.0.0" } }),
        );

        const dependencyPinningSource = createDependencyPinningSource({
          projectDir,
          projectId: "retry-cache-project",
          isLocalProject: false,
          dependencyWritebackTarget: { kind: "main" },
        });
        const snapshotA = await getDependencyPinningSnapshot(dependencyPinningSource);
        const transformOptions = {
          projectId: "retry-cache-project",
          dev: false,
          ssr: false,
          dependencyPinningSource,
          dependencyPinningCacheKey: snapshotA.cacheKey,
          dependencyPinningDependencies: snapshotA.dependencies,
        };

        const initial = await runPipeline(
          source,
          mainFile,
          projectDir,
          transformOptions,
        );
        await _pendingResolutions();
        assertEquals(initial.cached, false);
        assertEquals(attempts, [["retry-dependency@^1.0.0"]]);

        const beforeTtl = await runPipeline(
          source,
          mainFile,
          projectDir,
          transformOptions,
        );
        await _pendingResolutions();
        assertEquals(beforeTtl.cached, true);
        assertEquals(attempts.length, 1);

        now = 60_000;
        const afterTtl = await runPipeline(
          source,
          mainFile,
          projectDir,
          transformOptions,
        );
        await _pendingResolutions();
        assertEquals(afterTtl.cached, true);
        assertEquals(attempts.length, 2);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "retry-dependency": "^2.0.0" } }),
        );
        const snapshotB = await getDependencyPinningSnapshot(dependencyPinningSource);
        assertEquals(snapshotB.cacheKey === snapshotA.cacheKey, false);

        now = 120_000;
        const historical = await runPipeline(
          source,
          mainFile,
          projectDir,
          transformOptions,
        );
        await _pendingResolutions();
        assertEquals(historical.cached, true);
        assertEquals(attempts.length, 2);
      } finally {
        await _pendingResolutions();
        _clearNpmVersionCache();
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("recomputes a legacy pin-on cache entry without dependency observations", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-legacy-pin-cache-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = `import value from "legacy-dependency"; export default value;`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const reactVersion = "19.2.4";

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "legacy-dependency": "1.2.3" } }),
        );
        const snapshot = await getDependencyPinningSnapshot(projectDir);
        const [contentHash, configHash] = await Promise.all([
          computeShortContentHash(source),
          computeConfigHash({
            reactVersion,
            jsxImportSource: "react",
            studioEmbed: false,
            dev: false,
            dependencyPinningCacheKey: snapshot.cacheKey,
          }),
        ]);
        const cacheKey = generateCacheKey(mainFile, contentHash, false, false, {
          configHash,
          projectId: "legacy-pin-cache-project",
        });

        // The old entry shape has no dependencyResolutionObservations field.
        await setCachedTransformAsync(
          cacheKey,
          "export const staleLegacyCacheEntry = true;",
          "legacy-hash",
        );

        const result = await runPipeline(source, mainFile, projectDir, {
          projectId: "legacy-pin-cache-project",
          dev: false,
          ssr: false,
          reactVersion,
          dependencyPinningCacheKey: snapshot.cacheKey,
          dependencyPinningDependencies: snapshot.dependencies,
        });

        assertEquals(result.cached, false);
        assertEquals(result.code.includes("legacy-dependency@1.2.3"), true);
        assertEquals(result.code.includes("staleLegacyCacheEntry"), false);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("warms dependency pins centrally and invalidates cached transforms on pin or flag changes", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-pins-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = `import value from "demo-dependency"; export default value;`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const adapter = {
        fs: {
          readFile: (path: string) => readTextFile(path),
        },
      };

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "demo-dependency": "1.2.3" } }),
        );

        const first = await transformToESM(source, mainFile, projectDir, adapter, {
          ssr: false,
          dev: false,
          projectId: "pin-cache-project",
        });
        assertEquals(first.includes("demo-dependency@1.2.3"), true);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "demo-dependency": "2.0.0" } }),
        );
        const changedPin = await transformToESM(source, mainFile, projectDir, adapter, {
          ssr: false,
          dev: false,
          projectId: "pin-cache-project",
        });
        assertEquals(changedPin.includes("demo-dependency@2.0.0"), true);
        assertEquals(changedPin.includes("demo-dependency@1.2.3"), false);

        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
        const flagOff = await transformToESM(source, mainFile, projectDir, adapter, {
          ssr: false,
          dev: false,
          projectId: "pin-cache-project",
        });
        assertEquals(flagOff.includes("https://esm.sh/demo-dependency?"), true);
        assertEquals(flagOff.includes("demo-dependency@2.0.0"), false);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("keeps the dependency map atomic with its cache key across interleaved warm-ups", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-pin-snapshot-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = `import value from "snapshot-dependency"; export default value;`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const adapter = { fs: { readFile: (path: string) => readTextFile(path) } };

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "snapshot-dependency": "1.0.0" } }),
        );
        const stateA = await getDependencyPinningCacheKey(projectDir);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "snapshot-dependency": "2.0.0" } }),
        );
        const stateB = await getDependencyPinningCacheKey(projectDir);
        assertEquals(stateA === stateB, false);

        const oldSnapshot = await transformToESM(source, mainFile, projectDir, adapter, {
          ssr: false,
          dev: false,
          projectId: "pin-snapshot-project",
          dependencyPinningCacheKey: stateA,
        });
        const newSnapshot = await transformToESM(source, mainFile, projectDir, adapter, {
          ssr: false,
          dev: false,
          projectId: "pin-snapshot-project",
          dependencyPinningCacheKey: stateB,
        });

        assertEquals(oldSnapshot.includes("snapshot-dependency@1.0.0"), true);
        assertEquals(oldSnapshot.includes("snapshot-dependency@2.0.0"), false);
        assertEquals(newSnapshot.includes("snapshot-dependency@2.0.0"), true);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not mutate frozen options shared by concurrent transforms", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-frozen-options-" });
      const firstFile = join(projectDir, "first.ts");
      const secondFile = join(projectDir, "second.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const sharedOptions = Object.freeze({
        ssr: false,
        dev: false,
        projectId: "frozen-options-project",
        readFile: (path: string) => readTextFile(path),
      });

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "snapshot-dependency": "1.2.3" } }),
        );

        const [first, second] = await Promise.all([
          transformToESM(
            `import value from "snapshot-dependency"; export default value;`,
            firstFile,
            projectDir,
            null,
            sharedOptions,
          ),
          transformToESM(
            `import value from "snapshot-dependency"; export const second = value;`,
            secondFile,
            projectDir,
            null,
            sharedOptions,
          ),
        ]);

        assertEquals(first.includes("snapshot-dependency@1.2.3"), true);
        assertEquals(second.includes("snapshot-dependency@1.2.3"), true);
        assertEquals("dependencyPinningCacheKey" in sharedOptions, false);
        assertEquals("dependencyPinningDependencies" in sharedOptions, false);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("keeps browser transform cache entries separate by moduleServerUrl", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-cache-proj-" });
      const mainFile = join(projectDir, "main.tsx");
      const depFile = join(projectDir, "dep.ts");

      try {
        const mainSource = `import { dep } from "./dep";
export default function App() { return dep; }`;

        await writeTextFile(mainFile, mainSource);
        await writeTextFile(depFile, "export const dep = 1;");

        const adapter = {
          fs: {
            readFile: (path: string): Promise<string> => readTextFile(path),
          },
        };

        const firstCode = await transformToESM(mainSource, mainFile, projectDir, adapter, {
          ssr: false,
          dev: true,
          projectId: "test-project",
          moduleServerUrl: "https://modules-a.example.test/_vf_modules",
        });

        const secondCode = await transformToESM(mainSource, mainFile, projectDir, adapter, {
          ssr: false,
          dev: true,
          projectId: "test-project",
          moduleServerUrl: "https://modules-b.example.test/_vf_modules",
        });

        assertStringIncludes(firstCode, "https://modules-a.example.test/_vf_modules");
        assertStringIncludes(secondCode, "https://modules-b.example.test/_vf_modules");
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });
  },
);
