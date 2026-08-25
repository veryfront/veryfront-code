import "#veryfront/schemas/_test-setup.ts";
/**
 * module-transform.ts unit tests
 *
 * Tests the SSR-vs-release-rewrite decision in `transformModuleToServable`
 * and the optional `postTransform` hook. Uses a mock adapter so no filesystem
 * access is required; the esbuild transform pipeline is exercised for real,
 * with the esbuild service stopped in afterAll so the sanitizers stay clean.
 *
 * @module modules/server/module-transform.test
 */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { transformModuleToServable } from "./module-transform.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
} from "../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setClockForTest,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { destroyTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";

/** Minimal TypeScript source with a relative import for SSR-rewrite tests. */
const SOURCE_WITH_IMPORT = `import { child } from "./child.js";
export const value = child;
`;

/** Trivial TypeScript source with no imports. */
const SOURCE_NO_IMPORTS = `export const greeting = "hello";
`;

/** Source importing a local http bundle, which the release rewrite must inspect. */
const SOURCE_WITH_BUNDLE_IMPORT =
  `import bundle from "file:///test-project/veryfront-http-bundle/http-abcdef01.mjs";
export const greeting = bundle;
`;

describe(
  "transformModuleToServable",
  () => {
    const adapter = createMockAdapter();
    const projectDir = "/test-project";

    afterAll(async () => {
      await stopEsbuild();
    });

    describe("SSR-vs-release decision", () => {
      it("applies SSR import rewrites when isSSR=true", async () => {
        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: true },
          isSSR: true,
          ssrRewriteOptions: { projectSlug: "test", branch: null },
        });

        // applySSRImportRewritesAsync appends ?ssr=true&project=<slug> to relative imports
        assertStringIncludes(code, "ssr=true");
        assertStringIncludes(code, "project=test");
      });

      it("throws when isSSR is true without ssrRewriteOptions", async () => {
        await assertRejects(
          () =>
            transformModuleToServable({
              source: SOURCE_WITH_IMPORT,
              sourceFile: "/test-project/page.ts",
              projectDir,
              adapter,
              transformOpts: { projectId: "test", dev: true, ssr: true },
              isSSR: true,
              // ssrRewriteOptions intentionally omitted: the transform must refuse
              // to serve an SSR module with un-rewritten relative imports.
            }),
          VeryfrontError,
          "requires ssrRewriteOptions when isSSR is true",
        );
      });

      it("does not apply SSR rewrites when isSSR=false", async () => {
        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          // ssrRewriteOptions intentionally omitted — should not be called
        });

        assertEquals(code.includes("ssr=true"), false);
      });

      it("skips release dependency rewrite when releaseRewriteOptions is omitted", async () => {
        // Source has no http imports so the release rewrite would be a no-op anyway,
        // but omitting releaseRewriteOptions means the function returns early on the
        // non-SSR path without calling rewriteReleaseDependencyImportsForModule.
        const code = await transformModuleToServable({
          source: SOURCE_NO_IMPORTS,
          sourceFile: "/test-project/greet.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          // No releaseRewriteOptions — batch-handler behaviour
        });

        assertStringIncludes(code, "greeting");
      });

      it("runs the release dependency rewrite when releaseRewriteOptions is provided", async () => {
        // The rewrite only reaches the dependency reader when the flag is on and
        // the module imports a local http bundle, so this pins the wiring rather
        // than merely observing that the branch does not throw.
        const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
        const readCalls: string[] = [];

        try {
          setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");

          await transformModuleToServable({
            source: SOURCE_WITH_BUNDLE_IMPORT,
            sourceFile: "/test-project/greet.ts",
            projectDir,
            adapter,
            transformOpts: { projectId: "test", dev: false, ssr: false },
            isSSR: false,
            releaseRewriteOptions: {
              releaseId: "rel-1",
              // null manifest keeps getReadyManifestForRenderAsync out of it.
              manifest: null,
              dependencyCacheRoot: projectDir,
              readDependencySource: (path) => {
                readCalls.push(path);
                return Promise.resolve("");
              },
            },
          });
        } finally {
          setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
        }

        assertEquals(
          readCalls,
          ["/test-project/veryfront-http-bundle/http-abcdef01.mjs"],
          "non-SSR release branch must run the dependency import rewrite",
        );
      });
    });

    describe("postTransform hook", () => {
      it("calls postTransform between transformToESM and SSR rewrites", async () => {
        const marker = "/* postTransform-was-called */";
        let postTransformInput = "";

        const code = await transformModuleToServable({
          source: SOURCE_NO_IMPORTS,
          sourceFile: "/test-project/greet.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          postTransform: (c) => {
            postTransformInput = c;
            return c + "\n" + marker;
          },
        });

        // The hook received output from transformToESM
        assertStringIncludes(postTransformInput, "greeting");
        // The hook's output is part of the final code
        assertStringIncludes(code, marker);
      });

      it("postTransform result is passed into SSR rewrites", async () => {
        const injected = "/* injected */";

        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: true },
          isSSR: true,
          postTransform: (c) => c + "\n" + injected,
          ssrRewriteOptions: { projectSlug: "test", branch: null },
        });

        // Both the injected marker and SSR rewrites are present
        assertStringIncludes(code, injected);
        assertStringIncludes(code, "ssr=true");
      });
    });

    it("retries SSR bare dependency writes through inner pipeline cache hits", async () => {
      const retryProjectDir = await makeTempDir({ prefix: "vf-inner-ssr-retry-" });
      const sourceFile = join(retryProjectDir, "page.ts");
      const packageJsonPath = join(retryProjectDir, "package.json");
      const source = `import value from "redis"; export default value;`;
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
        await writeTextFile(sourceFile, source);
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { redis: "^5.0.0" } }),
        );

        const dependencyPinningSource = createDependencyPinningSource({
          projectDir: retryProjectDir,
          projectId: "inner-ssr-retry-project",
          isLocalProject: false,
          dependencyWritebackTarget: { kind: "main" },
        });
        const snapshotA = await getDependencyPinningSnapshot(
          dependencyPinningSource,
        );
        const transformOptions = {
          source,
          sourceFile,
          projectDir: retryProjectDir,
          adapter,
          transformOpts: {
            projectId: "inner-ssr-retry-project",
            dev: false,
            ssr: true,
            dependencyPinningCacheKey: snapshotA.cacheKey,
            dependencyPinningDependencies: snapshotA.dependencies,
            dependencyPinningSource,
          },
          isSSR: true,
          ssrRewriteOptions: {
            projectSlug: "inner-ssr-retry-project",
            projectDir: retryProjectDir,
            projectId: "inner-ssr-retry-project",
          },
        } as const;

        await transformModuleToServable(transformOptions);
        await _pendingResolutions();
        assertEquals(attempts, [["redis@^5.0.0"]]);

        await transformModuleToServable(transformOptions);
        await _pendingResolutions();
        assertEquals(attempts.length, 1);

        now = 60_000;
        await transformModuleToServable(transformOptions);
        await _pendingResolutions();
        assertEquals(attempts.length, 2);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { redis: "^6.0.0" } }),
        );
        const snapshotB = await getDependencyPinningSnapshot(
          dependencyPinningSource,
        );
        assertEquals(snapshotB.cacheKey === snapshotA.cacheKey, false);

        now = 120_000;
        await transformModuleToServable(transformOptions);
        await _pendingResolutions();
        assertEquals(attempts.length, 2);
      } finally {
        await _pendingResolutions();
        _clearNpmVersionCache();
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        destroyTransformCache();
        await remove(retryProjectDir, { recursive: true });
      }
    });
  },
);
