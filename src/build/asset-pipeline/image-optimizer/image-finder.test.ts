import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findImages } from "./image-finder.ts";

describe("build/asset-pipeline/image-optimizer/image-finder", () => {
  describe("findImages", () => {
    it("should return empty array for non-existent directory", async () => {
      const result = await findImages("/tmp/nonexistent-dir-" + Date.now());
      assertEquals(result, []);
    });

    it("should find images in a directory with supported extensions", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        // Create files with supported extensions
        await Deno.writeTextFile(`${tmpDir}/photo.jpg`, "");
        await Deno.writeTextFile(`${tmpDir}/photo.jpeg`, "");
        await Deno.writeTextFile(`${tmpDir}/icon.png`, "");
        await Deno.writeTextFile(`${tmpDir}/hero.webp`, "");
        await Deno.writeTextFile(`${tmpDir}/pic.avif`, "");
        // Create non-image files
        await Deno.writeTextFile(`${tmpDir}/readme.md`, "");
        await Deno.writeTextFile(`${tmpDir}/app.ts`, "");

        const result = await findImages(tmpDir);
        assertEquals(result.length, 5);
        // All found files should have supported extensions
        for (const file of result) {
          const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
          assertEquals(
            [".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(ext),
            true,
          );
        }
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should return empty array for empty directory", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const result = await findImages(tmpDir);
        assertEquals(result, []);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should find images in subdirectories", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${tmpDir}/subdir`, { recursive: true });
        await Deno.writeTextFile(`${tmpDir}/subdir/nested.png`, "");
        await Deno.writeTextFile(`${tmpDir}/top.jpg`, "");

        const result = await findImages(tmpDir);
        assertEquals(result.length, 2);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should skip unsupported extensions like .svg and .gif", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${tmpDir}/logo.svg`, "");
        await Deno.writeTextFile(`${tmpDir}/anim.gif`, "");
        await Deno.writeTextFile(`${tmpDir}/photo.bmp`, "");

        const result = await findImages(tmpDir);
        assertEquals(result.length, 0);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
