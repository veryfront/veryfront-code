import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateAllOutputs,
  generateClientScripts,
  generateRedirectsFile,
  type OutputGeneratorOptions,
} from "./output-generator.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";
import { type BuildOutputOwnership, createBuildPublication } from "./build-publication.ts";

describe("build/production-build/build/output-generator", () => {
  describe("generateClientScripts", () => {
    it("should skip writing when dryRun is true", async () => {
      const writes: string[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, _content: string) {
            writes.push(path);
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateClientScripts(adapter as any, "/output", true);
      assertEquals(writes.length, 0);
    });

    it("should write all production client scripts", async () => {
      const writes: { path: string; content: string }[] = [];
      const mkdirs: string[] = [];
      const adapter = {
        fs: {
          mkdir(path: string) {
            mkdirs.push(path);
            return Promise.resolve();
          },
          writeFile(path: string, content: string) {
            writes.push({ path, content });
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateClientScripts(adapter as any, "/output", false);

      assertEquals(writes.some((write) => write.path.endsWith("_veryfront/app.js")), true);
      assertEquals(writes.some((write) => write.path.endsWith("_veryfront/client.js")), true);
      assertEquals(writes.some((write) => write.path.endsWith("_veryfront/router.js")), true);
      assertEquals(writes.some((write) => write.path.endsWith("_veryfront/prefetch.js")), true);
      assertEquals(
        writes.find((write) => write.path.endsWith("_veryfront/client.js"))?.content,
        writes.find((write) => write.path.endsWith("_veryfront/router.js"))?.content,
      );
      assertEquals(mkdirs.some((path) => path.endsWith("_veryfront")), true);
      assertEquals(
        writes.some((write) => write.path.endsWith("_veryfront/hydration-runtime.js")),
        true,
      );
      assertEquals(
        writes.some((write) =>
          write.path.endsWith("_veryfront/hydration-runtime.js") &&
          write.content.includes("RouterProvider")
        ),
        true,
      );
      assertEquals(
        writes.some((write) => write.path.endsWith(getProdHydrationModulePath().slice(1))),
        true,
      );
      assertEquals(
        writes.some((write) =>
          write.path.endsWith(getProdHydrationModulePath().slice(1)) &&
          write.content.includes("RouterProvider")
        ),
        true,
      );
    });
  });

  describe("generateRedirectsFile", () => {
    it("should skip writing when dryRun is true", async () => {
      const writes: string[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, _content: string) {
            writes.push(path);
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateRedirectsFile(adapter as any, "/output", true);
      assertEquals(writes.length, 0);
    });

    it("should write _redirects file when not dryRun", async () => {
      const writes: { path: string; content: string }[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, content: string) {
            writes.push({ path, content });
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateRedirectsFile(adapter as any, "/output", false);
      assertEquals(writes.length, 1);
      const write = writes[0];
      assertExists(write);
      assertEquals(write.path.includes("_redirects"), true);
      assertEquals(write.content.includes("/*"), true);
    });
  });

  describe("generateAllOutputs", () => {
    it("enforces the dry-run and owned-output union at the type boundary", () => {
      const adapter = createMockAdapter();
      const common = {
        adapter,
        projectDir: "/project",
        routes: [],
        appRoutes: [],
        stats: {
          pages: 0,
          components: 0,
          chunks: 0,
          assets: 0,
          totalSize: 0,
          duration: 0,
        },
        enableSplitting: false,
        enablePrefetch: false,
        enableCompression: false,
        chunkManifest: null,
      };
      // @ts-expect-error Non-dry output requires opaque ownership.
      const missingOwnership: OutputGeneratorOptions = { ...common, dryRun: false };
      // @ts-expect-error Non-dry callers cannot supply path-string authority.
      const arbitraryOutput: OutputGeneratorOptions = {
        ...common,
        dryRun: false,
        outputDir: "/output",
      };
      // @ts-expect-error Dry runs cannot carry write authority.
      const dryOwnership: OutputGeneratorOptions = {
        ...common,
        dryRun: true,
        outputDir: "/output",
        outputOwnership: Object.freeze(Object.create(null)) as BuildOutputOwnership,
      };
      assertEquals(
        [missingOwnership, arbitraryOutput, dryOwnership].length,
        3,
      );
    });

    it("rejects missing and forged runtime authority before downstream effects", async () => {
      for (const outputOwnership of [undefined, Object.freeze(Object.create(null))]) {
        const adapter = createMockAdapter();
        let capabilityInspections = 0;
        for (
          const key of [
            "readFileSnapshotWithinLimit",
            "createFileBytesExclusive",
          ] as const
        ) {
          Object.defineProperty(adapter.fs, key, {
            configurable: true,
            get() {
              capabilityInspections++;
              throw new Error(`${key} must not be inspected`);
            },
          });
        }
        const stats = {
          pages: 0,
          components: 0,
          chunks: 0,
          assets: 0,
          totalSize: 0,
          duration: 0,
        };
        await assertRejects(
          () =>
            generateAllOutputs({
              adapter,
              projectDir: "/project",
              routes: [],
              appRoutes: [],
              stats,
              enableSplitting: false,
              enablePrefetch: false,
              enableCompression: false,
              chunkManifest: null,
              dryRun: false,
              outputOwnership,
              releaseAssetManifest: null,
            } as unknown as OutputGeneratorOptions),
          Error,
          "invalid, expired, or belongs to another filesystem",
        );
        assertEquals(capabilityInspections, 0);
        assertEquals(adapter.fs.byteFiles.size, 0);
        assertEquals(adapter.fs.files.size, 0);
        assertEquals(stats.totalSize, 0);
      }
    });

    it("validates every final generated output against the runtime ceiling", async () => {
      const adapter = createMockAdapter();
      adapter.fs.rename = () => Promise.reject(new Error("publication was not expected"));
      const lockRoot = await Deno.makeTempDir({ prefix: "vf-output-generator-" });
      const publication = await createBuildPublication(`${lockRoot}/output`, false, {
        fs: adapter.fs,
      });
      if (publication.dryRun) throw new Error("Expected a live publication");
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === `${publication.buildDir}/sw.js`
          ? { ...info, size: STATIC_ASSET_MAX_BYTES + 1 }
          : info;
      };

      try {
        await assertRejects(
          () =>
            generateAllOutputs({
              adapter,
              projectDir: "/project",
              outputOwnership: publication.outputOwnership,
              routes: [],
              appRoutes: [],
              stats: {
                pages: 0,
                components: 0,
                chunks: 0,
                assets: 0,
                totalSize: 0,
                duration: 0,
              },
              enableSplitting: false,
              enablePrefetch: false,
              enableCompression: false,
              chunkManifest: null,
              dryRun: false,
              releaseAssetManifest: null,
            }),
          Error,
          `exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static asset limit: sw.js`,
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(lockRoot, { recursive: true });
      }
    });
  });
});
