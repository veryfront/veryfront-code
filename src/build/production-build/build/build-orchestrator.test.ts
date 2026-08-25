import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertBuildProducedOutput,
  buildProduction,
  captureBuildDependencySnapshot,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build-orchestrator.ts";
import type { BuildStats } from "#veryfront/server/build-types.ts";
import type { CollectedRoutes } from "./route-collector.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReactVersionCache,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { VeryfrontConfig } from "#veryfront/config";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("build/production-build/build/build-orchestrator", () => {
  describe("re-exports", () => {
    it("should export cleanupCaches function", () => {
      assertEquals(typeof cleanupCaches, "function");
    });

    it("should export cleanupRenderer function", () => {
      assertEquals(typeof cleanupRenderer, "function");
    });

    it("should export logBuildCompletion function", () => {
      assertEquals(typeof logBuildCompletion, "function");
    });
  });

  describe("buildProduction", () => {
    it("should reject when project directory does not exist", async () => {
      const error = await assertRejects(
        () =>
          buildProduction({
            projectDir: "/tmp/nonexistent-project-" + Date.now(),
          }),
        Error,
        "Invalid project directory",
      );
      assertInstanceOf(error, Error);
      assertEquals(
        error.name,
        "VeryfrontError[config]",
        "a missing project directory is a config error, not a generic build failure",
      );
    });

    it("should be a function", () => {
      assertEquals(typeof buildProduction, "function");
    });

    it("changes the build snapshot when only dependency-affecting config changes", async () => {
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-build-config-snapshot-",
      });
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const adapter = createMockAdapter();

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { lodash: "4.17.21" } }),
        );

        const snapshotA = await captureBuildDependencySnapshot({
          projectDir,
          adapter,
          isLocalProject: true,
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
        });
        const snapshotB = await captureBuildDependencySnapshot({
          projectDir,
          adapter,
          isLocalProject: true,
          config: { react: { version: "19.2.4" } } as VeryfrontConfig,
        });

        assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);
        assertEquals(snapshotA.dependencies?.react, "18.3.1");
        assertEquals(snapshotB.dependencies?.react, "19.2.4");
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("derives build React from captured A after package state B becomes current", async () => {
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-build-react-snapshot-",
      });
      const packageJsonPath = `${projectDir}/package.json`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const adapter = createMockAdapter();
      const config = {} as VeryfrontConfig;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { react: "18.3.1" } }),
        );
        const snapshotA = await captureBuildDependencySnapshot({
          projectDir,
          adapter,
          isLocalProject: true,
          config,
        });

        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { react: "19.2.4" } }),
        );
        const future = new Date(Date.now() + 2_000);
        await Deno.utime(packageJsonPath, future, future);
        const snapshotB = await captureBuildDependencySnapshot({
          projectDir,
          adapter,
          isLocalProject: true,
          config,
        });

        const buildReactVersion = await resolveProjectReactVersion({
          projectDir,
          config,
          dependencyPinningCacheKey: snapshotA.cacheKey,
          dependencyPinningDependencies: snapshotA.dependencies,
        });

        assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);
        assertEquals(snapshotB.dependencies?.react, "19.2.4");
        assertEquals(buildReactVersion, "18.3.1");
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a build snapshot when package.json is malformed", async () => {
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-build-malformed-snapshot-",
      });
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(`${projectDir}/package.json`, "{ malformed");

        await assertRejects(
          () =>
            captureBuildDependencySnapshot({
              projectDir,
              adapter: createMockAdapter(),
              isLocalProject: true,
              config: {} as VeryfrontConfig,
            }),
          Error,
          "on:unknown",
        );
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("assertBuildProducedOutput", () => {
    const emptyStats: BuildStats = {
      pages: 0,
      components: 0,
      chunks: 0,
      assets: 0,
      totalSize: 0,
      duration: 0,
    };
    const noRoutes: CollectedRoutes = { pages: [], app: [] };
    const someRoutes: CollectedRoutes = {
      pages: [{ path: "/", file: "pages/index.tsx", slug: "index" }],
      app: [],
    };

    it("throws when SSG is disabled and nothing was built", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, noRoutes, false, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error !== undefined, true);
      assertEquals(
        error?.message.includes("static site generation is disabled"),
        true,
      );
    });

    it("throws when SSG is enabled but no routes were found", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, noRoutes, true, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error?.message.includes("no routes were found"), true);
    });

    it("throws when routes were collected but no pages were generated", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, someRoutes, true, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error?.message.includes("1 route(s) were collected"), true);
    });

    it("does not throw for dry runs", () => {
      assertBuildProducedOutput(emptyStats, noRoutes, false, true);
    });

    it("does not throw when pages were built", () => {
      assertBuildProducedOutput(
        { ...emptyStats, pages: 2 },
        someRoutes,
        true,
        false,
      );
    });

    it("does not throw when chunks were built", () => {
      assertBuildProducedOutput(
        { ...emptyStats, chunks: 3 },
        someRoutes,
        true,
        false,
      );
    });
  });
});
