import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  generateBlurDataURL,
  getAspectRatioPadding,
  OptimizedBackgroundImage,
  OptimizedImage,
  type OptimizedImageProps,
  ResponsiveImageContainer,
  SimpleOptimizedImage,
  useOptimizedImage,
} from "#veryfront/components";

const INVALID_IMAGE_DIMENSIONS_WARNING =
  "[Veryfront] Optimized image width and targetWidths must contain positive integers " +
  "within the build image limit. Rendering the original asset instead.";

function assertPublicImageApisUseOriginalAsset(
  width: number,
  targetWidths?: readonly number[],
  src = "/images/invalid.jpg",
): void {
  const picture = renderToStaticMarkup(
    React.createElement(OptimizedImage, {
      src,
      alt: "Invalid dimensions",
      width,
      targetWidths,
    }),
  );
  const simple = renderToStaticMarkup(
    React.createElement(SimpleOptimizedImage, {
      src,
      alt: "Invalid dimensions",
      width,
      targetWidths,
    }),
  );
  const background = renderToStaticMarkup(
    React.createElement(OptimizedBackgroundImage, {
      src,
      width,
      targetWidths,
    }),
  );
  const hooked = useOptimizedImage(src, { width, targetWidths });

  for (const markup of [picture, simple, background]) {
    assertStringIncludes(markup, src);
    assertEquals(markup.includes("/.veryfront/optimized-images/"), false);
  }
  assertEquals(hooked.sources, []);
  assertEquals(hooked.fallback, src);
}

