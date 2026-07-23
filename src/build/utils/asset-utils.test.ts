import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.ts";
import {
  calculateAspectRatio,
  generateSrcSet,
  getImageDimensions,
  getStandardPseudoSelectors,
  getVariantPath,
  globFiles,
  isPseudoSelector,
} from "./asset-utils.ts";

function createMetadata(
  overrides: Partial<OptimizedImageMetadata> = {},
): OptimizedImageMetadata {
  return {
    original: "img.jpg",
    defaultFormat: "webp",
    aspectRatio: 4 / 3,
    variants: [],
    ...overrides,
  };
}

describe("build/utils/asset-utils", () => {
  describe("globFiles", () => {
    it("bounds matching file materialization", async () => {
      const dir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${dir}/one.ts`, "");
        await Deno.writeTextFile(`${dir}/two.ts`, "");

        await assertRejects(
          () => globFiles(`${dir}/*.ts`, { maxResults: 1 }),
          TypeError,
          "maxResults",
        );
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("validates explicit scan limits", async () => {
      await assertRejects(
        () => globFiles("*.ts", { maxScannedEntries: 0 }),
        TypeError,
        "maxScannedEntries",
      );
    });
  });

  describe("isPseudoSelector", () => {
    it("should detect pseudo selectors", () => {
      assertEquals(isPseudoSelector(":hover"), true);
      assertEquals(isPseudoSelector("::before"), true);
      assertEquals(isPseudoSelector("button:focus"), true);
    });

    it("should reject non-pseudo selectors", () => {
      assertEquals(isPseudoSelector(".class"), false);
      assertEquals(isPseudoSelector("#id"), false);
      assertEquals(isPseudoSelector("div"), false);
    });
  });

  describe("getStandardPseudoSelectors", () => {
    it("should return an array of pseudo selectors", () => {
      const selectors = getStandardPseudoSelectors();
      assertEquals(Array.isArray(selectors), true);
      assertEquals(selectors.length > 0, true);
      assertEquals(selectors.includes(":hover"), true);
      assertEquals(selectors.includes("::before"), true);
      assertEquals(selectors.includes(":focus"), true);
    });
  });

  describe("getVariantPath", () => {
    it("should generate variant path with size and format", () => {
      const result = getVariantPath("/out", "images/hero.jpg", "webp", 800);
      assertEquals(result.includes("hero-800w.webp"), true);
    });

    it("should preserve directory structure", () => {
      const result = getVariantPath("/out", "deep/nested/img.png", "avif", 400);
      assertEquals(result.includes("deep/nested/"), true);
      assertEquals(result.includes("img-400w.avif"), true);
    });

    it("rejects paths that escape the image input directory", () => {
      assertThrows(
        () => getVariantPath("/out", "../secret.jpg", "webp", 400),
        TypeError,
        "relative",
      );
      assertThrows(
        () => getVariantPath("/out", "/secret.jpg", "webp", 400),
        TypeError,
        "relative",
      );
    });

    it("rejects invalid target widths", () => {
      assertThrows(
        () => getVariantPath("/out", "hero.jpg", "webp", 0),
        TypeError,
        "positive integer",
      );
    });

    it("rejects unsafe paths and runtime format values", () => {
      for (const path of ["images//hero.jpg", "./hero.jpg", "images/../hero.jpg", "hero\n.jpg"]) {
        assertThrows(
          () => getVariantPath("/out", path, "webp", 400),
          TypeError,
          "safe relative path",
        );
      }
      assertThrows(
        () => getVariantPath("/out", "hero.jpg", "../../js" as never, 400),
        TypeError,
        "Unsupported image variant format",
      );
    });
  });

  describe("calculateAspectRatio", () => {
    it("should calculate correct ratio", () => {
      assertEquals(calculateAspectRatio(1920, 1080), 1920 / 1080);
      assertEquals(calculateAspectRatio(100, 100), 1);
    });

    it("rejects missing, non-finite, and non-positive dimensions", () => {
      for (
        const [width, height] of [
          [undefined, 100],
          [100, undefined],
          [0, 100],
          [100, Number.NaN],
        ] as const
      ) {
        assertThrows(
          () => calculateAspectRatio(width, height),
          TypeError,
          "positive finite",
        );
      }
    });
  });

  describe("generateSrcSet", () => {
    it("should generate srcset string from variants", () => {
      const metadata = createMetadata({
        original: "hero.jpg",
        variants: [
          {
            path: "hero-400w.webp",
            format: "webp",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
          {
            path: "hero-800w.webp",
            format: "webp",
            width: 800,
            height: 600,
            size: 2000,
            fileSize: 2000,
          },
          {
            path: "hero-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      });

      const srcSet = generateSrcSet("hero.jpg", metadata, "/assets");
      assertEquals(
        srcSet,
        "/assets/hero-400w.webp 400w, /assets/hero-800w.webp 800w",
      );
    });

    it("should filter by specified format", () => {
      const metadata = createMetadata({
        variants: [
          {
            path: "img-400w.webp",
            format: "webp",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      });

      const srcSet = generateSrcSet("img.jpg", metadata, "/assets", "avif");
      assertEquals(srcSet.includes("avif"), true);
      assertEquals(srcSet.includes("webp"), false);
    });

    it("encodes variant path segments without exposing filesystem paths", () => {
      const metadata = createMetadata({
        original: "hero.jpg",
        variants: [{
          path: "blog/hero image.webp",
          format: "webp",
          width: 800,
          height: 600,
          size: 1000,
          fileSize: 1000,
        }],
      });

      assertEquals(
        generateSrcSet("hero.jpg", metadata, "/.veryfront/optimized-images"),
        "/.veryfront/optimized-images/blog/hero%20image.webp 800w",
      );
    });

    it("rejects an unsafe public path", () => {
      const metadata = createMetadata({
        original: "hero.jpg",
        variants: [{
          path: "hero.webp",
          format: "webp",
          width: 800,
          height: 600,
          size: 1000,
          fileSize: 1000,
        }],
      });

      assertThrows(
        () => generateSrcSet("hero.jpg", metadata, "assets"),
        TypeError,
        "publicPath",
      );
    });

    it("rejects mismatched metadata and missing format variants", () => {
      const metadata = createMetadata({
        variants: [{
          path: "img-400w.webp",
          format: "webp",
          width: 400,
          height: 300,
          size: 1000,
          fileSize: 1000,
        }],
      });
      assertThrows(
        () => generateSrcSet("other.jpg", metadata, "/assets"),
        TypeError,
        "does not match",
      );
      assertThrows(
        () => generateSrcSet("img.jpg", metadata, "/assets", "avif"),
        TypeError,
        "no variants",
      );
    });
  });

  describe("getImageDimensions", () => {
    it("should return dimensions of default format variant", () => {
      const metadata = createMetadata({
        variants: [
          {
            path: "img-800w.webp",
            format: "webp",
            width: 800,
            height: 600,
            size: 2000,
            fileSize: 2000,
          },
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
        ],
      });

      const dims = getImageDimensions(metadata);
      assertEquals(dims.width, 800);
      assertEquals(dims.height, 600);
    });

    it("rejects metadata without a default-format variant", () => {
      const metadata = createMetadata({
        defaultFormat: "png",
        variants: [
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      });

      assertThrows(
        () => getImageDimensions(metadata),
        Error,
        "No default-format image variants",
      );
    });

    it("returns the largest default-format variant", () => {
      const metadata = createMetadata({
        variants: [
          {
            path: "img-400w.webp",
            format: "webp",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
          {
            path: "img-1200w.webp",
            format: "webp",
            width: 1200,
            height: 900,
            size: 3000,
            fileSize: 3000,
          },
        ],
      });

      assertEquals(getImageDimensions(metadata), { width: 1200, height: 900 });
    });

    it("should throw if no variants", () => {
      const metadata = createMetadata({ aspectRatio: 1, variants: [] });
      assertThrows(() => getImageDimensions(metadata));
    });
  });
});
