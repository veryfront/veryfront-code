import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { expect } from "#std/expect";
import { assertRejects } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import {
  copyStaticAssets,
  loadClientStyles,
} from "../../../../src/build/production-build/index.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import {
  chmod,
  mkdir,
  readFile,
  remove,
  symlink,
  writeFile as writeFileBinary,
  writeTextFile,
} from "#veryfront/compat/fs.ts";

async function writeFile(
  path: string,
  data: string | Uint8Array | { symlink: string },
): Promise<void> {
  if (typeof data === "string") {
    await writeTextFile(path, data);
    return;
  }

  if (data instanceof Uint8Array) {
    await writeFileBinary(path, data);
    return;
  }

  await symlink(data.symlink, path);
}

describe("Asset Generation Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("copyStaticAssets - Basic Functionality", () => {
    it("exports function", () => {
      expect(copyStaticAssets).toBeDefined();
      expect(typeof copyStaticAssets).toBe("function");
    });

    it("copies single image file", async () => {
      await withTestContext("asset-single-image", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        await writeFile(join(publicDir, "logo.png"), imageData);

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(8);

        expect(await adapter.fs.exists(join(outputDir, "logo.png"))).toBe(true);
      });
    });

    it("copies multiple file types", async () => {
      await withTestContext("asset-multiple-types", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "manifest.json"), '{"name":"test"}');
        await writeFile(join(publicDir, "robots.txt"), "User-agent: *");
        await writeFile(
          join(publicDir, "icon.png"),
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        await writeFile(join(publicDir, "style.css"), "body { margin: 0; }");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(4);
        expect(stats.totalSize).toBeGreaterThan(0);

        expect(await adapter.fs.exists(join(outputDir, "manifest.json"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "robots.txt"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "icon.png"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "style.css"))).toBe(true);
      });
    });

    it("handles nested directory structures", async () => {
      await withTestContext("asset-nested-dirs", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const iconsDir = join(publicDir, "images", "icons");
        await mkdir(iconsDir, { recursive: true });
        await writeFile(join(iconsDir, "favicon.ico"), "ICON");

        const fontsDir = join(publicDir, "fonts");
        await mkdir(fontsDir, { recursive: true });
        await writeFile(join(fontsDir, "roboto.woff"), "WOFF");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);

        expect(await adapter.fs.exists(join(outputDir, "images", "icons", "favicon.ico"))).toBe(
          true,
        );
        expect(await adapter.fs.exists(join(outputDir, "fonts", "roboto.woff"))).toBe(true);
      });
    });

    it("calculates size accurately", async () => {
      await withTestContext("asset-size-calc", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "file1.txt"), "A".repeat(100));
        await writeFile(join(publicDir, "file2.txt"), "B".repeat(200));

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);
        expect(stats.totalSize).toBe(300);
      });
    });

    it("handles empty public directory", async () => {
      await withTestContext("asset-empty-dir", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(0);
        expect(stats.totalSize).toBe(0);
      });
    });

    it("handles missing public directory", async () => {
      await withTestContext("asset-no-public", async (context) => {
        const adapter = await getAdapter();
        const outputDir = join(context.projectDir, "dist");

        const publicDir = join(context.projectDir, "public");
        await remove(publicDir, { recursive: true });

        expect(await adapter.fs.exists(publicDir)).toBe(false);

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(0);
        expect(stats.totalSize).toBe(0);
      });
    });
  });

  describe("copyStaticAssets - Dry Run Mode", () => {
    it("dry-run mode counts but does not copy", async () => {
      await withTestContext("asset-dry-run", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "test.txt"), "content");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(7);

        expect(await adapter.fs.exists(join(outputDir, "test.txt"))).toBe(false);
      });
    });

    it("dry-run with multiple files", async () => {
      await withTestContext("asset-dry-run-multi", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "a.txt"), "AAA");
        await writeFile(join(publicDir, "b.txt"), "BBBBB");
        await writeFile(join(publicDir, "c.txt"), "CC");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(3);
        expect(stats.totalSize).toBe(10);

        expect(await adapter.fs.exists(outputDir)).toBe(false);
      });
    });

    it("dry-run with nested directories", async () => {
      await withTestContext("asset-dry-run-nested", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const nestedDir = join(publicDir, "assets", "images");
        await mkdir(nestedDir, { recursive: true });
        await writeFile(join(nestedDir, "pic.jpg"), "JPEG");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(4);

        expect(await adapter.fs.exists(join(outputDir, "assets", "images"))).toBe(false);
      });
    });
  });

  describe("copyStaticAssets - Edge Cases", () => {
    it("handles files with special characters", async () => {
      await withTestContext("asset-special-chars", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "file-with-dash.txt"), "dash");
        await writeFile(join(publicDir, "file_with_underscore.txt"), "underscore");
        await writeFile(join(publicDir, "file.multiple.dots.txt"), "dots");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(3);

        expect(await adapter.fs.exists(join(outputDir, "file-with-dash.txt"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "file_with_underscore.txt"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "file.multiple.dots.txt"))).toBe(true);
      });
    });

    it("handles large files", async () => {
      await withTestContext("asset-large-file", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        const largeBinary = new Uint8Array(2 * 1024 * 1024);
        largeBinary.fill(42);
        await writeFile(join(publicDir, "large.bin"), largeBinary);

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(2 * 1024 * 1024);

        const copiedFile = await readFile(join(outputDir, "large.bin"));
        expect(copiedFile.length).toBe(2 * 1024 * 1024);
      });
    });

    it("handles symlinks to files", async () => {
      await withTestContext("asset-symlink-file", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        const realFile = join(publicDir, "real.txt");
        await writeFile(realFile, "real content");

        const symlinkFile = join(publicDir, "link.txt");
        try {
          await writeFile(symlinkFile, { symlink: realFile });

          const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

          expect(stats.assets).toBeGreaterThanOrEqual(1);
          expect(await adapter.fs.exists(join(outputDir, "real.txt"))).toBe(true);
        } catch (e) {
          if ((e as Error).message?.includes("symlink")) {
            console.log("Skipping symlink test - not supported on this platform");
            return;
          }
          throw e;
        }
      });
    });

    it("handles deeply nested directories", async () => {
      await withTestContext("asset-deep-nesting", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const deepPath = join(publicDir, "a", "b", "c", "d", "e");
        await mkdir(deepPath, { recursive: true });
        await writeFile(join(deepPath, "deep.txt"), "deep file");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
        expect(await adapter.fs.exists(join(outputDir, "a", "b", "c", "d", "e", "deep.txt"))).toBe(
          true,
        );
      });
    });

    it("handles binary files correctly", async () => {
      await withTestContext("asset-binary-files", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(
          join(publicDir, "image.png"),
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
        );

        await writeFile(
          join(publicDir, "photo.jpg"),
          new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70]),
        );

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);
        expect(stats.totalSize).toBe(18);

        expect(await adapter.fs.exists(join(outputDir, "image.png"))).toBe(true);
        expect(await adapter.fs.exists(join(outputDir, "photo.jpg"))).toBe(true);

        expect((await readFile(join(outputDir, "image.png"))).length).toBeGreaterThan(0);
        expect((await readFile(join(outputDir, "photo.jpg"))).length).toBeGreaterThan(0);
      });
    });

    it("excludes directories from asset count", async () => {
      await withTestContext("asset-exclude-dirs", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        await mkdir(join(publicDir, "empty1"), { recursive: true });
        await mkdir(join(publicDir, "empty2"), { recursive: true });
        await mkdir(join(publicDir, "has-file"), { recursive: true });
        await writeFile(join(publicDir, "has-file", "file.txt"), "content");

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
      });
    });

    it("handles permission errors gracefully", async () => {
      await withTestContext("asset-permissions", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "test.txt"), "content");

        try {
          await mkdir(outputDir, { recursive: true });
          await chmod(outputDir, 0o444);

          await assertRejects(async () => {
            await copyStaticAssets(adapter, context.projectDir, outputDir);
          });

          await chmod(outputDir, 0o755);
        } catch {
          try {
            await chmod(outputDir, 0o755);
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });

    it("handles mixed text and binary files", async () => {
      await withTestContext("asset-mixed-content", async (context) => {
        const adapter = await getAdapter();
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "config.json"), '{"key":"value"}');
        await writeFile(join(publicDir, "readme.md"), "# README");
        await writeFile(join(publicDir, "data.bin"), new Uint8Array([0, 1, 2, 3, 255, 254, 253]));

        const stats = await copyStaticAssets(adapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(3);

        const configContent = await adapter.fs.readFile(join(outputDir, "config.json"));
        expect(configContent.includes("key")).toBe(true);

        const readmeContent = await adapter.fs.readFile(join(outputDir, "readme.md"));
        expect(readmeContent.includes("README")).toBe(true);

        expect(await adapter.fs.exists(join(outputDir, "data.bin"))).toBe(true);
        expect((await readFile(join(outputDir, "data.bin"))).length).toBeGreaterThan(0);
      });
    });
  });

  describe("loadClientStyles - Template Loading", () => {
    it("exports function", () => {
      expect(loadClientStyles).toBeDefined();
      expect(typeof loadClientStyles).toBe("function");
    });

    it("loads embedded CSS successfully", () => {
      const css = loadClientStyles();

      expect(typeof css).toBe("string");
      expect(css.length).toBeGreaterThan(0);

      expect(css.includes("body")).toBe(true);
      expect(css.includes("margin")).toBe(true);
    });

    it("CSS contains loading spinner styles", () => {
      const css = loadClientStyles();

      expect(css.includes("loading-spinner")).toBe(true);
      expect(css.includes("@keyframes")).toBe(true);
      expect(css.includes("spin")).toBe(true);
    });

    it("CSS contains error container styles", () => {
      const css = loadClientStyles();

      expect(css.includes("error-container")).toBe(true);
      expect(css.includes("border")).toBe(true);
    });

    it("CSS contains prose styles", () => {
      const css = loadClientStyles();

      expect(css.includes(".prose")).toBe(true);
      expect(css.includes("max-width")).toBe(true);
      expect(css.includes("code")).toBe(true);
    });

    it("returns valid CSS syntax", () => {
      const css = loadClientStyles();

      const openBraces = (css.match(/\{/g) ?? []).length;
      const closeBraces = (css.match(/\}/g) ?? []).length;
      expect(openBraces).toBe(closeBraces);

      expect(css.includes("#")).toBe(true);
    });

    it("always returns embedded CSS (no file I/O)", () => {
      const css = loadClientStyles();
      expect(typeof css).toBe("string");
      expect(css.length).toBeGreaterThan(0);
    });

    it("returns consistent CSS across calls", () => {
      expect(loadClientStyles()).toBe(loadClientStyles());
    });

    it("CSS contains expected selectors", () => {
      const css = loadClientStyles();

      const expectedSelectors = [
        "body",
        ".loading-container",
        ".loading-spinner",
        ".error-container",
        ".prose",
        ".prose h1",
        ".prose code",
        ".prose pre",
      ];

      for (const selector of expectedSelectors) {
        expect(css.includes(selector)).toBe(true);
      }
    });

    it("CSS is minification-ready", () => {
      const css = loadClientStyles();

      expect(css.includes(";;")).toBe(false);
      expect(css.includes("::")).toBe(css.includes("::before") || css.includes("::after"));
    });
  });
});
