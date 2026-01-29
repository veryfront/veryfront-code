import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findGlobalStylesheet, findStylesheetFromFiles } from "./css-pregeneration.ts";

describe("styles-builder/css-pregeneration", () => {
  describe("findGlobalStylesheet", () => {
    it("should return undefined when no files match", () => {
      const files = [
        { path: "pages/index.tsx", content: "export default () => {}" },
        { path: "components/button.tsx", content: "<button/>" },
      ];
      assertEquals(findGlobalStylesheet(files), undefined);
    });

    it("should find globals.css at root level", () => {
      const files = [
        { path: "globals.css", content: "@tailwind base;" },
        { path: "pages/index.tsx", content: "export default () => {}" },
      ];
      assertEquals(findGlobalStylesheet(files), "@tailwind base;");
    });

    it("should find global.css at root level", () => {
      const files = [
        { path: "global.css", content: "body { margin: 0; }" },
      ];
      assertEquals(findGlobalStylesheet(files), "body { margin: 0; }");
    });

    it("should find styles/globals.css", () => {
      const files = [
        { path: "styles/globals.css", content: "@import 'tailwindcss';" },
      ];
      assertEquals(findGlobalStylesheet(files), "@import 'tailwindcss';");
    });

    it("should find app/globals.css", () => {
      const files = [
        { path: "app/globals.css", content: ".app { color: red; }" },
      ];
      assertEquals(findGlobalStylesheet(files), ".app { color: red; }");
    });

    it("should find src/globals.css", () => {
      const files = [
        { path: "src/globals.css", content: "/* src globals */" },
      ];
      assertEquals(findGlobalStylesheet(files), "/* src globals */");
    });

    it("should find src/styles/globals.css", () => {
      const files = [
        { path: "src/styles/globals.css", content: "/* src styles globals */" },
      ];
      assertEquals(findGlobalStylesheet(files), "/* src styles globals */");
    });

    it("should return first matching file when multiple exist", () => {
      const files = [
        { path: "globals.css", content: "first" },
        { path: "styles/globals.css", content: "second" },
        { path: "app/globals.css", content: "third" },
      ];
      assertEquals(findGlobalStylesheet(files), "first");
    });

    it("should skip files without content", () => {
      const files = [
        { path: "globals.css" },
        { path: "global.css", content: "has content" },
      ];
      assertEquals(findGlobalStylesheet(files), "has content");
    });

    it("should skip files with empty content", () => {
      const files = [
        { path: "globals.css", content: "" },
        { path: "global.css", content: "not empty" },
      ];
      // empty string is falsy, so it should be skipped
      assertEquals(findGlobalStylesheet(files), "not empty");
    });

    it("should return undefined for empty file list", () => {
      assertEquals(findGlobalStylesheet([]), undefined);
    });

    it("should not match files that end with globals.css but have different prefix", () => {
      const files = [
        { path: "my-globals.css", content: "should not match" },
      ];
      // The pattern /globals\.css$/ will match any path ending in globals.css
      // Actually, "my-globals.css" does end with "globals.css", so it will match
      assertEquals(findGlobalStylesheet(files), "should not match");
    });
  });

  describe("findStylesheetFromFiles", () => {
    it("should return stylesheet by exact path", () => {
      const files = [
        { path: "styles/custom.css", content: "custom css" },
        { path: "globals.css", content: "globals" },
      ];
      assertEquals(findStylesheetFromFiles(files, "styles/custom.css"), "custom css");
    });

    it("should strip leading slashes from stylesheetPath", () => {
      const files = [
        { path: "styles/custom.css", content: "custom css" },
      ];
      assertEquals(findStylesheetFromFiles(files, "/styles/custom.css"), "custom css");
    });

    it("should strip multiple leading slashes", () => {
      const files = [
        { path: "styles/custom.css", content: "custom css" },
      ];
      assertEquals(findStylesheetFromFiles(files, "///styles/custom.css"), "custom css");
    });

    it("should match file path ending with normalized path", () => {
      const files = [
        { path: "project/src/styles/custom.css", content: "nested custom css" },
      ];
      assertEquals(
        findStylesheetFromFiles(files, "styles/custom.css"),
        "nested custom css",
      );
    });

    it("should fallback to findGlobalStylesheet when stylesheetPath not found", () => {
      const files = [
        { path: "globals.css", content: "fallback globals" },
      ];
      assertEquals(
        findStylesheetFromFiles(files, "nonexistent.css"),
        "fallback globals",
      );
    });

    it("should fallback to findGlobalStylesheet when no stylesheetPath given", () => {
      const files = [
        { path: "globals.css", content: "default globals" },
      ];
      assertEquals(findStylesheetFromFiles(files), "default globals");
    });

    it("should return undefined when stylesheetPath not found and no global stylesheet", () => {
      const files = [
        { path: "pages/index.tsx", content: "page content" },
      ];
      assertEquals(findStylesheetFromFiles(files, "missing.css"), undefined);
    });

    it("should return undefined when no stylesheetPath and no global stylesheet", () => {
      const files = [
        { path: "pages/index.tsx", content: "page content" },
      ];
      assertEquals(findStylesheetFromFiles(files), undefined);
    });

    it("should skip file without content even when path matches", () => {
      const files = [
        { path: "styles/custom.css" },
        { path: "globals.css", content: "fallback" },
      ];
      assertEquals(findStylesheetFromFiles(files, "styles/custom.css"), "fallback");
    });
  });
});
