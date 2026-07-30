import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { chunkArray, ImageOptimizer } from "./optimizer-core.ts";
import type { ImageOptimizationSession } from "./optimization-engine.ts";
import type { OptimizedImageMetadata } from "./types.ts";

function populateManifest(
  optimizer: ImageOptimizer,
  entries: Array<[string, OptimizedImageMetadata]>,
): void {
  const manifest = (optimizer as unknown as {
    imageManifest: Map<string, OptimizedImageMetadata>;
  }).imageManifest;
  for (const [key, value] of entries) manifest.set(key, value);
}

const sampleMetadata: OptimizedImageMetadata = {
  original: "photo.jpg",
  originalSize: 24_000,
  variants: [
    {
      format: "webp",
      size: 320,
      width: 320,
      height: 180,
      path: "photo-320w-q80.webp",
      fileSize: 5_000,
      quality: 80,
    },
    {
      format: "webp",
      size: 640,
      width: 640,
      height: 360,
      path: "photo-640w-q80.webp",
      fileSize: 12_000,
      quality: 80,
    },
    {
      format: "avif",
      size: 320,
      width: 320,
      height: 180,
      path: "photo-320w-q80.avif",
      fileSize: 4_000,
      quality: 80,
    },
  ],
  defaultFormat: "webp",
  aspectRatio: 16 / 9,
  engineIdentity: "test-image-engine@1",
  quality: 80,
};

function createSession(options: { fail?: boolean } = {}): ImageOptimizationSession {
  const value: ImageOptimizationSession = {
    cacheIdentity: "test-image-engine@1",
    run: (_input, variants, signal) => {
      if (signal?.aborted) return Promise.reject(new Error("cancelled"));
      if (options.fail) return Promise.reject(new Error("mock encoding failed"));
      return Promise.resolve({
        sourceWidth: 640,
        sourceHeight: 480,
        variants: variants.map((variant) => ({
          format: variant.format,
          width: variant.width,
          height: Math.round(variant.width * 3 / 4),
          data: new Uint8Array([variant.width % 255 || 1, variant.quality]),
        })),
      });
    },
  };
  return Object.freeze(value);
}

