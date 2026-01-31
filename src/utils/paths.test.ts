import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FILE_EXTENSIONS, PATHS } from "./paths.ts";

describe("paths", () => {
  describe("PATHS", () => {
    it("should define standard directory names", () => {
      assertEquals(PATHS.PAGES_DIR, "pages");
      assertEquals(PATHS.COMPONENTS_DIR, "components");
      assertEquals(PATHS.PUBLIC_DIR, "public");
      assertEquals(PATHS.STYLES_DIR, "styles");
      assertEquals(PATHS.DIST_DIR, "dist");
    });

    it("should define config file name", () => {
      assertEquals(PATHS.CONFIG_FILE, "veryfront.config.js");
    });
  });

  describe("FILE_EXTENSIONS", () => {
    it("should have MDX extensions", () => {
      assertEquals(FILE_EXTENSIONS.MDX, [".mdx", ".md"]);
    });

    it("should have script extensions", () => {
      assertEquals(FILE_EXTENSIONS.SCRIPT, [".tsx", ".ts", ".jsx", ".js"]);
    });

    it("should have style extensions", () => {
      assertEquals(FILE_EXTENSIONS.STYLE, [".css", ".scss", ".sass"]);
    });

    it("should have ALL extensions as union of MDX and SCRIPT and CSS", () => {
      const all = FILE_EXTENSIONS.ALL;

      for (const ext of FILE_EXTENSIONS.MDX) {
        assert(all.includes(ext), `ALL should include ${ext}`);
      }

      for (const ext of FILE_EXTENSIONS.SCRIPT) {
        assert(all.includes(ext), `ALL should include ${ext}`);
      }

      assert(all.includes(".css"), "ALL should include .css");
    });
  });
});
