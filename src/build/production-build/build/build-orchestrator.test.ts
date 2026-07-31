import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
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
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReactVersionCache,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { getProjectReact } from "#veryfront/react";
import { getReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
} from "#veryfront/transforms/esm/transform-cache.ts";

// React's server scheduler owns one process-lifetime MessagePort. Initialize it
// during module setup so the suite's sanitizers still detect build-owned leaks.
await Promise.all([getProjectReact(), getReactDOMServer()]);

type CacheInjection = NonNullable<Parameters<typeof __injectCachesForTests>[0]>;
type InjectedLocalFallback = NonNullable<CacheInjection["localFallback"]>;

function injectTransformCacheClear(clear: () => void): void {
  const localFallback = {
    get: () => undefined,
    set: () => undefined,
    delete: () => false,
    has: () => false,
    clear,
    size: 0,
    entries: () => new Map().entries(),
  } as unknown as InjectedLocalFallback;
  __injectCachesForTests({ localFallback });
}

function restoreTransformCache(): void {
  __injectCachesForTests(null);
  destroyTransformCache();
}

type DirectorySnapshotEntry =
  | { path: string; kind: "directory" }
  | { path: string; kind: "file"; bytes: number[] };

async function snapshotDirectoryTree(root: string): Promise<DirectorySnapshotEntry[]> {
  const snapshot: DirectorySnapshotEntry[] = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        snapshot.push({ path, kind: "directory" });
        await visit(absolutePath, path);
      } else if (entry.isFile) {
        snapshot.push({
          path,
          kind: "file",
          bytes: Array.from(await Deno.readFile(absolutePath)),
        });
      } else {
        throw new Error(`Unexpected non-file build output entry: ${absolutePath}`);
      }
    }
  }

  await visit(root, "");
  return snapshot;
}

