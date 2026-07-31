import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateAllOutputs,
  generateClientScripts,
  generateRedirectsFile,
} from "./output-generator.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";

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
    it("validates every final generated output against the runtime ceiling", async () => {
      const adapter = createMockAdapter();
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/output/sw.js" ? { ...info, size: STATIC_ASSET_MAX_BYTES + 1 } : info;
      };

      await assertRejects(
        () =>
          generateAllOutputs({
            adapter,
            projectDir: "/project",
            outputDir: "/output",
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
    });
  });
});
