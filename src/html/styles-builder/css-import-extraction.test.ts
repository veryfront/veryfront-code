import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectCssImportPaths,
  extractCssImportSpecifiers,
  resolveCssImportPath,
} from "./css-import-extraction.ts";
import {
  MAX_CSS_IMPORTS,
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
} from "./resource-limits.ts";

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

    it("ignores imports in comments, values, regular expressions, and dynamic calls", () => {
      const source = [
        '// import "./line-comment.css";',
        '/* import "./block-comment.css"; */',
        "const text = 'import \"./string-value.css\";';",
        'const pattern = /import "\\.\\/regex-value.css"/;',
        'const lazy = import("./dynamic.css");',
        "const metadata = import.meta.url;",
        'import "./static.css";',
      ].join("\n");

      assertEquals(extractCssImportSpecifiers(source), ["./static.css"]);
    });

    it("rejects source content above the per-file byte limit", () => {
      assertThrows(
        () => extractCssImportSpecifiers("a".repeat(MAX_STYLE_SOURCE_FILE_BYTES + 1)),
        TypeError,
        "source content exceeds",
      );
    });

    it("rejects excessive CSS import statements", () => {
      const source = Array.from(
        { length: MAX_CSS_IMPORTS + 1 },
        (_, index) => `import "./style-${index}.css";`,
      ).join("\n");

      assertThrows(
        () => extractCssImportSpecifiers(source),
        TypeError,
        "CSS import count exceeds",
      );
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

    it("rejects source lists above the file-count limit", () => {
      const files = Array.from(
        { length: MAX_STYLE_SOURCE_FILES + 1 },
        (_, index) => ({ path: `/project/source-${index}.ts`, content: "" }),
      );

      assertThrows(
        () => collectCssImportPaths(files, "/project"),
        TypeError,
        "source file count exceeds",
      );
    });
  });
});
