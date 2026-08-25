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

    it("ignores identifiers that merely contain the word import", () => {
      // Without a word boundary, `important` reads as an import statement. In a
      // release-asset build a bogus specifier becomes a fatal coverage gap, so
      // a false positive here fails the whole release.
      assertEquals(extractCssImportSpecifiers('const important = "./styles.css";'), []);
      assertEquals(extractCssImportSpecifiers('let unimportant = "./a.css";'), []);
      // The real thing still matches, including with no space before the quote.
      assertEquals(extractCssImportSpecifiers('import"./styles.css";'), ["./styles.css"]);
    });

    it("over-matches commented and quoted imports, which is the contract", () => {
      // Not an oversight. Callers skip what they cannot resolve, so a phantom
      // specifier costs nothing. An earlier revision blanked these regions
      // because the release build had made this output fatal; that fix kept
      // finding new holes, and an unpaired `/*` or backtick blanked across real
      // code and silently dropped a genuine import. Looseness is the safer
      // failure: an extra specifier is ignored, a missing one loses a stylesheet.
      assertEquals(extractCssImportSpecifiers('// import "./legacy.css";'), ["./legacy.css"]);
      assertEquals(extractCssImportSpecifiers('const t = `import "./legacy.css"`;'), [
        "./legacy.css",
      ]);
    });

    it("never loses a real import to an unpaired comment or backtick", () => {
      // The regression the blanking introduced: `/*` inside a line comment
      // paired with a later real `*/`, and a stray backtick in prose paired
      // with the next one, blanking the real import in between. A build that
      // ships a page without its stylesheet is worse than one that over-matches.
      assertEquals(
        extractCssImportSpecifiers('// TODO drop /* legacy\nimport "./real.css";\nconst a = 1;'),
        ["./real.css"],
      );
      assertEquals(
        extractCssImportSpecifiers('Use the ` char.\n\nimport "./real.css";\n\n`Button`'),
        ["./real.css"],
      );
    });

    it("does not treat import.meta as an import statement", () => {
      // `import` followed by a `.css` string later in the same statement used to
      // match, because nothing required the keyword to begin a declaration.
      assertEquals(
        extractCssImportSpecifiers('console.log(import.meta.url, "./styles.css");'),
        [],
      );
      assertEquals(
        extractCssImportSpecifiers('const u = import.meta.resolve("./a.css");'),
        [],
      );
    });

    it("matches dynamic imports, which are real CSS imports", () => {
      // Pinned deliberately. `import("./theme.css")` loads that stylesheet at
      // runtime, so dropping it would leave the compiled stylesheet missing CSS
      // the page uses. A dynamic specifier naming a file that does not exist is
      // a broken reference, not a false positive -- same as a static one.
      assertEquals(
        extractCssImportSpecifiers('const load = () => import("./theme.css");'),
        ["./theme.css"],
      );
      assertEquals(extractCssImportSpecifiers('await import("./a.css");'), ["./a.css"]);
      // Still excluded, because that is a property access rather than an import.
      assertEquals(extractCssImportSpecifiers('import.meta.resolve("./a.css");'), []);
    });

    it("finds every real import in a mixed file", () => {
      const source = [
        '// import "./commented.css";',
        'import "./real.css";',
        'import styles from "./mod.module.css";',
      ].join("\n");
      // The commented one comes along too; what matters is that neither real
      // import is lost.
      assertEquals(extractCssImportSpecifiers(source), [
        "./commented.css",
        "./real.css",
        "./mod.module.css",
      ]);
    });

    it("keeps a URL in a string from reading as a comment", () => {
      assertEquals(
        extractCssImportSpecifiers('const cdn = "https://x.dev";\nimport "./real.css";'),
        ["./real.css"],
      );
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
