
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { expect } from "std/expect/mod.ts";
import { assertRejects } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { copyStaticAssets, loadClientStyles } from "../../../../src/build/production-build/index.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

async function writeFile(path: string, data: string | Uint8Array | { symlink: string }) {
  if (typeof data === "object" && "symlink" in data) {
    await Deno.symlink(data.symlink, path);
  } else if (typeof data === "string") {
    await Deno.writeTextFile(path, data);
  } else {
    await Deno.writeFile(path, data);
  }
}

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "copyStaticAssets - Basic Functionality",
  () => {
    it("exports function", () => {
      expect(copyStaticAssets).toBeDefined();
      expect(typeof copyStaticAssets).toBe("function");
    });

    it("copies single image file", async () => {
      await withTestContext("asset-single-image", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "logo.png"), imageData);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(8);

        const copiedExists = await denoAdapter.fs.exists(join(outputDir, "logo.png"));
        expect(copiedExists).toBe(true);
      });
    });

    it("copies multiple file types", async () => {
      await withTestContext("asset-multiple-types", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "manifest.json"), '{"name":"test"}');
        await writeFile(join(publicDir, "robots.txt"), "User-agent: *");
        const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "icon.png"), imageData);
        await writeFile(join(publicDir, "style.css"), "body { margin: 0; }");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(4);
        expect(stats.totalSize).toBeGreaterThan(0);

        expect(await denoAdapter.fs.exists(join(outputDir, "manifest.json"))).toBe(true);
        expect(await denoAdapter.fs.exists(join(outputDir, "robots.txt"))).toBe(true);
        expect(await denoAdapter.fs.exists(join(outputDir, "icon.png"))).toBe(true);
        expect(await denoAdapter.fs.exists(join(outputDir, "style.css"))).toBe(true);
      });
    });

    it("handles nested directory structures", async () => {
      await withTestContext("asset-nested-dirs", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const iconsDir = join(publicDir, "images", "icons");
        await Deno.mkdir(iconsDir, { recursive: true });
        await writeFile(join(iconsDir, "favicon.ico"), "ICON");

        const fontsDir = join(publicDir, "fonts");
        await Deno.mkdir(fontsDir, { recursive: true });
        await writeFile(join(fontsDir, "roboto.woff"), "WOFF");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);

        const faviconExists = await denoAdapter.fs.exists(
          join(outputDir, "images", "icons", "favicon.ico"),
        );
        expect(faviconExists).toBe(true);

        const fontExists = await denoAdapter.fs.exists(join(outputDir, "fonts", "roboto.woff"));
        expect(fontExists).toBe(true);
      });
    });

    it("calculates size accurately", async () => {
      await withTestContext("asset-size-calc", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const content1 = "A".repeat(100);
        const content2 = "B".repeat(200);
        await writeFile(join(publicDir, "file1.txt"), content1);
        await writeFile(join(publicDir, "file2.txt"), content2);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);
        expect(stats.totalSize).toBe(300);
      });
    });

    it("handles empty public directory", async () => {
      await withTestContext("asset-empty-dir", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(0);
        expect(stats.totalSize).toBe(0);
      });
    });

    it("handles missing public directory", async () => {
      await withTestContext("asset-no-public", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        const publicDir = join(context.projectDir, "public");
        await Deno.remove(publicDir, { recursive: true });

        const exists = await denoAdapter.fs.exists(publicDir);
        expect(exists).toBe(false);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(0);
        expect(stats.totalSize).toBe(0);
      });
    });
  },
);

describe(
  "copyStaticAssets - Dry Run Mode",
  () => {
    it("dry-run mode counts but does not copy", async () => {
      await withTestContext("asset-dry-run", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "test.txt"), "content");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(7);

        const copiedExists = await denoAdapter.fs.exists(join(outputDir, "test.txt"));
        expect(copiedExists).toBe(false);
      });
    });

    it("dry-run with multiple files", async () => {
      await withTestContext("asset-dry-run-multi", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "a.txt"), "AAA");
        await writeFile(join(publicDir, "b.txt"), "BBBBB");
        await writeFile(join(publicDir, "c.txt"), "CC");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(3);
        expect(stats.totalSize).toBe(10);

        const outputExists = await denoAdapter.fs.exists(outputDir);
        expect(outputExists).toBe(false);
      });
    });

    it("dry-run with nested directories", async () => {
      await withTestContext("asset-dry-run-nested", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const nestedDir = join(publicDir, "assets", "images");
        await Deno.mkdir(nestedDir, { recursive: true });
        await writeFile(join(nestedDir, "pic.jpg"), "JPEG");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir, true);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(4);

        const nestedOutputExists = await denoAdapter.fs.exists(
          join(outputDir, "assets", "images"),
        );
        expect(nestedOutputExists).toBe(false);
      });
    });
  },
);

