import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.ts";
import {
  calculateAspectRatio,
  calculateRequiredAspectRatio,
  findCSSFiles,
  generateSrcSet,
  getImageDimensions,
  getRequiredImageDimensions,
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
    originalSize: 1_024,
    defaultFormat: "webp",
    aspectRatio: 4 / 3,
    variants: [],
    ...overrides,
  };
}

describe("build/utils/asset-utils", () => {
  describe("asset discovery", () => {
    it("returns lexical files without following symbolic links", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-asset-utils-" });
      const nested = `${root}/nested`;
      const outside = await Deno.makeTempDir({ prefix: "vf-asset-utils-outside-" });
      await Deno.mkdir(nested);
      await Deno.writeTextFile(`${root}/z.css`, "z");
      await Deno.writeTextFile(`${nested}/a.css`, "a");
      await Deno.writeTextFile(`${outside}/linked.css`, "linked");
      await Deno.symlink(`${outside}/linked.css`, `${root}/linked.css`, { type: "file" });

      try {
        assertEquals(await findCSSFiles(root), [
          `${nested}/a.css`,
          `${root}/z.css`,
        ]);
        assertEquals(await globFiles(`${root}/**/*.css`), [
          `${nested}/a.css`,
          `${root}/z.css`,
        ]);
      } finally {
        await Deno.remove(root, { recursive: true });
        await Deno.remove(outside, { recursive: true });
      }
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
  });

  describe("calculateAspectRatio", () => {
    it("should calculate correct ratio", () => {
      assertEquals(calculateAspectRatio(1920, 1080), 1920 / 1080);
      assertEquals(calculateAspectRatio(100, 100), 1);
    });

    it("should preserve the legacy square fallback for missing dimensions", () => {
      assertEquals(calculateAspectRatio(undefined, 100), 1);
      assertEquals(calculateAspectRatio(100, undefined), 1);
    });

    it("should provide a strict calculation for production build paths", () => {
      assertEquals(calculateRequiredAspectRatio(1920, 1080), 1920 / 1080);
      assertThrows(() => calculateRequiredAspectRatio(0, 100), TypeError);
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

      const srcSet = generateSrcSet("hero.jpg", metadata, "assets");
      assertEquals(srcSet.includes("400w"), true);
      assertEquals(srcSet.includes("800w"), true);
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

      const srcSet = generateSrcSet("img.jpg", metadata, "assets", "avif");
      assertEquals(srcSet.includes("avif"), true);
      assertEquals(srcSet.includes("webp"), false);
    });
  });

  describe("getImageDimensions", () => {
    it("should return dimensions of default format variant", () => {
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

    it("should preserve the legacy fallback to an available format", () => {
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

      assertEquals(getImageDimensions(metadata), { width: 400, height: 300 });
      assertThrows(
        () => getRequiredImageDimensions(metadata),
        Error,
        "No png image variants",
      );
    });

    it("should throw if no variants", () => {
      const metadata = createMetadata({ aspectRatio: 1, variants: [] });
      assertThrows(() => getImageDimensions(metadata));
    });
  });
});
