import "#veryfront/schemas/_test-setup.ts";
import type * as React from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cssUrl,
  generateSrcSet,
  getImageExtension,
  getOptimizedImageFallback,
  getOptimizedImageFormatFallback,
  getOptimizedImageVariantWidths,
  getOptimizedPath,
  handleImageActivationBlur,
  handleImageActivationKeyDown,
  handleImageActivationKeyUp,
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

    it("normalizes source paths to the build pipeline's NFC form", () => {
      assertEquals(
        getOptimizedPath("/images/cafe\u0301.jpg", "webp", 640),
        "/.veryfront/optimized-images/images/caf%C3%A9-640w.webp",
      );
    });

    it("keeps source types without build-emitted variants on the original asset", () => {
      for (
        const src of [
          "/images/photo.gif",
          "/images/photo.svg",
          "/images/photo",
          "/images/.jpg",
          "/images/.png",
        ]
      ) {
        assertEquals(getOptimizedPath(src, "webp", 640), src);
        assertEquals(generateSrcSet(src, "webp", [320, 640], 80), "");
      }
      assertEquals(
        getOptimizedPath("/images/photo.JPG", "webp", 640),
        "/.veryfront/optimized-images/images/photo-640w.webp",
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
          "/images/photo\0.jpg",
          "/images/photo%00.jpg",
          "/images/\uD800.jpg",
        ]
      ) {
        assertEquals(getOptimizedPath(src, "webp", 640), src);
        assertEquals(generateSrcSet(src, "webp", [320, 640], 80), "");
      }
    });
  });

  describe("cssUrl", () => {
    it("quotes delimiters and escapes CSS string control characters", () => {
      assertEquals(
        cssUrl('https://cdn.example/photo (1) "hero"\\wide.jpg\n'),
        'url("https://cdn.example/photo (1) \\"hero\\"\\\\wide.jpg\\a ")',
      );
    });
  });

  describe("generateSrcSet", () => {
    it("generates srcset string with multiple sizes", () => {
      assertEquals(
        generateSrcSet("/photo.png", "webp", [320, 640], 80),
        "/.veryfront/optimized-images/photo-320w.webp 320w, " +
          "/.veryfront/optimized-images/photo-640w.webp 640w",
        "srcset candidates must be the build-emitted optimized paths, not the source",
      );
    });

    it("generates single-size srcset", () => {
      assertEquals(
        generateSrcSet("/photo.png", "webp", [640], 80),
        "/.veryfront/optimized-images/photo-640w.webp 640w",
        "a single-size srcset carries one optimized candidate and no comma",
      );
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
        // The once-latch is module-global, and nothing else in the suite reaches
        // development mode for this module, so the first development-mode call
        // owns the single warning.
        assertEquals(
          getOptimizedImageVariantWidths(
            Number.NaN,
            undefined,
            "https://cdn.example/photo.jpg",
          ),
          [],
        );
        assertEquals(
          warnings,
          [[INVALID_IMAGE_DIMENSIONS_WARNING]],
          "development mode warns once with the invalid-dimensions message",
        );
        assertEquals(getOptimizedImageVariantWidths(640, hostileWidths), []);
        assertEquals(
          warnings.length,
          1,
          "the development warning is emitted at most once per module instance",
        );
      } finally {
        console.warn = originalWarn;
        restore("window", originalWindow);
        restore("__VERYFRONT_DEV__", originalVeryfrontDev);
        restore("__RSC_DEV__", originalRscDev);
      }
    });
  });

  describe("getOptimizedImageFallback", () => {
    it("uses the original source when no optimized widths are available", () => {
      assertEquals(
        getOptimizedImageFallback("/images/photo.jpg", "webp", [], 80),
        "/images/photo.jpg",
      );
    });

    it("uses the single optimized width when one width is available", () => {
      assertEquals(
        getOptimizedImageFallback("/images/photo.jpg", "webp", [640], 80),
        "/.veryfront/optimized-images/images/photo-640w.webp",
      );
    });

    it("selects the smallest sorted width at or above the preferred width", () => {
      const widths = [320, 640, 1024];
      assertEquals(
        getOptimizedImageFallback("/images/photo.jpg", "webp", widths, 80, 200),
        "/.veryfront/optimized-images/images/photo-320w.webp",
      );
      assertEquals(
        getOptimizedImageFallback("/images/photo.jpg", "webp", widths, 80, 640),
        "/.veryfront/optimized-images/images/photo-640w.webp",
      );
    });

    it("falls back to the largest width when the preferred width exceeds every variant", () => {
      const widths = [320, 640, 1024];
      assertEquals(
        getOptimizedImageFallback("/images/photo.jpg", "webp", widths, 80, 1200),
        "/.veryfront/optimized-images/images/photo-1024w.webp",
      );
    });
  });

  describe("getOptimizedImageFormatFallback", () => {
    it("uses the original source when requested formats are unspecified", () => {
      assertEquals(
        getOptimizedImageFormatFallback("/images/photo.jpg", "webp", undefined, [640], 80),
        "/images/photo.jpg",
      );
    });

    it("uses the original source when the format was not requested", () => {
      assertEquals(
        getOptimizedImageFormatFallback("/images/photo.jpg", "avif", ["webp"], [640], 80),
        "/images/photo.jpg",
      );
    });

    it("uses an optimized fallback when the format was requested", () => {
      assertEquals(
        getOptimizedImageFormatFallback(
          "/images/photo.jpg",
          "webp",
          ["avif", "webp"],
          [320, 640],
          80,
        ),
        "/.veryfront/optimized-images/images/photo-640w.webp",
      );
    });
  });

  describe("keyboard activation", () => {
    interface ActivationProbe {
      image: HTMLImageElement;
      clicks: number;
      preventDefaults: number;
    }

    function withImage(run: (probe: ActivationProbe) => void): void {
      const dom = new JSDOM(
        '<!doctype html><html><body><img id="image" src="/images/photo.jpg" alt=""></body></html>',
      );
      const restoreDom = installComponentDom(dom);
      try {
        const image = document.getElementById("image") as unknown as HTMLImageElement;
        const probe: ActivationProbe = { image, clicks: 0, preventDefaults: 0 };
        image.addEventListener("click", () => {
          probe.clicks += 1;
        });
        run(probe);
      } finally {
        restoreDom();
        dom.window.close();
      }
    }

    interface KeyOptions {
      target?: EventTarget;
      isComposing?: boolean;
      keyCode?: number;
    }

    function keyEvent(
      probe: ActivationProbe,
      key: string,
      options: KeyOptions = {},
    ): React.KeyboardEvent<HTMLImageElement> {
      return {
        key,
        keyCode: options.keyCode ?? 0,
        target: options.target ?? probe.image,
        currentTarget: probe.image,
        nativeEvent: { isComposing: options.isComposing ?? false },
        preventDefault: () => {
          probe.preventDefaults += 1;
        },
      } as unknown as React.KeyboardEvent<HTMLImageElement>;
    }

    function blurEvent(probe: ActivationProbe): React.FocusEvent<HTMLImageElement> {
      return {
        target: probe.image,
        currentTarget: probe.image,
      } as unknown as React.FocusEvent<HTMLImageElement>;
    }

    it("activates on Enter keydown", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, "Enter"));
        assertEquals(probe.clicks, 1);
        assertEquals(probe.preventDefaults, 1);
      });
    });

    it("does not activate again when Enter keyup follows", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, "Enter"));
        handleImageActivationKeyUp(keyEvent(probe, "Enter"));
        assertEquals(probe.clicks, 1);
      });
    });

    it("blocks scrolling on Space keydown without activating", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        assertEquals(probe.clicks, 0);
        assertEquals(probe.preventDefaults, 1);
      });
    });

    it("activates once on Space keyup", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 1);
        assertEquals(probe.preventDefaults, 2);
      });
    });

    it("activates once when OS key repeat sends many Space keydowns", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyDown(keyEvent(probe, " "));
        assertEquals(probe.clicks, 0);
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 1);
      });
    });

    it("does not activate on a second Space keyup", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 1);
      });
    });

    it("ignores a Space keyup with no preceding keydown", () => {
      withImage((probe) => {
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 0);
        assertEquals(probe.preventDefaults, 0);
      });
    });

    it("cancels a pending Space when focus leaves between keydown and keyup", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationBlur(blurEvent(probe));
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 0);
      });
    });

    it("re-arms after a blur when Space is pressed again", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationBlur(blurEvent(probe));
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " "));
        assertEquals(probe.clicks, 1);
      });
    });

    it("keeps each image's pending Space independent", () => {
      withImage((first) => {
        withImage((second) => {
          handleImageActivationKeyDown(keyEvent(first, " "));
          handleImageActivationKeyUp(keyEvent(second, " "));
          assertEquals(second.clicks, 0);
          handleImageActivationKeyUp(keyEvent(first, " "));
          assertEquals(first.clicks, 1);
        });
      });
    });

    it("ignores a Space keyup that did not originate on the image", () => {
      withImage((probe) => {
        const other = probe.image.ownerDocument.createElement("span") as unknown as EventTarget;
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " ", { target: other }));
        assertEquals(probe.clicks, 0);
        assertEquals(probe.preventDefaults, 1);
      });
    });

    it("does not activate while an IME composition is in progress", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, "Enter", { isComposing: true }));
        handleImageActivationKeyDown(keyEvent(probe, "Enter", { keyCode: 229 }));
        handleImageActivationKeyDown(keyEvent(probe, " ", { isComposing: true }));
        handleImageActivationKeyUp(keyEvent(probe, " ", { isComposing: true }));
        assertEquals(probe.clicks, 0);
        assertEquals(probe.preventDefaults, 0);
      });
    });

    it("does not activate a Space keyup reported with the IME key code", () => {
      withImage((probe) => {
        handleImageActivationKeyDown(keyEvent(probe, " "));
        handleImageActivationKeyUp(keyEvent(probe, " ", { keyCode: 229 }));
        assertEquals(probe.clicks, 0);
      });
    });

    it("ignores keys other than Enter and Space", () => {
      withImage((probe) => {
        for (const key of ["a", "Tab", "Escape", "ArrowDown", "Spacebar"]) {
          handleImageActivationKeyDown(keyEvent(probe, key));
          handleImageActivationKeyUp(keyEvent(probe, key));
        }
        assertEquals(probe.clicks, 0);
        assertEquals(probe.preventDefaults, 0);
      });
    });
  });
});