async function assertStaticPathsFailureIsAtomic(options: {
  source: string;
  errorIncludes: string;
  fileName?: string;
}): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-build-static-path-failure-" });
  const outputDir = `${projectDir}/dist`;
  try {
    await Deno.mkdir(`${projectDir}/pages/blog`, { recursive: true });
    await Deno.writeTextFile(
      `${projectDir}/pages/blog/${options.fileName ?? "[slug].tsx"}`,
      options.source,
    );
    await Deno.mkdir(`${outputDir}/_veryfront`, { recursive: true });
    await Deno.mkdir(`${outputDir}/assets`, { recursive: true });
    await Deno.writeTextFile(`${outputDir}/index.html`, "previous html\n");
    await Deno.writeTextFile(
      `${outputDir}/_veryfront/manifest.json`,
      '{"build":"last-known-good"}\n',
    );
    await Deno.writeFile(
      `${outputDir}/assets/existing.bin`,
      new Uint8Array([0, 255, 13, 10]),
    );
    const before = await snapshotDirectoryTree(outputDir);

    await assertRejects(
      () =>
        buildProduction({
          projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        }),
      Error,
      options.errorIncludes,
    );

    assertEquals(await snapshotDirectoryTree(outputDir), before);
    assertEquals(
      [...Deno.readDirSync(projectDir)].some((entry) =>
        entry.name.includes(".veryfront-stage-") ||
        entry.name.includes(".veryfront-backup-") ||
        entry.name.includes(".veryfront-build.lock")
      ),
      false,
    );
  } finally {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
    await Deno.remove(projectDir, { recursive: true });
  }
}

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
      await assertRejects(
        () =>
          buildProduction({
            projectDir: "/tmp/nonexistent-project-" + Date.now(),
          }),
        Error,
        "does not exist",
      );
    });

    it("distinguishes project directory inspection failures from absence", async () => {
      const error = await assertRejects(
        () =>
          buildProduction({
            projectDir: "invalid\0project",
          }),
        Error,
        "Could not inspect project directory",
      );
      assertInstanceOf(error, Error);
      assertInstanceOf(error.cause, TypeError);
    });

    it("rejects a project path that is not a directory", async () => {
      const projectFile = await Deno.makeTempFile({ prefix: "vf-build-project-" });
      try {
        await assertRejects(
          () => buildProduction({ projectDir: projectFile }),
          Error,
          "is not a directory",
        );
      } finally {
        await Deno.remove(projectFile);
      }
    });

    it("should be a function", () => {
      assertEquals(typeof buildProduction, "function");
    });

    it("preserves the previous output when route preflight detects a collision", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-preflight-" });
      const outputDir = `${projectDir}/dist`;
      const sentinelPath = `${outputDir}/previous.txt`;
      try {
        await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
        await Deno.mkdir(`${projectDir}/app/about`, { recursive: true });
        await Deno.mkdir(outputDir);
        await Deno.writeTextFile(
          `${projectDir}/pages/about.tsx`,
          "export default function About() { return null; }",
        );
        await Deno.writeTextFile(
          `${projectDir}/app/about/page.tsx`,
          "export default function About() { return null; }",
        );
        await Deno.writeTextFile(sentinelPath, "last known good build");

        await assertRejects(
          () => buildProduction({ projectDir, outputDir }),
          Error,
          "output collision",
        );
        assertEquals(
          await Deno.readTextFile(sentinelPath),
          "last known good build",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("publishes a complete build over the previous output only after success", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-publish-" });
      const outputDir = `${projectDir}/dist`;
      try {
        await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
        await Deno.mkdir(outputDir);
        await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Published");
        await Deno.writeTextFile(`${outputDir}/previous.txt`, "old");

        const stats = await buildProduction({
          projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
        });

        assertEquals(stats.pages, 1);
        assertEquals(
          (await Deno.readTextFile(`${outputDir}/index.html`)).includes("Published"),
          true,
        );
        await assertRejects(
          () => Deno.stat(`${outputDir}/previous.txt`),
          Deno.errors.NotFound,
        );
        assertEquals(
          [...Deno.readDirSync(projectDir)].some((entry) =>
            entry.name.includes(".veryfront-stage-") ||
            entry.name.includes(".veryfront-backup-") ||
            entry.name.includes(".veryfront-build.lock")
          ),
          false,
        );
      } finally {
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("threads explicitly composed release asset providers through a flag-on build", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-release-providers-" });
      const outputDir = `${projectDir}/dist`;
      const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
      let vendorCalls = 0;
      let transformCalls = 0;

      try {
        setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
        await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { react: "19.2.4" } }),
        );
        await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Provider-backed build");

        const stats = await buildProduction({
          projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          localReleaseAssetProviders: {
            vendorHttpImports: (code: string) => {
              vendorCalls++;
              const urls = [
                ...new Set(
                  [...code.matchAll(/["'](https?:\/\/[^"']+)["']/g)]
                    .map((match) => match[1])
                    .filter((url): url is string => typeof url === "string"),
                ),
              ];
              return Promise.resolve({
                code,
                dependencies: urls.map((url) => ({
                  specifier: url,
                  manifestKey: url,
                  code: `export const sourceUrl = ${JSON.stringify(url)};`,
                })),
              });
            },
            frameworkTransform: () => {
              transformCalls++;
              return Promise.resolve("export const framework = true;");
            },
          },
        });

        assertEquals(stats.pages, 1);
        assertEquals(vendorCalls > 0, true);
        assertEquals(transformCalls > 0, true);
        assertExists(
          JSON.parse(
            await Deno.readTextFile(
              `${outputDir}/_veryfront/release-asset-manifest.json`,
            ),
          ).dependencies.react,
        );
      } finally {
        restoreEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag);
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("materializes Pages getStaticPaths before rendering, planning, and manifest output", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-static-paths-" });
      const outputDir = `${projectDir}/dist`;
      try {
        await Deno.mkdir(`${projectDir}/pages/blog`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/pages/blog/[slug].tsx`,
          `
export function getStaticPaths() {
  return {
    paths: [
      { params: { slug: "z-last" } },
      { params: { slug: "hello world" } },
    ],
    fallback: false,
  };
}

export function getStaticData({ params }: { params: { slug: string } }) {
  return { props: { label: params.slug } };
}

export default function BlogPost({ label }: { label: string }) {
  return <main data-static-label={label}>{label}</main>;
}
`,
        );

        const stats = await buildProduction({
          projectDir,
          outputDir,
          enableSplitting: true,
          enableCompression: false,
          enablePrefetch: true,
        });

        assertEquals(stats.pages, 2);
        assertEquals(stats.chunks, 1);
        assertEquals(stats.ssgPaths, [
          "/blog/hello%20world",
          "/blog/z-last",
        ]);
        assertStringIncludes(
          await Deno.readTextFile(`${outputDir}/blog/hello%20world/index.html`),
          "hello world",
        );
        const manifest = JSON.parse(
          await Deno.readTextFile(`${outputDir}/_veryfront/manifest.json`),
        ) as {
          routes: Array<{
            path: string;
            template: string;
            slug: string;
            chunks: string[];
          }>;
          chunks: {
            routes: Record<string, { entry: string; chunks: string[] }>;
          } | null;
        };
        assertEquals(manifest.routes, [
          {
            path: "/blog/hello%20world",
            template: "/blog/[slug]",
            slug: "blog/hello%20world",
            chunks: [],
          },
          {
            path: "/blog/z-last",
            template: "/blog/[slug]",
            slug: "blog/z-last",
            chunks: [],
          },
        ]);
        assertExists(manifest.chunks);
        assertEquals(Object.keys(manifest.chunks.routes), ["/blog/[slug]"]);
        const templateChunks = manifest.chunks.routes["/blog/[slug]"];
        assertExists(templateChunks);
        for (const path of ["hello%20world", "z-last"]) {
          assertStringIncludes(
            await Deno.readTextFile(`${outputDir}/blog/${path}/index.html`),
            `/_veryfront/chunks/${templateChunks.entry}`,
          );
        }
      } finally {
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects unsupported fallback modes without modifying prior output", async () => {
      for (const fallback of ["true", '"blocking"']) {
        await assertStaticPathsFailureIsAtomic({
          source: `
export function getStaticPaths() {
  return {
    paths: [{ params: { slug: "post" } }],
    fallback: ${fallback},
  };
}
export default function BlogPost() { return null; }
`,
          errorIncludes: "requires fallback: false",
        });
      }
    });

    it("rejects collisions and static-path bounds without modifying prior output", async () => {
      const cases = [
        {
          source: `
export function getStaticPaths() {
  return {
    paths: [
      { params: { slug: "Post" } },
      { params: { slug: "post" } },
    ],
    fallback: false,
  };
}
export default function BlogPost() { return null; }
`,
          errorIncludes: "collision",
        },
        {
          source: `
export function getStaticPaths() {
  return {
    paths: Array.from({ length: 10_001 }, (_, index) => ({
      params: { slug: String(index) },
    })),
    fallback: false,
  };
}
export default function BlogPost() { return null; }
`,
          errorIncludes: "10,000",
        },
        {
          source: `
export function getStaticPaths() {
  return {
    paths: [{ params: { slug: "a".repeat(2_048) } }],
    fallback: false,
  };
}
export default function BlogPost() { return null; }
`,
          errorIncludes: "2,048",
        },
        {
          fileName: "[...parts].tsx",
          source: `
export function getStaticPaths() {
  return {
    paths: [{ params: { parts: Array.from({ length: 1_025 }, () => "x") } }],
    fallback: false,
  };
}
export default function BlogPost() { return null; }
`,
          errorIncludes: "1,024",
        },
      ];

      for (const testCase of cases) {
        await assertStaticPathsFailureIsAtomic(testCase);
      }
    });

    it("preserves the build failure when runtime cleanup also fails", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-cleanup-failure-" });
      const outputDir = `${projectDir}/dist`;
      const cleanupFailure = new Error("transform cache cleanup failed");
      try {
        await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
        await Deno.mkdir(`${projectDir}/app/about`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/pages/about.tsx`,
          "export default function About() { return null; }",
        );
        await Deno.writeTextFile(
          `${projectDir}/app/about/page.tsx`,
          "export default function About() { return null; }",
        );
        injectTransformCacheClear(() => {
          throw cleanupFailure;
        });

        const error = await assertRejects(
          () => buildProduction({ projectDir, outputDir }),
          AggregateError,
          "Production build failed and cleanup also failed",
        );
        assertInstanceOf(error, AggregateError);
        assertEquals(error.errors.length, 2);
        assertStringIncludes(String(error.errors[0]), "output collision");
        assertEquals(error.errors[1], cleanupFailure);
      } finally {
        restoreTransformCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("surfaces runtime cleanup failure after publishing a complete build", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-build-published-cleanup-" });
      const outputDir = `${projectDir}/dist`;
      const cleanupFailure = new Error("transform cache cleanup failed");
      try {
        await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Published");
        injectTransformCacheClear(() => {
          throw cleanupFailure;
        });

        assertEquals(
          await assertRejects(() =>
            buildProduction({
              projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
            })
          ),
          cleanupFailure,
        );
        assertStringIncludes(
          await Deno.readTextFile(`${outputDir}/index.html`),
          "Published",
        );
      } finally {
        restoreTransformCache();
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Deno.remove(projectDir, { recursive: true });
      }
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

    it("throws when chunks were built but no pages were generated", () => {
      assertRejects(
        () =>
          Promise.resolve().then(() =>
            assertBuildProducedOutput(
              { ...emptyStats, chunks: 3 },
              someRoutes,
              true,
              false,
            )
          ),
        Error,
        "no pages",
      );
    });
  });
});
