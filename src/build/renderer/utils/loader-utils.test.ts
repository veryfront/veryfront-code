import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getFileType, getLoaderFromPath, getSlugFromPath } from "./loader-utils.ts";

describe("Loader Utils", () => {
  describe("getLoaderFromPath", () => {
    const cases: Array<[string, string]> = [
      ["/src/components/Button.ts", "ts"],
      ["/src/components/Button.tsx", "tsx"],
      ["/src/utils/helpers.js", "js"],
      ["/src/utils/helpers.mjs", "js"],
      ["/src/components/Button.jsx", "jsx"],
      ["/config/settings.json", "json"],
      ["/styles/main.css", "css"],
      ["/content/article.mdx", "tsx"],
      ["/data/file.txt", "default"],
      ["/src/Component.TSX", "tsx"],
      ["/src/Component.Jsx", "jsx"],
      ["/src/components/Button.spec.ts", "ts"],
      ["/src/components/Button", "default"],
    ];

    for (const [path, expected] of cases) {
      it(`returns ${expected} loader for ${path}`, () => {
        assertEquals(getLoaderFromPath(path), expected);
      });
    }
  });

  describe("getFileType", () => {
    const cases: Array<[string, string]> = [
      ["/content/article.mdx", "mdx"],
      ["/src/components/Button.tsx", "tsx"],
      ["/src/utils/helpers.ts", "ts"],
      ["/src/components/Button.jsx", "jsx"],
      ["/src/utils/helpers.js", "js"],
      ["/src/utils/helpers.mjs", "js"],
      ["/styles/main.css", "css"],
      ["/config/settings.json", "json"],
      ["/data/file.txt", "js"],
      ["/src/Component.MDX", "mdx"],
      ["/src/components/Button.test.tsx", "tsx"],
    ];

    for (const [path, expected] of cases) {
      it(`returns ${expected} for ${path}`, () => {
        assertEquals(getFileType(path), expected);
      });
    }
  });

  describe("getSlugFromPath", () => {
    const cases: Array<[string, string]> = [
      ["./pages/about.tsx", "pages/about"],
      ["./pages/contact.ts", "pages/contact"],
      ["./pages/index.tsx", "pages"],
      ["./pages/blog/index.tsx", "pages/blog"],
      ["./pages/AboutUs.tsx", "pages/aboutus"],
      ["./pages/my page!.tsx", "pages/my-page-"],
      ["./pages/hello@world#test.tsx", "pages/hello-world-test"],
      ["./pages/about-us.tsx", "pages/about-us"],
      ["./pages/blog/posts/first.tsx", "pages/blog/posts/first"],
      ["pages/about.tsx", "pages/about"],
      ["./content/article.mdx", "content/article"],
      ["./components/Button.jsx", "components/button"],
      ["./utils/helpers.js", "utils/helpers"],
      ["./pages/Blog Post #1!/index.tsx", "pages/blog-post--1-"],
      ["./pages//about.tsx", "pages//about"],
      ["./index.tsx", "index"],
    ];

    for (const [path, expected] of cases) {
      it(`returns "${expected}" for ${path}`, () => {
        assertEquals(getSlugFromPath(path), expected);
      });
    }
  });
});
