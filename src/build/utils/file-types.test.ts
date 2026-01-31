import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getEsbuildLoader,
  getFileCategory,
  getMimeType,
  getOptimizedImageFormat,
  isDocumentFile,
  isImageFile,
  isJSXFile,
  isMDXFile,
  isScriptFile,
  isStyleFile,
  isTypeScriptFile,
  needsTranspilation,
} from "./file-types.ts";

describe("build/utils/file-types", () => {
  describe("isImageFile", () => {
    it("should detect image extensions", () => {
      const cases: Array<[string, boolean]> = [
        ["photo.jpg", true],
        ["photo.jpeg", true],
        ["icon.png", true],
        ["hero.webp", true],
        ["logo.svg", true],
        ["anim.gif", true],
        ["pic.avif", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isImageFile(file), expected);
      }
    });

    it("should be case-insensitive", () => {
      const cases: Array<[string, boolean]> = [
        ["photo.JPG", true],
        ["icon.PNG", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isImageFile(file), expected);
      }
    });

    it("should reject non-image files", () => {
      const cases: Array<[string, boolean]> = [
        ["app.ts", false],
        ["style.css", false],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isImageFile(file), expected);
      }
    });
  });

  describe("isScriptFile", () => {
    it("should detect script extensions", () => {
      const cases: Array<[string, boolean]> = [
        ["app.js", true],
        ["comp.jsx", true],
        ["app.ts", true],
        ["comp.tsx", true],
        ["lib.mjs", true],
        ["lib.cjs", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isScriptFile(file), expected);
      }
    });

    it("should reject non-script files", () => {
      const cases: Array<[string, boolean]> = [
        ["style.css", false],
        ["photo.png", false],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isScriptFile(file), expected);
      }
    });
  });

  describe("isStyleFile", () => {
    it("should detect style extensions", () => {
      const cases: Array<[string, boolean]> = [
        ["style.css", true],
        ["theme.scss", true],
        ["base.sass", true],
        ["vars.less", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isStyleFile(file), expected);
      }
    });

    it("should reject non-style files", () => {
      assertEquals(isStyleFile("app.ts"), false);
    });
  });

  describe("isDocumentFile", () => {
    it("should detect document extensions", () => {
      const cases: Array<[string, boolean]> = [
        ["readme.md", true],
        ["page.mdx", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isDocumentFile(file), expected);
      }
    });

    it("should reject non-document files", () => {
      assertEquals(isDocumentFile("app.ts"), false);
    });
  });

  describe("getOptimizedImageFormat", () => {
    it("should normalize jpg to jpeg", () => {
      const cases: Array<[string, string]> = [
        ["jpg", "jpeg"],
        ["jpeg", "jpeg"],
      ];

      for (const [format, expected] of cases) {
        assertEquals(getOptimizedImageFormat(format), expected);
      }
    });

    it("should preserve known formats", () => {
      const cases: Array<[string, string]> = [
        ["png", "png"],
        ["webp", "webp"],
        ["avif", "avif"],
        ["svg", "svg"],
      ];

      for (const [format, expected] of cases) {
        assertEquals(getOptimizedImageFormat(format), expected);
      }
    });

    it("should handle dot prefix", () => {
      assertEquals(getOptimizedImageFormat(".png"), "png");
    });

    it("should be case-insensitive", () => {
      assertEquals(getOptimizedImageFormat("PNG"), "png");
    });

    it("should default to jpeg for unknown", () => {
      assertEquals(getOptimizedImageFormat("bmp"), "jpeg");
    });
  });

  describe("getEsbuildLoader", () => {
    it("should map script extensions", () => {
      const cases: Array<[string, string]> = [
        ["app.ts", "ts"],
        ["comp.tsx", "tsx"],
        ["app.js", "js"],
        ["comp.jsx", "jsx"],
        ["lib.mjs", "js"],
        ["lib.cjs", "js"],
      ];

      for (const [file, expected] of cases) {
        assertEquals(getEsbuildLoader(file), expected);
      }
    });

    it("should map style extensions to css", () => {
      const cases: Array<[string, string]> = [
        ["style.css", "css"],
        ["theme.scss", "css"],
      ];

      for (const [file, expected] of cases) {
        assertEquals(getEsbuildLoader(file), expected);
      }
    });

    it("should map mdx to tsx", () => {
      assertEquals(getEsbuildLoader("page.mdx"), "tsx");
    });

    it("should map json", () => {
      assertEquals(getEsbuildLoader("data.json"), "json");
    });

    it("should default to text for unknown", () => {
      assertEquals(getEsbuildLoader("file.xyz"), "text");
    });
  });

  describe("getFileCategory", () => {
    it("should categorize images", () => {
      assertEquals(getFileCategory("photo.png"), "image");
    });

    it("should categorize scripts", () => {
      assertEquals(getFileCategory("app.ts"), "script");
    });

    it("should categorize styles", () => {
      assertEquals(getFileCategory("style.css"), "style");
    });

    it("should categorize documents", () => {
      assertEquals(getFileCategory("page.mdx"), "document");
    });

    it("should return other for unknown", () => {
      assertEquals(getFileCategory("data.bin"), "other");
    });
  });

  describe("needsTranspilation", () => {
    it("should require transpilation for TS/TSX/JSX/MDX", () => {
      const cases: Array<[string, boolean]> = [
        ["app.ts", true],
        ["comp.tsx", true],
        ["comp.jsx", true],
        ["page.mdx", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(needsTranspilation(file), expected);
      }
    });

    it("should not require for JS/CSS", () => {
      const cases: Array<[string, boolean]> = [
        ["app.js", false],
        ["style.css", false],
      ];

      for (const [file, expected] of cases) {
        assertEquals(needsTranspilation(file), expected);
      }
    });
  });

  describe("isTypeScriptFile", () => {
    it("should detect .ts and .tsx", () => {
      const cases: Array<[string, boolean]> = [
        ["app.ts", true],
        ["comp.tsx", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isTypeScriptFile(file), expected);
      }
    });

    it("should reject non-TS files", () => {
      assertEquals(isTypeScriptFile("app.js"), false);
    });
  });

  describe("isJSXFile", () => {
    it("should detect .jsx and .tsx", () => {
      const cases: Array<[string, boolean]> = [
        ["comp.jsx", true],
        ["comp.tsx", true],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isJSXFile(file), expected);
      }
    });

    it("should reject non-JSX", () => {
      const cases: Array<[string, boolean]> = [
        ["app.ts", false],
        ["app.js", false],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isJSXFile(file), expected);
      }
    });
  });

  describe("isMDXFile", () => {
    it("should detect .mdx", () => {
      assertEquals(isMDXFile("page.mdx"), true);
    });

    it("should reject .md and others", () => {
      const cases: Array<[string, boolean]> = [
        ["readme.md", false],
        ["app.ts", false],
      ];

      for (const [file, expected] of cases) {
        assertEquals(isMDXFile(file), expected);
      }
    });
  });

  describe("getMimeType", () => {
    it("should return correct MIME for images", () => {
      const cases: Array<[string, string]> = [
        ["photo.jpg", "image/jpeg"],
        ["icon.png", "image/png"],
        ["logo.svg", "image/svg+xml"],
      ];

      for (const [file, expected] of cases) {
        assertEquals(getMimeType(file), expected);
      }
    });

    it("should return correct MIME for scripts", () => {
      const cases: Array<[string, string]> = [
        ["app.js", "application/javascript"],
        ["app.ts", "application/typescript"],
        ["data.json", "application/json"],
      ];

      for (const [file, expected] of cases) {
        assertEquals(getMimeType(file), expected);
      }
    });

    it("should return correct MIME for styles", () => {
      assertEquals(getMimeType("style.css"), "text/css");
    });

    it("should return correct MIME for documents", () => {
      const cases: Array<[string, string]> = [
        ["readme.md", "text/markdown"],
        ["page.mdx", "text/mdx"],
      ];

      for (const [file, expected] of cases) {
        assertEquals(getMimeType(file), expected);
      }
    });

    it("should default to octet-stream for unknown", () => {
      assertEquals(getMimeType("data.bin"), "application/octet-stream");
    });
  });
});