describe("OptimizedImage", () => {
  describe("basic props", () => {
    it("should create element with correct props", () => {
      const props = {
        src: "/images/hero.jpg",
        alt: "Hero image",
        width: 1920,
        height: 1080,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.type, OptimizedImage);
      assertEquals(element.props.src, "/images/hero.jpg");
      assertEquals(element.props.alt, "Hero image");
      assertEquals(element.props.width, 1920);
      assertEquals(element.props.height, 1080);
    });
  });

  describe("custom formats", () => {
    it("should accept custom formats and quality", () => {
      const props: OptimizedImageProps = {
        src: "/images/photo.jpg",
        alt: "Photo",
        formats: ["avif", "webp", "jpeg"],
        quality: 85,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.formats, ["avif", "webp", "jpeg"]);
      assertEquals(element.props.quality, 85);
    });
  });

  describe("loading behavior", () => {
    it("should support priority loading", () => {
      const props = {
        src: "/images/hero.jpg",
        alt: "Hero",
        priority: true,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.priority, true);
    });

    it("should support lazy loading", () => {
      const props = {
        src: "/images/below-fold.jpg",
        alt: "Below fold",
        loading: "lazy" as const,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.loading, "lazy");
    });
  });

  describe("blur placeholder", () => {
    it("should accept blur placeholder with data URL", () => {
      const blurDataURL = generateBlurDataURL(10, 10, "#cccccc");

      const props = {
        src: "/images/photo.jpg",
        alt: "Photo",
        placeholder: "blur" as const,
        blurDataURL,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.placeholder, "blur");
      assertEquals(typeof element.props.blurDataURL, "string");
    });
  });

  describe("event handlers", () => {
    it("should accept event handler props", () => {
      const onLoad = () => {};
      const onError = () => {};
      const onClick = () => {};

      const props = {
        src: "/images/test.jpg",
        alt: "Test",
        onLoad,
        onError,
        onClick,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.onLoad, onLoad);
      assertEquals(element.props.onError, onError);
      assertEquals(element.props.onClick, onClick);
    });
  });

  describe("responsive sizes", () => {
    it("should accept custom sizes attribute", () => {
      const props = {
        src: "/images/test.jpg",
        alt: "Test",
        sizes: "(max-width: 768px) 100vw, 50vw",
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.sizes, "(max-width: 768px) 100vw, 50vw");
    });

    it("only references variants emitted for a narrow jpg source", () => {
      const picture = renderToStaticMarkup(
        React.createElement(OptimizedImage, {
          src: "/images/narrow.jpg",
          alt: "Narrow",
          width: 320,
          height: 180,
          formats: ["webp", "jpeg"],
        }),
      );
      const simple = renderToStaticMarkup(
        React.createElement(SimpleOptimizedImage, {
          src: "/images/narrow.jpg",
          alt: "Narrow",
          width: 320,
          height: 180,
          format: "webp",
        }),
      );
      const hooked = useOptimizedImage("/images/narrow.jpg", {
        formats: ["webp", "jpeg"],
        width: 320,
      });

      assertStringIncludes(picture, "/images/narrow-320w.webp 320w");
      assertStringIncludes(picture, "/images/narrow-320w.jpeg");
      assertEquals(picture.includes("-640w."), false);
      assertStringIncludes(simple, "/images/narrow-320w.webp 320w");
      assertEquals(simple.includes("-640w."), false);
      assertEquals(hooked.sources.map(({ srcSet }) => srcSet), [
        "/.veryfront/optimized-images/images/narrow-320w.webp 320w",
        "/.veryfront/optimized-images/images/narrow-320w.jpeg 320w",
      ]);
      assertEquals(
        hooked.fallback,
        "/.veryfront/optimized-images/images/narrow-320w.jpeg",
      );
    });

    it("uses explicit custom build target widths across each runtime API", () => {
      const targetWidths = [320];
      const picture = renderToStaticMarkup(
        React.createElement(OptimizedImage, {
          src: "/images/custom.jpg",
          alt: "Custom",
          width: 1_000,
          height: 500,
          formats: ["webp"],
          targetWidths,
        }),
      );
      const simple = renderToStaticMarkup(
        React.createElement(SimpleOptimizedImage, {
          src: "/images/custom.jpg",
          alt: "Custom",
          width: 1_000,
          height: 500,
          format: "webp",
          targetWidths,
        }),
      );
      const hooked = useOptimizedImage("/images/custom.jpg", {
        formats: ["webp"],
        width: 1_000,
        targetWidths,
      });

      for (const output of [picture, simple, hooked.sources[0]?.srcSet ?? ""]) {
        assertStringIncludes(output, "/images/custom-320w.webp 320w");
        assertStringIncludes(output, "/images/custom-1000w.webp 1000w");
        assertEquals(output.includes("-640w."), false);
      }
    });

    it("keeps a default-build png fallback on the original asset", () => {
      const picture = renderToStaticMarkup(
        React.createElement(OptimizedImage, {
          src: "/images/photo.png",
          alt: "PNG",
          width: 320,
          height: 180,
        }),
      );
      const hooked = useOptimizedImage("/images/photo.png", { width: 320 });

      assertStringIncludes(picture, '<img src="/images/photo.png"');
      assertEquals(picture.includes("photo-320w.png"), false);
      assertEquals(hooked.fallback, "/images/photo.png");
    });

    it("uses only the explicitly emitted custom format matrix", () => {
      const webpOnly = renderToStaticMarkup(
        React.createElement(OptimizedImage, {
          src: "/images/photo.jpg",
          alt: "WebP only",
          width: 320,
          formats: ["webp"],
        }),
      );
      const pngEmitted = useOptimizedImage("/images/photo.png", {
        width: 320,
        formats: ["png"],
      });

      assertStringIncludes(webpOnly, "/images/photo-320w.webp 320w");
      assertStringIncludes(webpOnly, '<img src="/images/photo.jpg"');
      assertEquals(webpOnly.includes("photo-320w.jpeg"), false);
      assertEquals(
        pngEmitted.fallback,
        "/.veryfront/optimized-images/images/photo-320w.png",
      );
    });

    it("keeps valid minimum and maximum image dimensions optimized", () => {
      const maximumWidth = IMAGE_OPTIMIZATION.MAX_DIMENSION;
      const minimum = useOptimizedImage("/images/minimum.jpg", {
        formats: ["webp"],
        width: 1,
        targetWidths: [1],
      });
      const maximum = renderToStaticMarkup(
        React.createElement(OptimizedBackgroundImage, {
          src: "/images/maximum.jpg",
          width: maximumWidth,
          size: maximumWidth,
          targetWidths: [1, maximumWidth],
        }),
      );

      assertEquals(minimum.sources.map(({ srcSet }) => srcSet), [
        "/.veryfront/optimized-images/images/minimum-1w.webp 1w",
      ]);
      assertStringIncludes(maximum, `/images/maximum-${maximumWidth}w.webp`);
    });

    it("contains invalid runtime dimensions and warns once only in development", () => {
      const maximumWidth = IMAGE_OPTIMIZATION.MAX_DIMENSION;
      const invalidWidths = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        320.5,
        0,
        -1,
        maximumWidth + 1,
      ];
      const invalidTargetWidths = invalidWidths.map((targetWidth) => [targetWidth] as const);
      const previousEnvironment = Deno.env.get("VERYFRONT_ENV");
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];

      console.warn = (...args: unknown[]) => warnings.push(args);
      try {
        Deno.env.set("VERYFRONT_ENV", "production");
        for (const width of invalidWidths) {
          assertPublicImageApisUseOriginalAsset(width);
        }
        for (const targetWidths of invalidTargetWidths) {
          assertPublicImageApisUseOriginalAsset(640, targetWidths);
        }
        assertEquals(warnings, []);

        Deno.env.set("VERYFRONT_ENV", "development");
        const developmentWarningCount = warnings.length;
        assertPublicImageApisUseOriginalAsset(
          Number.NaN,
          undefined,
          "https://cdn.example/invalid.jpg",
        );
        assertEquals(warnings.length <= developmentWarningCount + 1, true);
        if (warnings.length > developmentWarningCount) {
          assertEquals(warnings[developmentWarningCount], [INVALID_IMAGE_DIMENSIONS_WARNING]);
        }
        assertPublicImageApisUseOriginalAsset(640, [Number.NaN]);
        assertEquals(warnings.length <= developmentWarningCount + 1, true);
      } finally {
        console.warn = originalWarn;
        if (previousEnvironment === undefined) Deno.env.delete("VERYFRONT_ENV");
        else Deno.env.set("VERYFRONT_ENV", previousEnvironment);
      }
    });

    it("omits invalid DOM dimensions while preserving optimization validation", () => {
      const picture = renderToStaticMarkup(
        React.createElement(OptimizedImage, {
          src: "/images/invalid.jpg",
          alt: "Invalid dimensions",
          width: Number.NaN,
          height: Number.POSITIVE_INFINITY,
        }),
      );
      const simple = renderToStaticMarkup(
        React.createElement(SimpleOptimizedImage, {
          src: "/images/invalid.jpg",
          alt: "Invalid dimensions",
          width: Number.NEGATIVE_INFINITY,
          height: 320.5,
        }),
      );

      for (const markup of [picture, simple]) {
        assertStringIncludes(markup, 'src="/images/invalid.jpg"');
        assertEquals(markup.includes("width="), false);
        assertEquals(markup.includes("height="), false);
        assertEquals(markup.includes("/.veryfront/optimized-images/"), false);
      }
    });

    it("uses the original asset for non-app and boundary-changing paths", () => {
      for (const src of ["https://cdn.example/photo.jpg", "/images/%2e%2e/private.jpg"]) {
        const picture = renderToStaticMarkup(
          React.createElement(OptimizedImage, {
            src,
            alt: "Original",
            width: 640,
          }),
        );
        const hooked = useOptimizedImage(src, { width: 640 });

        assertStringIncludes(picture, `src="${src.replaceAll("&", "&amp;")}"`);
        assertEquals(picture.includes("/.veryfront/optimized-images"), false);
        assertEquals(hooked, { sources: [], fallback: src });
      }
    });

    it("uses the original asset for source types the build does not optimize", () => {
      for (
        const src of [
          "/images/photo.gif",
          "/images/photo.svg",
          "/images/photo",
          "/images/.jpg",
          "/images/.png",
        ]
      ) {
        assertPublicImageApisUseOriginalAsset(640, undefined, src);
      }
    });
  });

  describe("styling", () => {
    it("should accept className and style props", () => {
      const style = { border: "1px solid red" };

      const props = {
        src: "/images/test.jpg",
        alt: "Test",
        className: "custom-image",
        style,
      };

      const element = React.createElement(OptimizedImage, props);

      assertExists(element);
      assertEquals(element.props.className, "custom-image");
      assertEquals(element.props.style, style);
    });
  });
});

