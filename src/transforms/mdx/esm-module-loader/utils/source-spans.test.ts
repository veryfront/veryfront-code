import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findDynamicImportSpans, replaceSourceSpans } from "./source-spans.ts";

describe("transforms/mdx/esm-module-loader/utils/source-spans", () => {
  describe("replaceSourceSpans", () => {
    it("replaces a single span", () => {
      const source = 'from "./old.js"';
      const result = replaceSourceSpans(source, [
        { start: 6, end: 14, replacement: "./new.js" },
      ]);
      assertEquals(result, 'from "./new.js"');
    });

    it("replaces multiple non-overlapping spans back-to-front", () => {
      // Positions: `./a.js` is [15,21) and `./b.js` is [39,45) in the source.
      // (Quotes at 14 and 21 are not part of the specifier spans.)
      const source = 'import A from "./a.js"; import B from "./b.js";';
      const result = replaceSourceSpans(source, [
        { start: 15, end: 21, replacement: "./aNew.js" },
        { start: 39, end: 45, replacement: "./bNew.js" },
      ]);
      assertEquals(result, 'import A from "./aNew.js"; import B from "./bNew.js";');
    });

    it("validates expected text before replacing", () => {
      const source = 'from "./old.js"';
      assertThrows(
        () =>
          replaceSourceSpans(source, [
            { start: 6, end: 14, replacement: "./new.js", expected: "./wrong.js" },
          ]),
        Error,
        "did not match expected text",
      );
    });

    it("throws on out-of-bounds span", () => {
      const source = "abc";
      assertThrows(
        () => replaceSourceSpans(source, [{ start: 0, end: 10, replacement: "x" }]),
        RangeError,
        "Invalid source replacement span",
      );
    });

    it("throws on overlapping spans with same start", () => {
      const source = 'from "./old.js"';
      assertThrows(
        () =>
          replaceSourceSpans(source, [
            { start: 6, end: 14, replacement: "./a.js" },
            { start: 6, end: 14, replacement: "./b.js" },
          ]),
        RangeError,
        "Overlapping",
      );
    });

    it("throws when earlier span end overlaps later span start", () => {
      // Span [2,8) and [5,12) overlap because 8 > 5
      const source = "abcdefghijklmnop";
      assertThrows(
        () =>
          replaceSourceSpans(source, [
            { start: 2, end: 8, replacement: "X" },
            { start: 5, end: 12, replacement: "Y" },
          ]),
        RangeError,
        "Overlapping",
      );
    });

    it("accepts adjacent non-overlapping spans", () => {
      // [0,3) and [3,6) are adjacent — no overlap
      const source = "abcdef";
      const result = replaceSourceSpans(source, [
        { start: 0, end: 3, replacement: "ABC" },
        { start: 3, end: 6, replacement: "DEF" },
      ]);
      assertEquals(result, "ABCDEF");
    });

    it("returns source unchanged for empty replacements", () => {
      const source = "unchanged";
      assertEquals(replaceSourceSpans(source, []), "unchanged");
    });
  });

  describe("findDynamicImportSpans", () => {
    // Matches every relative specifier, so the tests are about which arguments
    // are recognised rather than about resolution.
    const matchRelative = (specifier: string) => specifier.startsWith("./") ? specifier : null;

    function specifiers(source: string): string[] {
      return findDynamicImportSpans(source, matchRelative).map((span) => span.path);
    }

    it("finds a literal specifier", () => {
      assertEquals(specifiers(`const m = await import("./foo.js");`), ["./foo.js"]);
    });

    it("finds a literal specifier with import attributes", () => {
      assertEquals(
        specifiers(`await import("./data.json", { with: { type: "json" } });`),
        ["./data.json"],
      );
    });

    it("finds several in one module", () => {
      assertEquals(
        specifiers(`import("./a.js"); import("./b.js");`),
        ["./a.js", "./b.js"],
      );
    });

    // Regression: the literal prefix used to be rewritten on its own, so
    // `import("./foo" + suffix)` resolved to `import("file:///…/foo" + suffix)`.
    it("skips a specifier the literal only starts", () => {
      assertEquals(specifiers(`await import("./foo" + suffix);`), []);
      assertEquals(specifiers("await import(`./foo` + suffix);"), []);
      assertEquals(specifiers(`await import("./foo".concat(suffix));`), []);
      assertEquals(specifiers(`await import(ok ? "./foo.js" : "./bar.js");`), []);
    });

    it("skips a specifier that is not a literal at all", () => {
      assertEquals(specifiers("await import(path);"), []);
      assertEquals(specifiers("await import(`./${name}.js`);"), []);
    });

    it("ignores a static import and a property called import", () => {
      assertEquals(specifiers(`import x from "./foo.js";`), []);
      assertEquals(specifiers(`obj.import("./foo.js");`), []);
    });

    it("ignores an import-looking string or comment", () => {
      assertEquals(specifiers(`const s = 'import("./foo.js")';`), []);
      assertEquals(specifiers(`// import("./foo.js")\nconst x = 1;`), []);
    });

    it("keeps scanning after a skipped specifier", () => {
      assertEquals(
        specifiers(`import("./a" + s); import("./b.js");`),
        ["./b.js"],
      );
    });

    it("finds a specifier across whitespace and newlines", () => {
      assertEquals(specifiers(`import (\n  "./a.js"\n);`), ["./a.js"]);
    });

    it("finds a specifier around comments", () => {
      // A bundler hint is the common reason for a comment inside the call.
      assertEquals(specifiers(`import(/* webpackChunkName: "a" */ "./a.js");`), ["./a.js"]);
      assertEquals(specifiers(`import /* lazy */ ("./a.js");`), ["./a.js"]);
      assertEquals(specifiers(`import("./a.js" /* eager */);`), ["./a.js"]);
      assertEquals(specifiers(`import(\n  // the slow half\n  "./a.js",\n);`), ["./a.js"]);
    });

    it("finds a specifier awaited inside a nested expression", () => {
      assertEquals(
        specifiers(`const load = async () => (await import("./a.js")).default;`),
        ["./a.js"],
      );
      assertEquals(
        specifiers(`export const mod = import("./a.js").then((m) => m.default);`),
        ["./a.js"],
      );
    });

    it("finds a specifier carrying a query or hash suffix", () => {
      // The matcher decides what a suffix means; the scanner passes it through.
      assertEquals(specifiers(`import("./a.js?raw");`), ["./a.js?raw"]);
      assertEquals(specifiers(`import("./a.js#frag");`), ["./a.js#frag"]);
    });

    it("still skips a specifier the literal only starts when a comment follows it", () => {
      assertEquals(specifiers(`import("./a.js" /* then */ + suffix);`), []);
    });

    it("ignores a dynamic import inside a block comment", () => {
      assertEquals(specifiers(`/* import("./a.js") */ const x = 1;`), []);
    });

    // A template literal with no substitution is a valid specifier, but the
    // scanner only treats quoted strings as literals, so it stays unresolved
    // rather than being rewritten from a form it cannot verify.
    it("skips a template-literal specifier", () => {
      assertEquals(specifiers("import(`./a.js`);"), []);
    });

    it("spans only the quoted specifier when comments surround it", () => {
      const source = `import(/* hint */ "./a.js" /* eager */);`;
      const [span] = findDynamicImportSpans(source, matchRelative);
      assertEquals(span?.original, `"./a.js"`);
      assertEquals(
        replaceSourceSpans(source, [
          { start: span!.start, end: span!.end, replacement: `"file:///out/a.js"` },
        ]),
        `import(/* hint */ "file:///out/a.js" /* eager */);`,
      );
    });
  });
});