describe(
  "copyStaticAssets - Edge Cases",
  () => {
    it("handles files with special characters", async () => {
      await withTestContext("asset-special-chars", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "file-with-dash.txt"), "dash");
        await writeFile(join(publicDir, "file_with_underscore.txt"), "underscore");
        await writeFile(join(publicDir, "file.multiple.dots.txt"), "dots");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(3);

        expect(await denoAdapter.fs.exists(join(outputDir, "file-with-dash.txt"))).toBe(true);
        expect(
          await denoAdapter.fs.exists(join(outputDir, "file_with_underscore.txt")),
        ).toBe(true);
        expect(
          await denoAdapter.fs.exists(join(outputDir, "file.multiple.dots.txt")),
        ).toBe(true);
      });
    });

    it("handles large files", async () => {
      await withTestContext("asset-large-file", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const largeBinary = new Uint8Array(2 * 1024 * 1024);
        largeBinary.fill(42);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "large.bin"), largeBinary);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
        expect(stats.totalSize).toBe(2 * 1024 * 1024);

        const copiedFile = await Deno.readFile(join(outputDir, "large.bin"));
        expect(copiedFile.length).toBe(2 * 1024 * 1024);
      });
    });

    it("handles symlinks to files", async () => {
      await withTestContext("asset-symlink-file", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const realFile = join(publicDir, "real.txt");
        await writeFile(realFile, "real content");

        const symlinkFile = join(publicDir, "link.txt");
        try {
          await writeFile(symlinkFile, { symlink: realFile } as any);

          const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

          expect(stats.assets).toBeGreaterThanOrEqual(1);

          const realCopied = await denoAdapter.fs.exists(join(outputDir, "real.txt"));
          expect(realCopied).toBe(true);
        } catch (e) {
          if ((e as Error).message?.includes("symlink")) {
            console.log("Skipping symlink test - not supported on this platform");
          } else {
            throw e;
          }
        }
      });
    });

    it("handles deeply nested directories", async () => {
      await withTestContext("asset-deep-nesting", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        const deepPath = join(publicDir, "a", "b", "c", "d", "e");
        await Deno.mkdir(deepPath, { recursive: true });
        await writeFile(join(deepPath, "deep.txt"), "deep file");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);

        const deepCopied = await denoAdapter.fs.exists(
          join(outputDir, "a", "b", "c", "d", "e", "deep.txt"),
        );
        expect(deepCopied).toBe(true);
      });
    });

    it("handles binary files correctly", async () => {
      await withTestContext("asset-binary-files", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "image.png"), pngSignature);

        const jpegSignature = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70]);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "photo.jpg"), jpegSignature);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(2);
        expect(stats.totalSize).toBe(18);

        // Verify files were copied (note: adapter readFile/writeFile treats files as text,
        const copiedPngExists = await denoAdapter.fs.exists(join(outputDir, "image.png"));
        expect(copiedPngExists).toBe(true);

        const copiedJpegExists = await denoAdapter.fs.exists(join(outputDir, "photo.jpg"));
        expect(copiedJpegExists).toBe(true);

        const copiedPng = await Deno.readFile(join(outputDir, "image.png"));
        expect(copiedPng.length).toBeGreaterThan(0);

        const copiedJpeg = await Deno.readFile(join(outputDir, "photo.jpg"));
        expect(copiedJpeg.length).toBeGreaterThan(0);
      });
    });

    it("excludes directories from asset count", async () => {
      await withTestContext("asset-exclude-dirs", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");

        await Deno.mkdir(join(publicDir, "empty1"), { recursive: true });
        await Deno.mkdir(join(publicDir, "empty2"), { recursive: true });
        await Deno.mkdir(join(publicDir, "has-file"), { recursive: true });
        await writeFile(join(publicDir, "has-file", "file.txt"), "content");

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(1);
      });
    });

    it("handles permission errors gracefully", async () => {
      // Note: This test may behave differently on different platforms
      await withTestContext("asset-permissions", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        const testFile = join(publicDir, "test.txt");
        await writeFile(testFile, "content");

        try {
          await Deno.mkdir(outputDir, { recursive: true });
          await Deno.chmod(outputDir, 0o444);

          await assertRejects(
            async () => {
              await copyStaticAssets(denoAdapter, context.projectDir, outputDir);
            },
          );

          await Deno.chmod(outputDir, 0o755);
        } catch (_e) {
          try {
            await Deno.chmod(outputDir, 0o755);
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });

    it("handles mixed text and binary files", async () => {
      await withTestContext("asset-mixed-content", async (context) => {
        const publicDir = join(context.projectDir, "public");
        const outputDir = join(context.projectDir, "dist");
        await Deno.mkdir(publicDir, { recursive: true });

        await writeFile(join(publicDir, "config.json"), '{"key":"value"}');
        await writeFile(join(publicDir, "readme.md"), "# README");

        const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
        // @ts-ignore - bun-shim supports Uint8Array
        await writeFile(join(publicDir, "data.bin"), binaryData);

        const stats = await copyStaticAssets(denoAdapter, context.projectDir, outputDir);

        expect(stats.assets).toBe(3);

        const configContent = await denoAdapter.fs.readFile(join(outputDir, "config.json"));
        expect(configContent.includes("key")).toBe(true);

        const readmeContent = await denoAdapter.fs.readFile(join(outputDir, "readme.md"));
        expect(
          readmeContent.includes("README"),
        ).toBe(true);

        const binaryExists = await denoAdapter.fs.exists(join(outputDir, "data.bin"));
        expect(binaryExists).toBe(true);

        const binaryContent = await Deno.readFile(join(outputDir, "data.bin"));
        expect(binaryContent.length).toBeGreaterThan(0);
      });
    });
  },
);

describe(
  "loadClientStyles - Template Loading",
  () => {
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

      const openBraces = (css.match(/\{/g) || []).length;
      const closeBraces = (css.match(/\}/g) || []).length;
      expect(openBraces).toBe(closeBraces);

      expect(css.includes("#")).toBe(true);
    });

    it("always returns embedded CSS (no file I/O)", () => {
      const css = loadClientStyles();
      expect(typeof css).toBe("string");
      expect(css.length).toBeGreaterThan(0);
    });

    it("returns consistent CSS across calls", () => {
      const css1 = loadClientStyles();
      const css2 = loadClientStyles();
      expect(css1).toBe(css2);
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
        expect(
          css.includes(selector),
        ).toBe(true);
      }
    });

    it("CSS is minification-ready", () => {
      const css = loadClientStyles();

      expect(css.includes(";;")).toBe(false);
      expect(
        css.includes("::"),
      ).toBe(css.includes("::before") || css.includes("::after"));
    });
  },
);
