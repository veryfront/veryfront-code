import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/pipeline/index.test */

import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import * as esbuild from "veryfront/extensions/bundler";
import { computeDependencyCacheIdentity } from "./dependency-cache-identity.ts";
import { runPipeline, transformToESM } from "./index.ts";
import { createPipelineReadFile } from "./read-file.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningCacheKey,
  getDependencyPinningSnapshot,
} from "../esm/package-registry.ts";
import {
  __injectCachesForTests,
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
import { computePipelineConfigIdentity } from "./cache-identity.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  type CacheRevisionMutation,
  isRevisionedCacheKey,
  type RevisionedCacheBackend,
} from "#veryfront/cache/backend.ts";
import { TransformStage } from "./types.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";

class PipelineRevisionBackend implements RevisionedCacheBackend {
  readonly type = "distributed" as const;
  readonly ordinaryCalls: string[] = [];
  readonly observations: string[] = [];
  readonly exchanges: Array<{
    key: string;
    revision: string;
    mutation: CacheRevisionMutation;
  }> = [];
  exchangeFailure?: unknown;

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.resolve(null);
  }

  set(key: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    return Promise.resolve();
  }

  getWithRevision(key: string) {
    this.observations.push(key);
    return Promise.resolve({ value: null, revision: "pipeline-r0" });
  }

  compareExchange(
    key: string,
    revision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    this.exchanges.push({ key, revision, mutation });
    if (this.exchangeFailure !== undefined) return Promise.reject(this.exchangeFailure);
    return Promise.resolve(true);
  }
}