describe("SimpleOptimizedImage", () => {
  it("should create element with correct props", () => {
    const props = {
      src: "/images/simple.jpg",
      alt: "Simple image",
      format: "webp" as const,
      quality: 80,
    };

    const element = React.createElement(SimpleOptimizedImage, props);

    assertExists(element);
    assertEquals(element.props.src, "/images/simple.jpg");
    assertEquals(element.props.alt, "Simple image");
    assertEquals(element.props.format, "webp");
    assertEquals(element.props.quality, 80);
  });

  it("forwards a sizes attribute when srcset variants are available", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SimpleOptimizedImage, {
        src: "/images/simple.jpg",
        alt: "Simple image",
        width: 320,
        sizes: "(max-width: 768px) 100vw, 320px",
      }),
    );

    assertStringIncludes(markup, 'sizes="(max-width: 768px) 100vw, 320px"');
    assertStringIncludes(markup, "/images/simple-320w.webp 320w");
  });
});

describe("OptimizedBackgroundImage", () => {
  it("should create element with correct props", () => {
    const props = {
      src: "/images/background.jpg",
      format: "webp" as const,
      quality: 80,
      children: React.createElement("h1", {}, "Title"),
    };

    const element = React.createElement(OptimizedBackgroundImage, props);

    assertExists(element);
    assertEquals(element.props.src, "/images/background.jpg");
    assertEquals(element.props.format, "webp");
  });

  it("uses the original asset when intrinsic width is unknown", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OptimizedBackgroundImage, {
        src: "/images/background.jpg",
      }),
    );

    assertStringIncludes(markup, "background-image:url(&quot;/images/background.jpg&quot;)");
    assertEquals(markup.includes("-1920w."), false);
  });

  it("quotes original background URLs that contain CSS delimiters", () => {
    const src = "https://cdn.example/photo (1).jpg";
    const markup = renderToStaticMarkup(
      React.createElement(OptimizedBackgroundImage, { src }),
    );

    assertStringIncludes(markup, `background-image:url(&quot;${src}&quot;)`);
  });

  it("selects an emitted background width for narrow and custom target plans", () => {
    const narrow = renderToStaticMarkup(
      React.createElement(OptimizedBackgroundImage, {
        src: "/images/narrow.jpg",
        width: 320,
      }),
    );
    const custom = renderToStaticMarkup(
      React.createElement(OptimizedBackgroundImage, {
        src: "/images/custom.jpg",
        width: 1_000,
        size: 640,
        targetWidths: [320],
      }),
    );

    assertStringIncludes(narrow, "/images/narrow-320w.webp");
    assertEquals(narrow.includes("-1920w."), false);
    assertStringIncludes(custom, "/images/custom-1000w.webp");
    assertEquals(custom.includes("-640w."), false);
  });
});

