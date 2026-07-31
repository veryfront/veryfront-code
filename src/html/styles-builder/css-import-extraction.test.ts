import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import {
  collectCssImportPaths,
  extractCssImportSpecifiers,
  resolveCssImportPath,
} from "./css-import-extraction.ts";

describe("html/styles-builder/css-import-extraction", () => {
  describe("extractCssImportSpecifiers", () => {
    it("extracts side-effect and default CSS imports", () => {
      const source = [
        'import "./styles.css";',
        'import styles from "./button.module.css";',
        'import { thing } from "./not-css.ts";',
        'import "@/theme/tokens.css";',
      ].join("\n");

      assertEquals(extractCssImportSpecifiers(source), [
        "./styles.css",
        "./button.module.css",
        "@/theme/tokens.css",
      ]);
    });

    it("does not match specifiers across statement boundaries", () => {
      const source = 'const a = 1; import { b } from "./b.ts"; const s = "x.css";';
      assertEquals(extractCssImportSpecifiers(source), []);
    });

    it("matches multiline import statements", () => {
      const source = 'import\n  "./styles.css";';
      assertEquals(extractCssImportSpecifiers(source), ["./styles.css"]);
    });
  });

  describe("resolveCssImportPath", () => {
    it("resolves relative specifiers against the importing file", () => {
      assertEquals(
        resolveCssImportPath("./styles.css", "/project/app/layout.tsx", "/project"),
        "/project/app/styles.css",
      );
      assertEquals(
        resolveCssImportPath("../globals.css", "/project/app/layout.tsx", "/project"),
        "/project/globals.css",
      );
    });

    it("resolves @/ alias specifiers against the project root", () => {
      assertEquals(
        resolveCssImportPath("@/theme/tokens.css", "/project/app/layout.tsx", "/project"),
        "/project/theme/tokens.css",
      );
    });

    it("resolves project-root specifiers against the project root", () => {
      assertEquals(
        resolveCssImportPath("/theme/tokens.css", "/project/app/layout.tsx", "/project"),
        "/project/theme/tokens.css",
      );
    });

    it("ignores bare and URL specifiers", () => {
      assertEquals(
        resolveCssImportPath("some-package/dist.css", "/project/a.tsx", "/project"),
        null,
      );
      assertEquals(
        resolveCssImportPath("https://cdn.example/x.css", "/project/a.tsx", "/project"),
        null,
      );
    });

    it("rejects paths escaping the project directory", () => {
      assertEquals(
        resolveCssImportPath("../../etc/passwd.css", "/project/app/layout.tsx", "/project"),
        null,
      );
    });

    it("rejects overlong specifier, importer, and project paths before normalization", () => {
      for (
        const args of [
          [`./${"a".repeat(MAX_PATH_LENGTH_CHARS)}.css`, "/project/app/page.tsx", "/project"],
          ["./styles.css", `/project/${"a".repeat(MAX_PATH_LENGTH_CHARS)}`, "/project"],
          ["./styles.css", "/project/app/page.tsx", `/${"p".repeat(MAX_PATH_LENGTH_CHARS)}`],
        ] as const
      ) {
        assertThrows(
          () => resolveCssImportPath(args[0], args[1], args[2]),
          TypeError,
          `${MAX_PATH_LENGTH_CHARS} characters`,
        );
      }
    });

    it("rejects control characters in CSS import paths", () => {
      assertThrows(
        () => resolveCssImportPath("./bad\n.css", "/project/app/page.tsx", "/project"),
        TypeError,
        "without control characters",
      );
    });
  });

  describe("collectCssImportPaths", () => {
    it("deduplicates and sorts resolved paths", () => {
      const files = [
        { path: "/project/app/layout.tsx", content: 'import "./styles.css";' },
        { path: "/project/app/page.tsx", content: 'import "./styles.css";\nimport "./b.css";' },
        { path: "/project/lib/util.ts", content: "export const x = 1;" },
      ];

      assertEquals(collectCssImportPaths(files, "/project"), [
        "/project/app/b.css",
        "/project/app/styles.css",
      ]);
    });

    it("admits exactly 10,000 unique imported stylesheets", () => {
      const content = Array.from(
        { length: 10_000 },
        (_, index) => `import "./styles-${index}.css";`,
      ).join("\n");

      assertEquals(
        collectCssImportPaths([{ path: "/project/app/page.tsx", content }], "/project").length,
        10_000,
      );
    });

    it("rejects more than 10,000 unique imported stylesheets", () => {
      const content = Array.from(
        { length: 10_001 },
        (_, index) => `import "./styles-${index}.css";`,
      ).join("\n");

      assertThrows(
        () => collectCssImportPaths([{ path: "/project/app/page.tsx", content }], "/project"),
        TypeError,
        "10000 files",
      );
    });

    it("rejects more than 10,000 source entries even when none imports CSS", () => {
      function* files() {
        for (let index = 0; index <= 10_000; index++) {
          yield { path: `/project/app/source-${index}.ts`, content: "export {};" };
        }
      }

      assertThrows(
        () => collectCssImportPaths(files(), "/project"),
        TypeError,
        "10000 source files",
      );
    });
  });
});