describe(
  "transform pipeline dependency identity",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    it("uses local fs for file:// deps outside projectDir", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-proj-" });
      const externalDir = await makeTempDir({ prefix: "vf-pipeline-ext-" });
      const mainFile = join(projectDir, "main.tsx");
      const externalFile = join(externalDir, "dep.ts");

      try {
        await writeTextFile(mainFile, "export default true;");
        await writeTextFile(externalFile, "export const dep = 1;");

        const readCalls: string[] = [];
        const adapter = {
          fs: {
            readFile: async (path: string): Promise<string> => {
              readCalls.push(path);
              if (path === externalFile) {
                throw new Error(
                  "Adapter should not read external file:// dependency",
                );
              }
              return await readTextFile(path);
            },
          },
        };

        const readFile = createPipelineReadFile(adapter, projectDir);

        assertEquals(await readFile(toFileUrl(externalFile).href), "export const dep = 1;");
        assertEquals(readCalls.includes(externalFile), false);
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(externalDir, { recursive: true });
      }
    });

    it("does not route sibling-prefix paths through the project adapter", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-pipeline-boundary-" });
      const projectDir = join(tempDir, "project");
      const siblingDir = join(tempDir, "project-evil");
      const siblingFile = join(siblingDir, "entry.ts");
      const source = "export const sibling = true;";

      try {
        await mkdir(projectDir, { recursive: true });
        await mkdir(siblingDir, { recursive: true });
        await writeTextFile(siblingFile, source);

        const adapterReads: string[] = [];
        const adapter = {
          fs: {
            readFile: (path: string): Promise<string> => {
              adapterReads.push(path);
              return Promise.reject(new Error("Sibling path escaped project boundary"));
            },
          },
        };

        for (
          const [filePath, configuredProjectDir] of [
            [siblingFile, projectDir],
            [toFileUrl(siblingFile).href, `${projectDir}/`],
          ] as const
        ) {
          const readFile = createPipelineReadFile(adapter, configuredProjectDir);
          assertEquals(await readFile(filePath), source);
        }

        assertEquals(adapterReads, []);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("routes project paths through the adapter with or without a trailing slash", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-inside-" });
      const mainFile = join(projectDir, "entry file.ts");
      const source = "export const local = true;";

      try {
        await writeTextFile(mainFile, source);

        const adapterReads: string[] = [];
        const adapter = {
          fs: {
            readFile: (path: string): Promise<string> => {
              adapterReads.push(path);
              return readTextFile(path);
            },
          },
        };

        assertEquals(await createPipelineReadFile(adapter, projectDir)(mainFile), source);
        assertEquals(
          await createPipelineReadFile(adapter, `${projectDir}/`)(toFileUrl(mainFile).href),
          source,
        );

        assertEquals(adapterReads, [mainFile, mainFile]);
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

    it("prewarms a pin-on entry with the exact pipeline v3 identity", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-legacy-pin-cache-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = `import value from "legacy-dependency"; export default value;`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const reactVersion = "19.2.4";
      const backend = new PipelineRevisionBackend();

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { "legacy-dependency": "1.2.3" } }),
        );
        const snapshot = await getDependencyPinningSnapshot(projectDir);
        const [contentHash, configHash] = await Promise.all([
          computeHash(source),
          computePipelineConfigIdentity({
            reactVersion,
            jsxImportSource: "react",
            studioEmbed: false,
            dev: false,
            ssr: false,
            projectDir,
            moduleServerUrl: undefined,
            moduleServerOrigin: undefined,
            vendorBundleHash: undefined,
            apiBaseUrl: undefined,
            importMapFingerprint: undefined,
            dependencyPinningCacheKey: snapshot.cacheKey,
            customPlugins: [],
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
        assertEquals(backend.observations.length, 1);
        const handcraftedReservedKey = backend.observations[0];
        assertEquals(isRevisionedCacheKey(handcraftedReservedKey), true);
        backend.observations.length = 0;
        backend.exchanges.length = 0;

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
        assertEquals(backend.observations, [handcraftedReservedKey]);
        assertEquals(backend.ordinaryCalls, []);
      } finally {
        __injectCachesForTests(null);
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("observes the revision before a sentinel hook ordered ahead of every built-in stage", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-atomic-permit-" });
      const mainFile = join(projectDir, "main.ts");
      const packageJsonPath = join(projectDir, "package.json");
      const source = 'import value from "zod"; export default value;';
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const backend = new PipelineRevisionBackend();
      let observationCountAtFirstSentinelCondition: number | undefined;
      let observedBeforeSentinelTransform = false;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        destroyTransformCache();
        __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
        await writeTextFile(mainFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { zod: "^4" } }),
        );
        const snapshot = await getDependencyPinningSnapshot(projectDir);

        const result = await runPipeline(
          source,
          mainFile,
          projectDir,
          {
            projectId: "pipeline-atomic-permit-project",
            dev: false,
            ssr: false,
            dependencyPinningCacheKey: snapshot.cacheKey,
            dependencyPinningDependencies: snapshot.dependencies,
          },
          {
            plugins: [{
              name: "assert-revision-observed",
              // Built-in stages start at PARSE = 0. This private negative
              // stage therefore runs before every built-in condition/transform.
              stage: -1 as TransformStage,
              cacheIdentity: "assert-revision-observed@1",
              condition() {
                observationCountAtFirstSentinelCondition ??= backend.observations.length;
                return true;
              },
              transform(ctx) {
                observedBeforeSentinelTransform = backend.observations.length === 1;
                return ctx.code;
              },
            }],
          },
        );

        assertEquals(result.cached, false);
        assertEquals(observationCountAtFirstSentinelCondition, 1);
        assertEquals(observedBeforeSentinelTransform, true);
        assertEquals(backend.observations.length, 1);
        assertEquals(isRevisionedCacheKey(backend.observations[0]), true);
        assertEquals(backend.exchanges.length, 1);
        assertEquals(backend.exchanges[0]?.key, backend.observations[0]);
        assertEquals(backend.exchanges[0]?.revision, "pipeline-r0");
        const mutation = backend.exchanges[0]?.mutation;
        if (mutation?.kind !== "set") throw new Error("Expected one atomic set");
        assertEquals(JSON.parse(mutation.value).dependencyResolutionObservations, [
          { packageName: "zod", declaration: "^4" },
        ]);
        assertEquals(backend.ordinaryCalls, []);
      } finally {
        __injectCachesForTests(null);
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("logs only a safe publication-failure classification and rethrows the exact rejection", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-atomic-failure-" });
      const mainFile = join(projectDir, "main.ts");
      const source = "export const value = true;";
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const backend = new PipelineRevisionBackend();
      const backendSecret = "backend-secret-must-not-reach-logs";
      const accessorFailure = new Error(backendSecret);
      let forbiddenPropertyReads = 0;
      const rejection = Object.create(Error.prototype);
      Object.defineProperties(rejection, {
        name: {
          get() {
            forbiddenPropertyReads++;
            throw accessorFailure;
          },
        },
        message: {
          get() {
            forbiddenPropertyReads++;
            throw accessorFailure;
          },
        },
        toString: {
          value() {
            forbiddenPropertyReads++;
            throw accessorFailure;
          },
        },
        backendKey: { value: backendSecret, enumerable: true },
      });
      backend.exchangeFailure = rejection;
      const logEntries: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => logEntries.push(entry));

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
        clearReactVersionCache();
        destroyTransformCache();
        __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
        await writeTextFile(mainFile, source);

        let caught: unknown;
        try {
          await runPipeline(source, mainFile, projectDir, {
            projectId: "pipeline-atomic-failure-project",
            dev: false,
            ssr: false,
          });
        } catch (error) {
          caught = error;
        }

        assertEquals(caught === rejection, true);
        assertEquals(forbiddenPropertyReads, 0);
        const publicationLogs = logEntries.filter((entry) =>
          entry.component === "pipeline" && entry.message === "Failed to cache transform"
        );
        assertEquals(publicationLogs.length, 1);
        assertEquals(publicationLogs[0]?.context, { failureType: "object" });
        assertEquals(publicationLogs[0]?.error, undefined);
        assertEquals(JSON.stringify(publicationLogs[0]).includes(backendSecret), false);
        assertEquals(backend.observations.length, 1);
        assertEquals(backend.exchanges.length, 1);
      } finally {
        unsubscribe();
        __injectCachesForTests(null);
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

    it("marks a transform uncacheable when dependency identity cannot be computed", async () => {
      const sourceError = new Error("source store unavailable");
      const identity = await computeDependencyCacheIdentity(
        "/project/pages/index.ts",
        "/project",
        () => Promise.reject(sourceError),
      );

      assertEquals(identity.cacheable, false);
      if (identity.cacheable) throw new Error("Expected an uncacheable dependency identity");
      if (!(identity.error instanceof Error)) throw new Error("Expected dependency error context");
      assertStringIncludes(identity.error.message, "could not read /project/pages/index.ts");
      assertStrictEquals(identity.error.cause, sourceError);
    });
  },
);
