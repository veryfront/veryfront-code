import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
  });
});