describe("useOptimizedImage", () => {
  it("should return sources and fallback", () => {
    const { sources, fallback } = useOptimizedImage("/images/test.jpg");

    assertEquals(sources, []);
    assertEquals(fallback, "/images/test.jpg");
  });

  it("should accept custom options", () => {
    const { sources } = useOptimizedImage("/images/test.jpg", {
      formats: ["webp", "jpeg"],
      quality: 90,
      width: 1920,
    });

    assertExists(sources);
    assertEquals(sources.length, 2);
    assertEquals(sources[0]?.format, "webp");
    assertEquals(sources[1]?.format, "jpeg");
  });
});

describe("generateBlurDataURL", () => {
  it("should generate data URL with default parameters", () => {
    const dataURL = generateBlurDataURL();

    assertExists(dataURL);
    assertEquals(dataURL.startsWith("data:image/svg+xml;base64,"), true);
  });

  it("should generate data URL with custom dimensions", () => {
    const dataURL = generateBlurDataURL(20, 15, "#ff0000");

    assertExists(dataURL);
    assertEquals(dataURL.startsWith("data:image/svg+xml;base64,"), true);
  });
});

describe("getAspectRatioPadding", () => {
  it("should calculate padding for 16:9 aspect ratio", () => {
    const padding = getAspectRatioPadding(1920, 1080);

    assertEquals(padding, "56.25%");
  });

  it("should calculate padding for 4:3 aspect ratio", () => {
    const padding = getAspectRatioPadding(800, 600);

    assertEquals(padding, "75%");
  });

  it("should calculate padding for 1:1 aspect ratio", () => {
    const padding = getAspectRatioPadding(500, 500);

    assertEquals(padding, "100%");
  });
});

describe("ResponsiveImageContainer", () => {
  it("should create element with width and height props", () => {
    const props = {
      width: 16,
      height: 9,
      children: React.createElement("img", { src: "/test.jpg", alt: "Test" }),
    };

    const element = React.createElement(ResponsiveImageContainer, props);

    assertExists(element);
    assertEquals(element.props.width, 16);
    assertEquals(element.props.height, 9);
  });

  it("should accept className prop", () => {
    const props = {
      width: 16,
      height: 9,
      className: "image-wrapper",
      children: React.createElement("div", {}, "Content"),
    };

    const element = React.createElement(ResponsiveImageContainer, props);

    assertExists(element);
    assertEquals(element.props.className, "image-wrapper");
  });
});
