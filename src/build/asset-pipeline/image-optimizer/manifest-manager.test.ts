import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readTextFile } from "#veryfront/testing/deno-compat.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { MAX_IMAGE_MANIFEST_BYTES } from "./constants.ts";
import { loadManifest, writeManifest } from "./manifest-manager.ts";
import type { OptimizedImageMetadata } from "./types.ts";

describe("manifest-manager", () => {
  it("writes and loads manifests via compat fs", async () => {
    const tmpDir = await makeTempDir();
    try {
      const manifest = new Map<string, OptimizedImageMetadata>([
        [
          "logo.png",
          {
            original: "logo.png",
            originalSize: 2048,
            variants: [
              {
                format: "webp",
                size: 400,
                width: 400,
                height: 200,
                path: "logo-400.webp",
                fileSize: 1234,
              },
            ],
            defaultFormat: "webp",
            aspectRatio: 2,
          },
        ],
      ]);

      await writeManifest(manifest, tmpDir);

      const manifestPath = join(tmpDir, "image-manifest.json");
      const parsed = JSON.parse(await readTextFile(manifestPath)) as Record<
        string,
        OptimizedImageMetadata
      >;

      assertEquals(parsed.logo, undefined);
      assertEquals(parsed["logo.png"]?.defaultFormat, "webp");

      const loaded = await loadManifest(tmpDir);
      assertEquals(loaded.size, 1);
      assertEquals(loaded.get("logo.png")?.defaultFormat, "webp");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("returns an empty manifest only when the file is absent", async () => {
    const tmpDir = await makeTempDir();
    try {
      assertEquals((await loadManifest(tmpDir)).size, 0);

      await Deno.writeTextFile(join(tmpDir, "real-manifest.json"), "{}");
      await Deno.symlink(
        join(tmpDir, "real-manifest.json"),
        join(tmpDir, "image-manifest.json"),
      );
      await assertRejects(
        () => loadManifest(tmpDir),
        TypeError,
        "Image manifest must be a regular file",
        "a symlinked manifest must fail loudly instead of loading as empty",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("rejects an oversized manifest instead of returning an empty one", async () => {
    const oversizedFs = {
      lstat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: MAX_IMAGE_MANIFEST_BYTES + 1,
        }),
      readTextFile: () => Promise.reject(new Error("an oversized manifest must not be read")),
    } as unknown as FileSystem;

    await assertRejects(
      () => loadManifest("/manifest-dir", oversizedFs),
      TypeError,
      "exceeds",
      "an oversized manifest must fail loudly instead of loading as empty",
    );
  });

  it("rejects malformed JSON and malformed entries", async () => {
    const tmpDir = await makeTempDir();
    const manifestPath = join(tmpDir, "image-manifest.json");
    try {
      await Deno.writeTextFile(manifestPath, "{");
      await assertRejects(() => loadManifest(tmpDir), SyntaxError);

      await Deno.writeTextFile(
        manifestPath,
        JSON.stringify({
          "../logo.png": {
            original: "../logo.png",
            variants: [],
            defaultFormat: "webp",
            aspectRatio: 2,
          },
        }),
      );
      await assertRejects(
        () => loadManifest(tmpDir),
        TypeError,
        "malformed",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("loads legacy entries without originalSize", async () => {
    const tmpDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tmpDir, "image-manifest.json"),
        JSON.stringify({
          "logo.png": {
            original: "logo.png",
            variants: [{
              format: "webp",
              size: 400,
              width: 400,
              height: 200,
              path: "logo-400.webp",
              fileSize: 1234,
            }],
            defaultFormat: "webp",
            aspectRatio: 2,
          },
        }),
      );

      const loaded = await loadManifest(tmpDir);
      assertEquals(loaded.get("logo.png")?.originalSize, undefined);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("normalizes exact duplicate variants emitted by the legacy generator", async () => {
    const tmpDir = await makeTempDir();
    const variant = {
      format: "webp",
      size: 400,
      width: 400,
      height: 200,
      path: "logo-400.webp",
      fileSize: 1234,
    };
    try {
      await Deno.writeTextFile(
        join(tmpDir, "image-manifest.json"),
        JSON.stringify({
          "logo.png": {
            original: "logo.png",
            variants: [variant, { ...variant }],
            defaultFormat: "webp",
            aspectRatio: 2,
          },
        }),
      );

      const loaded = await loadManifest(tmpDir);
      assertEquals(loaded.get("logo.png")?.variants, [variant]);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("rejects conflicting duplicate variants instead of normalizing them", async () => {
    const tmpDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tmpDir, "image-manifest.json"),
        JSON.stringify({
          "logo.png": {
            original: "logo.png",
            variants: [
              {
                format: "webp",
                size: 400,
                width: 400,
                height: 200,
                path: "logo-400.webp",
                fileSize: 1234,
              },
              {
                format: "webp",
                size: 400,
                width: 400,
                height: 200,
                path: "logo-400.webp",
                fileSize: 4321,
              },
            ],
            defaultFormat: "webp",
            aspectRatio: 2,
          },
        }),
      );

      await assertRejects(
        () => loadManifest(tmpDir),
        TypeError,
        "malformed",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
