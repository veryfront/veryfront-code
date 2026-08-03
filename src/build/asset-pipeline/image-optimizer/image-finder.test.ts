import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findImages } from "./image-finder.ts";

describe("build/asset-pipeline/image-optimizer/image-finder", () => {
  describe("findImages", () => {
    it("should reject a non-existent directory", async () => {
      await assertRejects(
        () => findImages("/tmp/nonexistent-dir-" + crypto.randomUUID()),
      );
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
        assertEquals(result, [...result].sort());
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should skip unsupported extensions and extension-only dotfiles", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${tmpDir}/logo.svg`, "");
        await Deno.writeTextFile(`${tmpDir}/anim.gif`, "");
        await Deno.writeTextFile(`${tmpDir}/photo.bmp`, "");
        await Deno.writeTextFile(`${tmpDir}/.jpg`, "");
        await Deno.writeTextFile(`${tmpDir}/.png`, "");

        const result = await findImages(tmpDir);
        assertEquals(result.length, 0);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should reject image sets above the bounded discovery limit", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${tmpDir}/a.jpg`, "");
        await Deno.writeTextFile(`${tmpDir}/b.jpg`, "");

        await assertRejects(
          () => findImages(tmpDir, { maxImages: 1 }),
          TypeError,
          "configured limit",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
