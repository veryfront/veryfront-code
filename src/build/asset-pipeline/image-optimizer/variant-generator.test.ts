import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { generateImageVariants } from "./variant-generator.ts";
import type { ImageFormat, SharpConstructor, SharpInstance, SharpMetadata } from "./types.ts";

function createMockSharpInstance(
  metadata: SharpMetadata = { width: 1920, height: 1080 },
  bufferContent = new Uint8Array([1, 2, 3]),
): SharpInstance {
  const instance: SharpInstance = {
    metadata: () => Promise.resolve(metadata),
    clone: () => createMockSharpInstance(metadata, bufferContent),
    resize: (_w, _h, _opts) => instance,
    webp: (_opts) => instance,
    avif: (_opts) => instance,
    jpeg: (_opts) => instance,
    png: (_opts) => instance,
    toBuffer: () => Promise.resolve(bufferContent),
  };
  return instance;
}

function createMockSharp(
  metadata: SharpMetadata = { width: 1920, height: 1080 },
): SharpConstructor {
  return (_input: Uint8Array) => createMockSharpInstance(metadata);
}

// We need a temp dir for filesystem writes that generateVariant does
async function withTempOutputDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe("build/asset-pipeline/image-optimizer/variant-generator", () => {
  describe("generateImageVariants", () => {
    it("should generate variants for each format and size combination", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp();
        const image = createMockSharpInstance();
        const formats: ImageFormat[] = ["webp", "avif"];
        const sizes = [320, 640];
        const metadata: SharpMetadata = { width: 1920, height: 1080 };

        const variants = await generateImageVariants(
          sharp,
          image,
          "test.jpg",
          metadata,
          formats,
          sizes,
          80,
          outputDir,
        );

        // sizes [320, 640] + originalWidth [1920] = 3 sizes x 2 formats = 6 variants
        assertEquals(variants.length, 6, "should produce variant for each size x format");
      });
    });

    it("should filter out sizes larger than original image width", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp({ width: 500, height: 300 });
        const image = createMockSharpInstance({ width: 500, height: 300 });
        const formats: ImageFormat[] = ["webp"];
        const sizes = [320, 640, 1280]; // 640 and 1280 > 500

        const variants = await generateImageVariants(
          sharp,
          image,
          "small.jpg",
          { width: 500, height: 300 },
          formats,
          sizes,
          80,
          outputDir,
        );

        // validSizes = [320] (only 320 <= 500), plus originalWidth [500] = 2 sizes x 1 format = 2
        assertEquals(variants.length, 2, "should filter sizes exceeding original width");
      });
    });

    it("should include original width as a variant", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp({ width: 800, height: 600 });
        const image = createMockSharpInstance({ width: 800, height: 600 });
        const formats: ImageFormat[] = ["webp"];
        const sizes = [320];

        const variants = await generateImageVariants(
          sharp,
          image,
          "photo.jpg",
          { width: 800, height: 600 },
          formats,
          sizes,
          80,
          outputDir,
        );

        // validSizes = [320] + originalWidth [800] = 2 sizes x 1 format = 2
        assertEquals(variants.length, 2, "should include original width variant");
      });
    });

    it("rejects metadata without a width", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp({ height: 600 }); // no width
        const image = createMockSharpInstance({ height: 600 });
        const formats: ImageFormat[] = ["webp"];
        const sizes = [320, 640];

        await assertRejects(
          () =>
            generateImageVariants(
              sharp,
              image,
              "nowidth.jpg",
              { height: 600 },
              formats,
              sizes,
              80,
              outputDir,
            ),
          TypeError,
          "dimensions",
        );
      });
    });

    it("should handle empty sizes array", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp();
        const image = createMockSharpInstance();
        const formats: ImageFormat[] = ["webp"];

        const variants = await generateImageVariants(
          sharp,
          image,
          "test.jpg",
          { width: 1920, height: 1080 },
          formats,
          [], // no additional sizes
          80,
          outputDir,
        );

        // [] + originalWidth [1920] = 1 size x 1 format = 1
        assertEquals(variants.length, 1, "should still include original width variant");
      });
    });

    it("rejects an empty formats array", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp();
        const image = createMockSharpInstance();

        await assertRejects(
          () =>
            generateImageVariants(
              sharp,
              image,
              "test.jpg",
              { width: 1920, height: 1080 },
              [],
              [320],
              80,
              outputDir,
            ),
          TypeError,
          "format",
        );
      });
    });

    it("should return variants with correct format field", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp({ width: 640, height: 480 });
        const image = createMockSharpInstance({ width: 640, height: 480 });
        const formats: ImageFormat[] = ["webp", "jpeg"];

        const variants = await generateImageVariants(
          sharp,
          image,
          "test.jpg",
          { width: 640, height: 480 },
          formats,
          [320],
          80,
          outputDir,
        );

        const webpVariants = variants.filter((v) => v.format === "webp");
        const jpegVariants = variants.filter((v) => v.format === "jpeg");

        assertEquals(webpVariants.length > 0, true, "should have webp variants");
        assertEquals(jpegVariants.length > 0, true, "should have jpeg variants");
      });
    });

    it("should return variants with fileSize property", async () => {
      await withTempOutputDir(async (outputDir) => {
        const sharp = createMockSharp({ width: 640, height: 480 });
        const image = createMockSharpInstance({ width: 640, height: 480 });

        const variants = await generateImageVariants(
          sharp,
          image,
          "test.jpg",
          { width: 640, height: 480 },
          ["webp"],
          [320],
          80,
          outputDir,
        );

        for (const variant of variants) {
          assertEquals(typeof variant.fileSize, "number", "fileSize should be a number");
          assertEquals(variant.fileSize > 0, true, "fileSize should be positive");
        }
      });
    });

    it("deduplicates configured sizes and the original width", async () => {
      await withTempOutputDir(async (outputDir) => {
        const variants = await generateImageVariants(
          createMockSharp({ width: 640, height: 480 }),
          createMockSharpInstance({ width: 640, height: 480 }),
          "test.jpg",
          { width: 640, height: 480 },
          ["webp"],
          [320, 320, 640],
          80,
          outputDir,
        );
        assertEquals(variants.map((variant) => variant.size), [320, 640]);
      });
    });

    it("rejects invalid configured sizes and duplicate formats", async () => {
      await withTempOutputDir(async (outputDir) => {
        for (const sizes of [[0], [1.5], [Number.NaN], [16_385]]) {
          await assertRejects(
            () =>
              generateImageVariants(
                createMockSharp(),
                createMockSharpInstance(),
                "test.jpg",
                { width: 1920, height: 1080 },
                ["webp"],
                sizes,
                80,
                outputDir,
              ),
            TypeError,
            "sizes",
          );
        }

        await assertRejects(
          () =>
            generateImageVariants(
              createMockSharp(),
              createMockSharpInstance(),
              "test.jpg",
              { width: 1920, height: 1080 },
              ["webp", "webp"],
              [320],
              80,
              outputDir,
            ),
          TypeError,
          "duplicate",
        );
      });
    });

    it("rejects encoded variants without valid dimensions", async () => {
      await withTempOutputDir(async (outputDir) => {
        await assertRejects(
          () =>
            generateImageVariants(
              createMockSharp({}),
              createMockSharpInstance({ width: 640, height: 480 }),
              "test.jpg",
              { width: 640, height: 480 },
              ["webp"],
              [320],
              80,
              outputDir,
            ),
          TypeError,
          "Encoded image dimensions",
        );
      });
    });

    it("rejects images without valid dimensions", async () => {
      await withTempOutputDir(async (outputDir) => {
        await assertRejects(
          () =>
            generateImageVariants(
              createMockSharp({}),
              createMockSharpInstance({}),
              "test.jpg",
              {},
              ["webp"],
              [320],
              80,
              outputDir,
            ),
          TypeError,
          "dimensions",
        );
      });
    });

    it("propagates variant encoding failures", async () => {
      await withTempOutputDir(async (outputDir) => {
        const broken = createMockSharpInstance({ width: 640, height: 480 });
        broken.toBuffer = () => Promise.reject(new Error("encoding failed"));
        broken.clone = () => broken;
        await assertRejects(
          () =>
            generateImageVariants(
              createMockSharp({ width: 640, height: 480 }),
              broken,
              "test.jpg",
              { width: 640, height: 480 },
              ["webp"],
              [320],
              80,
              outputDir,
            ),
          Error,
          "encoding failed",
        );
      });
    });
  });
});
