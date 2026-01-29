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
      assertEquals(isImageFile("photo.jpg"), true);
      assertEquals(isImageFile("photo.jpeg"), true);
      assertEquals(isImageFile("icon.png"), true);
      assertEquals(isImageFile("hero.webp"), true);
      assertEquals(isImageFile("logo.svg"), true);
      assertEquals(isImageFile("anim.gif"), true);
      assertEquals(isImageFile("pic.avif"), true);
    });

    it("should be case-insensitive", () => {
      assertEquals(isImageFile("photo.JPG"), true);
      assertEquals(isImageFile("icon.PNG"), true);
    });

    it("should reject non-image files", () => {
      assertEquals(isImageFile("app.ts"), false);
      assertEquals(isImageFile("style.css"), false);
    });
  });

  describe("isScriptFile", () => {
    it("should detect script extensions", () => {
      assertEquals(isScriptFile("app.js"), true);
      assertEquals(isScriptFile("comp.jsx"), true);
      assertEquals(isScriptFile("app.ts"), true);
      assertEquals(isScriptFile("comp.tsx"), true);
      assertEquals(isScriptFile("lib.mjs"), true);
      assertEquals(isScriptFile("lib.cjs"), true);
    });

    it("should reject non-script files", () => {
      assertEquals(isScriptFile("style.css"), false);
      assertEquals(isScriptFile("photo.png"), false);
    });
  });

  describe("isStyleFile", () => {
    it("should detect style extensions", () => {
      assertEquals(isStyleFile("style.css"), true);
      assertEquals(isStyleFile("theme.scss"), true);
      assertEquals(isStyleFile("base.sass"), true);
      assertEquals(isStyleFile("vars.less"), true);
    });

    it("should reject non-style files", () => {
      assertEquals(isStyleFile("app.ts"), false);
    });
  });

  describe("isDocumentFile", () => {
    it("should detect document extensions", () => {
      assertEquals(isDocumentFile("readme.md"), true);
      assertEquals(isDocumentFile("page.mdx"), true);
    });

    it("should reject non-document files", () => {
      assertEquals(isDocumentFile("app.ts"), false);
    });
  });

  describe("getOptimizedImageFormat", () => {
    it("should normalize jpg to jpeg", () => {
      assertEquals(getOptimizedImageFormat("jpg"), "jpeg");
      assertEquals(getOptimizedImageFormat("jpeg"), "jpeg");
    });

    it("should preserve known formats", () => {
      assertEquals(getOptimizedImageFormat("png"), "png");
      assertEquals(getOptimizedImageFormat("webp"), "webp");
      assertEquals(getOptimizedImageFormat("avif"), "avif");
      assertEquals(getOptimizedImageFormat("svg"), "svg");
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
      assertEquals(getEsbuildLoader("app.ts"), "ts");
      assertEquals(getEsbuildLoader("comp.tsx"), "tsx");
      assertEquals(getEsbuildLoader("app.js"), "js");
      assertEquals(getEsbuildLoader("comp.jsx"), "jsx");
      assertEquals(getEsbuildLoader("lib.mjs"), "js");
      assertEquals(getEsbuildLoader("lib.cjs"), "js");
    });

    it("should map style extensions to css", () => {
      assertEquals(getEsbuildLoader("style.css"), "css");
      assertEquals(getEsbuildLoader("theme.scss"), "css");
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
      assertEquals(needsTranspilation("app.ts"), true);
      assertEquals(needsTranspilation("comp.tsx"), true);
      assertEquals(needsTranspilation("comp.jsx"), true);
      assertEquals(needsTranspilation("page.mdx"), true);
    });

    it("should not require for JS/CSS", () => {
      assertEquals(needsTranspilation("app.js"), false);
      assertEquals(needsTranspilation("style.css"), false);
    });
  });

  describe("isTypeScriptFile", () => {
    it("should detect .ts and .tsx", () => {
      assertEquals(isTypeScriptFile("app.ts"), true);
      assertEquals(isTypeScriptFile("comp.tsx"), true);
    });

    it("should reject non-TS files", () => {
      assertEquals(isTypeScriptFile("app.js"), false);
    });
  });

  describe("isJSXFile", () => {
    it("should detect .jsx and .tsx", () => {
      assertEquals(isJSXFile("comp.jsx"), true);
      assertEquals(isJSXFile("comp.tsx"), true);
    });

    it("should reject non-JSX", () => {
      assertEquals(isJSXFile("app.ts"), false);
      assertEquals(isJSXFile("app.js"), false);
    });
  });

  describe("isMDXFile", () => {
    it("should detect .mdx", () => {
      assertEquals(isMDXFile("page.mdx"), true);
    });

    it("should reject .md and others", () => {
      assertEquals(isMDXFile("readme.md"), false);
      assertEquals(isMDXFile("app.ts"), false);
    });
  });

  describe("getMimeType", () => {
    it("should return correct MIME for images", () => {
      assertEquals(getMimeType("photo.jpg"), "image/jpeg");
      assertEquals(getMimeType("icon.png"), "image/png");
      assertEquals(getMimeType("logo.svg"), "image/svg+xml");
    });

    it("should return correct MIME for scripts", () => {
      assertEquals(getMimeType("app.js"), "application/javascript");
      assertEquals(getMimeType("app.ts"), "application/typescript");
      assertEquals(getMimeType("data.json"), "application/json");
    });

    it("should return correct MIME for styles", () => {
      assertEquals(getMimeType("style.css"), "text/css");
    });

    it("should return correct MIME for documents", () => {
      assertEquals(getMimeType("readme.md"), "text/markdown");
      assertEquals(getMimeType("page.mdx"), "text/mdx");
    });

    it("should default to octet-stream for unknown", () => {
      assertEquals(getMimeType("data.bin"), "application/octet-stream");
    });
  });
});