async function withTempProject(
  callback: (projectDir: string, inputDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  const inputDir = join(projectDir, "public");
  try {
    await Deno.mkdir(inputDir, { recursive: true });
    await callback(projectDir, inputDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("build/asset-pipeline/image-optimizer/optimizer-core", () => {
  it("chunks bounded concurrent work", () => {
    assertEquals(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assertEquals(chunkArray([], 3), []);
    for (const invalid of [0, -1, 1.5]) {
      assertThrows(() => chunkArray([1], invalid), TypeError);
    }
  });

  it("clones manifest reads and reports aggregate statistics", () => {
    const optimizer = new ImageOptimizer(
      { enabled: false },
      { publicPath: "/_vf/assets/images" },
    );
    populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);
    const exposed = optimizer.getImageMetadata("photo.jpg")!;
    exposed.variants.length = 0;
    assertEquals(optimizer.getImageMetadata("photo.jpg")?.variants.length, 3);
    assertEquals(optimizer.getImageMetadata("missing.jpg"), null);
    assertEquals(optimizer.generateSrcSet("missing.jpg"), "");
    assertEquals(
      optimizer.generateSrcSet("photo.jpg", "avif"),
      "/_vf/assets/images/photo-320w-q80.avif 320w",
    );
    assertEquals(optimizer.getStats(), {
      totalImages: 1,
      totalVariants: 3,
      totalSize: 21_000,
      averageVariantSize: 7_000,
      averageSavings: 7_000,
    });

    const withoutPublicPath = new ImageOptimizer({ enabled: false });
    populateManifest(withoutPublicPath, [["photo.jpg", sampleMetadata]]);
    assertThrows(
      () => withoutPublicPath.generateSrcSet("photo.jpg"),
      TypeError,
      "requires an explicit publicPath",
    );
  });

  it("rejects unsafe, empty, and ambiguous configuration", async () => {
    await withTempProject(async (projectDir) => {
      assertThrows(
        () => new ImageOptimizer({ projectDir: "relative" }),
        TypeError,
        "must be absolute",
      );
      assertThrows(
        () =>
          new ImageOptimizer({
            projectDir,
            inputDir: "public",
            outputDir: "public/images",
          }),
        TypeError,
        "must not overlap",
      );
      assertThrows(
        () => new ImageOptimizer({ projectDir, formats: ["webp", "webp"] }),
        TypeError,
        "unique",
      );
      assertThrows(
        () => new ImageOptimizer({ projectDir, sizes: [] }),
        TypeError,
        "at most",
      );
      assertThrows(
        () => new ImageOptimizer({ projectDir }, { publicPath: "/.veryfront/images" }),
        TypeError,
        "absolute URL path",
      );
    });
  });

  it("does not resolve an engine when disabled", async () => {
    const optimizer = new ImageOptimizer({ enabled: false });
    assertEquals(await optimizer.init(), false);
  });

  it("publishes exact requested variants, identity, quality, and original", async () => {
    await withTempProject(async (projectDir, inputDir) => {
      const source = new Uint8Array([9, 8, 7]);
      await Deno.writeFile(join(inputDir, "photo.jpg"), source);
      const optimizer = new ImageOptimizer(
        {
          projectDir,
          inputDir: "public",
          outputDir: ".veryfront/images",
          formats: ["webp", "jpeg"],
          sizes: [640, 320],
          quality: 73,
          preserveOriginal: true,
        },
        {
          optimizationSession: createSession(),
          publicPath: "/_vf/assets/images",
        },
      );

      const manifest = await optimizer.optimize();
      const metadata = manifest.get("photo.jpg")!;
      assertEquals(metadata.originalSize, source.length);
      assertEquals(metadata.engineIdentity, "test-image-engine@1");
      assertEquals(metadata.quality, 73);
      assertEquals(metadata.variants.map((variant) => variant.path), [
        "photo-320w-q73.webp",
        "photo-320w-q73.jpeg",
        "photo-640w-q73.webp",
        "photo-640w-q73.jpeg",
      ]);
      assertEquals(
        await Deno.readFile(join(projectDir, ".veryfront/images/photo.jpg")),
        source,
      );
      assertEquals(
        optimizer.generateSrcSet("photo.jpg", "jpeg"),
        "/_vf/assets/images/photo-320w-q73.jpeg 320w, " +
          "/_vf/assets/images/photo-640w-q73.jpeg 640w",
      );

      metadata.variants.length = 0;
      assertEquals(optimizer.getImageMetadata("photo.jpg")?.variants.length, 4);
    });
  });

  it("preserves last-known-good output when the engine fails", async () => {
    await withTempProject(async (projectDir, inputDir) => {
      await Deno.writeFile(join(inputDir, "photo.jpg"), new Uint8Array([9]));
      const outputDir = join(projectDir, ".veryfront/images");
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.writeTextFile(join(outputDir, "sentinel.txt"), "known good");
      const optimizer = new ImageOptimizer(
        {
          projectDir,
          inputDir: "public",
          outputDir: ".veryfront/images",
          formats: ["webp"],
          sizes: [320],
        },
        { optimizationSession: createSession({ fail: true }) },
      );

      await assertRejects(() => optimizer.optimize(), Error, "mock encoding failed");
      assertEquals(
        await Deno.readTextFile(join(outputDir, "sentinel.txt")),
        "known good",
      );
      assertEquals(optimizer.getStats().totalImages, 0);
      const parentEntries = [];
      for await (const entry of Deno.readDir(join(projectDir, ".veryfront"))) {
        parentEntries.push(entry.name);
      }
      assertEquals(
        parentEntries.some((name) =>
          name.includes(".images.veryfront-stage-") ||
          name.includes(".images.veryfront-build.lock")
        ),
        false,
      );
    });
  });

  it("rejects empty enabled input without replacing existing output", async () => {
    await withTempProject(async (projectDir) => {
      const outputDir = join(projectDir, ".veryfront/images");
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.writeTextFile(join(outputDir, "sentinel.txt"), "known good");
      const optimizer = new ImageOptimizer(
        {
          projectDir,
          inputDir: "public",
          outputDir: ".veryfront/images",
          formats: ["webp"],
          sizes: [320],
        },
        { optimizationSession: createSession() },
      );
      await assertRejects(
        () => optimizer.optimize(),
        TypeError,
        "found no supported images",
      );
      assertEquals(
        await Deno.readTextFile(join(outputDir, "sentinel.txt")),
        "known good",
      );
    });
  });
});
