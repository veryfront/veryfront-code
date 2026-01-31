import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findGlobalStylesheet, findStylesheetFromFiles } from "./css-pregeneration.ts";

describe("styles-builder/css-pregeneration", () => {
  describe("findGlobalStylesheet", () => {
    it("should return undefined when no files match", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "pages/index.tsx", content: "export default () => {}" },
          { path: "components/button.tsx", content: "<button/>" },
        ]),
        undefined,
      );
    });

    it("should find globals.css at root level", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "@tailwind base;" },
          { path: "pages/index.tsx", content: "export default () => {}" },
        ]),
        "@tailwind base;",
      );
    });

    it("should find global.css at root level", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "global.css", content: "body { margin: 0; }" }]),
        "body { margin: 0; }",
      );
    });

    it("should find styles/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "styles/globals.css", content: "@import 'tailwindcss';" },
        ]),
        "@import 'tailwindcss';",
      );
    });

    it("should find app/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "app/globals.css", content: ".app { color: red; }" },
        ]),
        ".app { color: red; }",
      );
    });

    it("should find src/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "src/globals.css", content: "/* src globals */" }]),
        "/* src globals */",
      );
    });

    it("should find src/styles/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "src/styles/globals.css", content: "/* src styles globals */" },
        ]),
        "/* src styles globals */",
      );
    });

    it("should return first matching file when multiple exist", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "first" },
          { path: "styles/globals.css", content: "second" },
          { path: "app/globals.css", content: "third" },
        ]),
        "first",
      );
    });

    it("should skip files without content", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css" },
          { path: "global.css", content: "has content" },
        ]),
        "has content",
      );
    });

    it("should skip files with empty content", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "" },
          { path: "global.css", content: "not empty" },
        ]),
        "not empty",
      );
    });

    it("should return undefined for empty file list", () => {
      assertEquals(findGlobalStylesheet([]), undefined);
    });

    it("should not match files that end with globals.css but have different prefix", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "my-globals.css", content: "should not match" }]),
        "should not match",
      );
    });
  });

  describe("findStylesheetFromFiles", () => {
    it("should return stylesheet by exact path", () => {
      assertEquals(
        findStylesheetFromFiles(
          [
            { path: "styles/custom.css", content: "custom css" },
            { path: "globals.css", content: "globals" },
          ],
          "styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should strip leading slashes from stylesheetPath", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "styles/custom.css", content: "custom css" }],
          "/styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should strip multiple leading slashes", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "styles/custom.css", content: "custom css" }],
          "///styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should match file path ending with normalized path", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "project/src/styles/custom.css", content: "nested custom css" }],
          "styles/custom.css",
        ),
        "nested custom css",
      );
    });

    it("should fallback to findGlobalStylesheet when stylesheetPath not found", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "globals.css", content: "fallback globals" }],
          "nonexistent.css",
        ),
        "fallback globals",
      );
    });

    it("should fallback to findGlobalStylesheet when no stylesheetPath given", () => {
      assertEquals(
        findStylesheetFromFiles([{ path: "globals.css", content: "default globals" }]),
        "default globals",
      );
    });

    it("should return undefined when stylesheetPath not found and no global stylesheet", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "pages/index.tsx", content: "page content" }],
          "missing.css",
        ),
        undefined,
      );
    });

    it("should return undefined when no stylesheetPath and no global stylesheet", () => {
      assertEquals(
        findStylesheetFromFiles([{ path: "pages/index.tsx", content: "page content" }]),
        undefined,
      );
    });

    it("should skip file without content even when path matches", () => {
      assertEquals(
        findStylesheetFromFiles(
          [
            { path: "styles/custom.css" },
            { path: "globals.css", content: "fallback" },
          ],
          "styles/custom.css",
        ),
        "fallback",
      );
    });
  });
});
