import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateSrcSet,
  getImageExtension,
  getOptimizedImageVariantWidths,
  getOptimizedPath,
} from "./helpers.ts";

const INVALID_IMAGE_DIMENSIONS_WARNING =
  "[Veryfront] Optimized image width and targetWidths must contain positive integers " +
  "within the build image limit. Rendering the original asset instead.";

describe("optimized-image helpers", () => {
  describe("getOptimizedPath", () => {
    it("generates path with size and format", () => {
      assertEquals(
        getOptimizedPath("/images/photo.png", "webp", 640),
        "/.veryfront/optimized-images/images/photo-640w.webp",
      );
    });

    it("strips original extension", () => {
      assertEquals(
        getOptimizedPath("/hero.jpg", "avif", 1024),
        "/.veryfront/optimized-images/hero-1024w.avif",
      );
    });

    it("handles nested paths", () => {
      assertEquals(
        getOptimizedPath("/assets/blog/cover.jpeg", "webp", 320),
        "/.veryfront/optimized-images/assets/blog/cover-320w.webp",
      );
    });

    it("encodes path segments and ignores URL suffixes", () => {
      assertEquals(
        getOptimizedPath("/images/photo, hero.jpg?v=1#preview", "webp", 640),
        "/.veryfront/optimized-images/images/photo%2C%20hero-640w.webp",
      );
    });

    it("keeps non-app and boundary-changing paths on the original asset", () => {
      for (
        const src of [
          "https://cdn.example/photo.jpg",
          "//cdn.example/photo.jpg",
          "/images/../private.jpg",
          "/images/%2e%2e/private.jpg",
          "/images/nested%2fprivate.jpg",
          "/images/bad%2.jpg",
          "/images\\photo.jpg",
        ]
      ) {
        assertEquals(getOptimizedPath(src, "webp", 640), src);
        assertEquals(generateSrcSet(src, "webp", [320, 640], 80), "");
      }
    });
  });

  describe("generateSrcSet", () => {
    it("generates srcset string with multiple sizes", () => {
      const parts = generateSrcSet("/photo.png", "webp", [320, 640, 1024], 80).split(", ");
      assertEquals(
        parts.map((part) => part.slice(part.lastIndexOf(" ") + 1)),
        ["320w", "640w", "1024w"],
      );
    });

    it("generates single-size srcset", () => {
      const srcset = generateSrcSet("/photo.png", "webp", [640], 80);
      assertEquals(srcset.includes("640w"), true);
      assertEquals(srcset.includes(","), false);
    });
  });

  describe("getImageExtension", () => {
    it("returns extension for known image types", () => {
      assertEquals(getImageExtension("/photo.png"), "png");
      assertEquals(getImageExtension("/photo.webp"), "webp");
    });

    it("normalizes jpg to the jpeg variant the build emits", () => {
      assertEquals(getImageExtension("/photo.jpg"), "jpeg");
      assertEquals(getImageExtension("/photo.jpeg"), "jpeg");
      assertEquals(getImageExtension("/photo.jpg?v=1#preview"), "jpeg");
    });

    it("returns jpeg for paths without extension", () => {
      assertEquals(getImageExtension("/photo"), "jpeg");
    });

    it("handles nested paths", () => {
      assertEquals(getImageExtension("/images/blog/hero.avif"), "avif");
    });
  });

  describe("getOptimizedImageVariantWidths", () => {
    it("contains malformed browser props and warns once only in development", () => {
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
      const originalVeryfrontDev = Object.getOwnPropertyDescriptor(
        globalThis,
        "__VERYFRONT_DEV__",
      );
      const originalRscDev = Object.getOwnPropertyDescriptor(globalThis, "__RSC_DEV__");
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];
      const hostileWidths = new Proxy([] as number[], {
        get(_target, property) {
          if (property === "length") throw new Error("unreadable target widths");
          return undefined;
        },
      });
      const restore = (key: string, descriptor: PropertyDescriptor | undefined) => {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      };

      Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
      Object.defineProperty(globalThis, "__VERYFRONT_DEV__", {
        configurable: true,
        value: false,
      });
      Object.defineProperty(globalThis, "__RSC_DEV__", {
        configurable: true,
        value: false,
        writable: true,
      });
      console.warn = (...args: unknown[]) => warnings.push(args);

      try {
        assertEquals(getOptimizedImageVariantWidths(Number.NaN), []);
        assertEquals(getOptimizedImageVariantWidths(640, hostileWidths), []);
        assertEquals(warnings, []);

        Object.defineProperty(globalThis, "__RSC_DEV__", { value: true });
        assertEquals(getOptimizedImageVariantWidths(Number.NaN), []);
        assertEquals(getOptimizedImageVariantWidths(640, hostileWidths), []);
        assertEquals(warnings, [[INVALID_IMAGE_DIMENSIONS_WARNING]]);
      } finally {
        console.warn = originalWarn;
        restore("window", originalWindow);
        restore("__VERYFRONT_DEV__", originalVeryfrontDev);
        restore("__RSC_DEV__", originalRscDev);
      }
    });
  });
});
