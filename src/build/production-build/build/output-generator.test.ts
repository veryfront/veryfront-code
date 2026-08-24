import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { resolveProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-runtime-selection.ts";
import {
  generateClientScripts,
  generateManifestAndServiceWorker,
  generateRedirectsFile,
} from "./output-generator.ts";
import type { OutputGeneratorOptions } from "./output-generator.ts";

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
      const versionedRuntimeWrites = writes.filter((write) =>
        /_veryfront\/hydration-runtime\.[0-9a-f]{8}\.js$/.test(write.path)
      );
      assertEquals(versionedRuntimeWrites.length, 1);
      assertEquals(
        await resolveProdHydrationModulePath({
          fs: {
            async *readDir(path: string) {
              assertEquals(path, "/project/dist/_veryfront");
              for (const write of versionedRuntimeWrites) {
                yield {
                  name: write.path.slice(write.path.lastIndexOf("/") + 1),
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            },
          },
          projectDir: "/project",
          releaseId: "release-built",
        }),
        getProdHydrationModulePath(),
      );
    });
  });

  describe("generateManifestAndServiceWorker", () => {
    function createOptions(
      dryRun: boolean,
      writes: { path: string; content: string }[],
    ): OutputGeneratorOptions {
      const adapter = {
        fs: {
          mkdir() {
            return Promise.resolve();
          },
          writeFile(path: string, content: string) {
            writes.push({ path, content });
            return Promise.resolve();
          },
        },
      };

      return {
        // deno-lint-ignore no-explicit-any
        adapter: adapter as any,
        projectDir: "/project",
        outputDir: "/output",
        routes: [{ path: "/about", slug: "about", file: "pages/about.mdx" }],
        appRoutes: [],
        stats: {
          pages: 1,
          components: 0,
          chunks: 0,
          assets: 2,
          totalSize: 1024 * 1024,
          duration: 5,
        },
        enableSplitting: false,
        enablePrefetch: false,
        enableCompression: false,
        chunkManifest: null,
        dryRun,
      };
    }

    it("should skip writing when dryRun is true", async () => {
      const writes: { path: string; content: string }[] = [];

      await generateManifestAndServiceWorker(createOptions(true, writes));

      assertEquals(writes.length, 0, "dry runs must not write the manifest or service worker");
    });

    it("should write the manifest and service worker when not dryRun", async () => {
      const writes: { path: string; content: string }[] = [];

      await generateManifestAndServiceWorker(createOptions(false, writes));

      assertEquals(
        writes.map((write) => write.path),
        ["/output/_veryfront/manifest.json", "/output/sw.js"],
        "the manifest and the service worker are both written under outputDir",
      );
      const manifestWrite = writes[0];
      assertExists(manifestWrite, "the manifest write must exist");
      const manifest = JSON.parse(manifestWrite.content) as {
        routes: Array<{ path: string; slug: string; chunks: string[] }>;
        stats: { pages: number; chunks: number; assets: number; totalSize: string };
      };
      assertEquals(
        manifest.routes,
        [{ path: "/about", slug: "about", chunks: [] }],
        "the manifest round-trips the routes it was given",
      );
      assertEquals(
        manifest.stats,
        { pages: 1, chunks: 0, assets: 2, totalSize: "1.00 MB" },
        "the manifest round-trips the build stats it was given",
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
});
