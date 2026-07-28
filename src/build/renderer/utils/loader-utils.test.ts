import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getFileType, getLoaderFromPath, getSlugFromPath } from "./loader-utils.ts";

function runCases(
  cases: Array<[string, string]>,
  getActual: (path: string) => string,
  title: (path: string, expected: string) => string,
): void {
  for (const [path, expected] of cases) {
    it(title(path, expected), () => {
      assertEquals(getActual(path), expected);
    });
  }
}

describe("Loader Utils", () => {
  describe("getLoaderFromPath", () => {
    runCases(
      [
        ["/src/components/Button.ts", "ts"],
        ["/src/components/Button.tsx", "tsx"],
        ["/src/utils/helpers.js", "js"],
        ["/src/utils/helpers.mjs", "js"],
        ["/src/utils/helpers.cjs", "js"],
        ["/src/utils/helpers.mts", "ts"],
        ["/src/utils/helpers.cts", "ts"],
        ["/src/components/Button.jsx", "jsx"],
        ["/config/settings.json", "json"],
        ["/styles/main.css", "css"],
        ["/content/article.mdx", "tsx"],
        ["/data/file.txt", "default"],
        ["/src/Component.TSX", "tsx"],
        ["/src/Component.Jsx", "jsx"],
        ["/src/components/Button.spec.ts", "ts"],
        ["/src/components/Button", "default"],
      ],
      getLoaderFromPath,
      (path, expected) => `returns ${expected} loader for ${path}`,
    );
  });

  describe("getFileType", () => {
    runCases(
      [
        ["/content/article.mdx", "mdx"],
        ["/src/components/Button.tsx", "tsx"],
        ["/src/utils/helpers.ts", "ts"],
        ["/src/components/Button.jsx", "jsx"],
        ["/src/utils/helpers.js", "js"],
        ["/src/utils/helpers.mjs", "js"],
        ["/src/utils/helpers.cjs", "js"],
        ["/src/utils/helpers.mts", "ts"],
        ["/src/utils/helpers.cts", "ts"],
        ["/styles/main.css", "css"],
        ["/config/settings.json", "json"],
        ["/data/file.txt", "unknown"],
        ["/src/Component.MDX", "mdx"],
        ["/src/components/Button.test.tsx", "tsx"],
      ],
      getFileType,
      (path, expected) => `returns ${expected} for ${path}`,
    );
  });

  describe("getSlugFromPath", () => {
    runCases(
      [
        ["./pages/about.tsx", "pages/about"],
        ["./pages/contact.ts", "pages/contact"],
        ["./pages/index.tsx", "pages"],
        ["./pages/blog/index.tsx", "pages/blog"],
        ["./pages/AboutUs.tsx", "pages/aboutus"],
        ["./pages/my page!.tsx", "pages/my-page"],
        ["./pages/hello@world#test.tsx", "pages/hello-world-test"],
        ["./pages/about-us.tsx", "pages/about-us"],
        ["./pages/blog/posts/first.tsx", "pages/blog/posts/first"],
        ["pages/about.tsx", "pages/about"],
        ["./content/article.mdx", "content/article"],
        ["./components/Button.jsx", "components/button"],
        ["./utils/helpers.js", "utils/helpers"],
        ["./pages/Blog Post #1!/index.tsx", "pages/blog-post-1"],
        ["./pages//about.tsx", "pages/about"],
        ["./index.tsx", "index"],
        [".\\pages\\Windows Route.tsx", "pages/windows-route"],
        ["./pages/Crème brûlée.mdx", "pages/crème-brûlée"],
      ],
      getSlugFromPath,
      (path, expected) => `returns "${expected}" for ${path}`,
    );

    it("rejects absolute, traversing, and empty route sources", () => {
      for (const path of ["/pages/about.tsx", "../about.tsx", "./pages/!!!.tsx", ""]) {
        let didThrow = false;
        try {
          getSlugFromPath(path);
        } catch (error) {
          didThrow = error instanceof TypeError;
        }
        assertEquals(didThrow, true);
      }
    });
  });
});
