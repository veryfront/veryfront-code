import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
} from "./source-spans.ts";

// Cases about which specifiers a scanner recognises, rather than about how many
// it collects, opt out of the bound explicitly.
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

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

  describe("findStaticImportFromSpans", () => {
    const matchRelative = (specifier: string) => specifier.startsWith("./") ? specifier : null;

    it("requires a positive safe match bound", () => {
      for (const maxMatches of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(
          () =>
            findStaticImportFromSpans('import value from "./value.js";', matchRelative, maxMatches),
          RangeError,
          "positive safe integer",
        );
      }
    });

    it("stops collecting after the explicit match bound", () => {
      const source = Array.from(
        { length: 20 },
        (_, index) => `import value${index} from "./value-${index}.js";`,
      ).join("\n");

      assertEquals(
        findStaticImportFromSpans(source, matchRelative, 3).map((span) => span.path),
        ["./value-0.js", "./value-1.js", "./value-2.js"],
      );
    });

    // A comment is legal after the keyword and after `from`, on the same terms
    // as whitespace.
    it("finds specifiers behind comments after the keyword and after from", () => {
      assertEquals(
        findStaticImportFromSpans(
          'import /* a */ value from /* b */ "./value.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./value.js"],
      );
      assertEquals(
        findStaticImportFromSpans(
          'export // a\n{ value } from // b\n"./value.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./value.js"],
      );
    });

    it("finds static imports after top-level block declarations", () => {
      assertEquals(
        findStaticImportFromSpans(
          'function f(){}import value from "./after-function.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./after-function.js"],
      );
    });

    it("finds static imports after regex literals containing string delimiters", () => {
      const cases = [
        [`const single = /it's/; import single from "./after-single.js";`, "./after-single.js"],
        ['const double = /"/; import double from "./after-double.js";', "./after-double.js"],
        [
          'const template = /`/; import template from "./after-template.js";',
          "./after-template.js",
        ],
      ] as const;

      for (const [source, expected] of cases) {
        assertEquals(
          findStaticImportFromSpans(source, matchRelative, UNBOUNDED).map((span) => span.path),
          [expected],
        );
      }
    });

    it("ignores static import-from text inside regex literals", () => {
      assertEquals(
        findStaticImportFromSpans(
          'const r = /;import value from "\\/_vf_modules\\/fake.js"/;',
          (specifier) => specifier.startsWith("/_vf_modules/") ? specifier : null,
          UNBOUNDED,
        ),
        [],
      );
    });

    it("keeps division distinct from regex literals", () => {
      assertEquals(
        findStaticImportFromSpans(
          'const ratio = total / 2; import value from "./after-division.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./after-division.js"],
      );
    });
  });

  describe("findDynamicImportSpans", () => {
    // Matches every relative specifier, so the tests are about which arguments
    // are recognised rather than about resolution.
    const matchRelative = (specifier: string) => specifier.startsWith("./") ? specifier : null;

    // These cases are about which arguments the scanner recognises, so they opt
    // out of the bound rather than exercising it.
    function specifiers(source: string): string[] {
      return findDynamicImportSpans(source, matchRelative, UNBOUNDED).map((span) => span.path);
    }

    function vfModuleSpecifiers(source: string): string[] {
      return findDynamicImportSpans(
        source,
        (specifier) => specifier.startsWith("/_vf_modules/") ? specifier : null,
        UNBOUNDED,
      ).map((span) => span.path);
    }

    it("requires a positive safe match bound", () => {
      for (const maxMatches of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(
          () => findDynamicImportSpans('await import("./value.js");', matchRelative, maxMatches),
          RangeError,
          "positive safe integer",
        );
      }
    });

    it("stops collecting after the explicit match bound", () => {
      const source = Array.from(
        { length: 20 },
        (_, index) => `const value${index} = await import("./value-${index}.js");`,
      ).join("\n");

      assertEquals(
        findDynamicImportSpans(source, matchRelative, 3).map((span) => span.path),
        ["./value-0.js", "./value-1.js", "./value-2.js"],
      );
    });

    it("finds a literal specifier", () => {
      assertEquals(specifiers(`const m = await import("./foo.js");`), ["./foo.js"]);
    });

    it("matches cooked quoted and template-literal specifiers while preserving source spans", () => {
      const quotedSource = 'import("./lazy\\x2ejs");';
      const templateSource = "import(`./lazy\\u002ejs`);";
      const escapedBackslashSource = 'import("./lazy\\\\x2ejs");';
      const [quoted] = findDynamicImportSpans(quotedSource, matchRelative, UNBOUNDED);
      const [template] = findDynamicImportSpans(templateSource, matchRelative, UNBOUNDED);
      const [escapedBackslash] = findDynamicImportSpans(
        escapedBackslashSource,
        matchRelative,
        UNBOUNDED,
      );

      assertEquals(quoted?.path, "./lazy.js");
      assertEquals(quoted?.original, '"./lazy\\x2ejs"');
      assertEquals(template?.path, "./lazy.js");
      assertEquals(template?.original, "`./lazy\\u002ejs`");
      assertEquals(escapedBackslash?.path, "./lazy\\x2ejs");
    });

    it("rejects malformed escaped import specifiers", () => {
      assertThrows(
        () => findDynamicImportSpans('import("./lazy\\xZZ");', matchRelative, UNBOUNDED),
        SyntaxError,
        "escaped module specifier",
      );
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

    it("finds executable imports inside template substitutions", () => {
      assertEquals(
        specifiers('const html = `<p>${await import("./inside.js")}</p>`;'),
        ["./inside.js"],
      );
      assertEquals(
        specifiers('const html = `<p>${`${await import("./nested.js")}`}</p>`;'),
        ["./nested.js"],
      );
    });

    it("ignores import-looking template text around substitutions", () => {
      assertEquals(
        specifiers(
          'const html = `import("./text.js") ${await import("./real.js")} import("./after.js")`;',
        ),
        ["./real.js"],
      );
    });

    it("finds executable imports after regex braces inside template substitutions", () => {
      assertEquals(
        specifiers('const html = `${/}/.test(x) ? import("./after-close.js") : null}`;'),
        ["./after-close.js"],
      );
      assertEquals(
        specifiers('const html = `${/\\}/.test(x) ? import("./after-escaped-close.js") : null}`;'),
        ["./after-escaped-close.js"],
      );
      assertEquals(
        specifiers('const html = `${/[{}]/.test(x) ? import("./after-class.js") : null}`;'),
        ["./after-class.js"],
      );
    });

    it("finds executable imports after await regex literals inside template substitutions", () => {
      assertEquals(
        specifiers(
          'const html = `${await /}/.test(x) ? import("./after-await-regex.js") : null}`;',
        ),
        ["./after-await-regex.js"],
      );
    });

    it("finds executable imports after regex literals following new", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${new /}/.constructor() && import("/_vf_modules/lazy.js")}`;',
        ),
        ["/_vf_modules/lazy.js"],
      );
    });

    it("ignores import-looking regex text after export default", () => {
      assertEquals(
        vfModuleSpecifiers('export default /import("\\/_vf_modules\\/a.js")/;'),
        [],
      );
    });

    it("ignores import-looking regex text after extends", () => {
      assertEquals(
        vfModuleSpecifiers(
          'class X extends /import("\\/_vf_modules\\/fake.js")/.constructor {}',
        ),
        [],
      );
    });

    it("ignores import-looking regex text after spread syntax", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const values = [.../import("\\/_vf_modules\\/fake.js")/];',
        ),
        [],
      );
    });

    it("ignores import-looking regex text after plain and labeled blocks", () => {
      assertEquals(
        vfModuleSpecifiers('{} /import("\\/_vf_modules\\/plain.js")/.test(value);'),
        [],
      );
      assertEquals(
        vfModuleSpecifiers('label: {} /import("\\/_vf_modules\\/labeled.js")/.test(value);'),
        [],
      );
    });

    it("finds executable imports after regex literals following closed blocks", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { if (ok) {} /}/.test(x); })() && import("/_vf_modules/lazy.js")}`;',
        ),
        ["/_vf_modules/lazy.js"],
      );
    });

    it("finds executable imports after regex literals following of", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { for (const x of /}/g) {} })() && import("/_vf_modules/for-of-lazy.js")}`;',
        ),
        ["/_vf_modules/for-of-lazy.js"],
      );
    });

    it("treats of as an identifier in a classic for-loop initializer", () => {
      assertEquals(
        vfModuleSpecifiers(
          'let of = 4; for (of / 2; shouldRun;) { import("/_vf_modules/classic-for-lazy.js") }',
        ),
        ["/_vf_modules/classic-for-lazy.js"],
      );
    });

    it("finds imports after regex literals following declaration blocks", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { function f() {} /}/.test(x); })() && import("/_vf_modules/function-lazy.js")}`;',
        ),
        ["/_vf_modules/function-lazy.js"],
      );
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { class C {} /}/.test(x); })() && import("/_vf_modules/class-lazy.js")}`;',
        ),
        ["/_vf_modules/class-lazy.js"],
      );
    });

    it("finds imports after regex literals following try statement blocks", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { try {} finally {} /}/.test(x); return true; })() && import("/_vf_modules/finally-lazy.js")}`;',
        ),
        ["/_vf_modules/finally-lazy.js"],
      );
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { try { throw x; } catch (error) {} /}/.test(x); return true; })() && import("/_vf_modules/catch-lazy.js")}`;',
        ),
        ["/_vf_modules/catch-lazy.js"],
      );
    });

    it("ignores line-comment parentheses when matching control conditions", () => {
      assertEquals(
        vfModuleSpecifiers(
          'const html = `${(() => { if (ok // fake (\n) /}/.test(x); return true; })() && import("/_vf_modules/comment-condition-lazy.js")}`;',
        ),
        ["/_vf_modules/comment-condition-lazy.js"],
      );
    });

    it("finds executable imports after regex braces following control conditions", () => {
      assertEquals(
        specifiers(
          'const html = `${(() => { if (ok) /}/.test(x); })() && import("./after-if-regex.js")}`;',
        ),
        ["./after-if-regex.js"],
      );
      assertEquals(
        specifiers(
          'const html = `${(() => { while (ok) /}/.test(x); })() && import("./after-while-regex.js")}`;',
        ),
        ["./after-while-regex.js"],
      );
    });

    it("ignores import-looking regex text inside template substitutions", () => {
      assertEquals(
        specifiers(
          'const html = `${/import\\("\\.\\/not\\.js"\\)/.test(x) ? import("./real.js") : null}`;',
        ),
        ["./real.js"],
      );
    });

    it("finds imports after division following postfix operators", () => {
      assertEquals(
        specifiers('let x = 1; x++ / 2; import("./after-plus-plus.js");'),
        ["./after-plus-plus.js"],
      );
      assertEquals(
        specifiers('let x = 1; x-- / 2; import("./after-minus-minus.js");'),
        ["./after-minus-minus.js"],
      );
      assertEquals(
        specifiers('const html = `${x++ / 2} ${import("./inside-plus-plus.js")}`;'),
        ["./inside-plus-plus.js"],
      );
      assertEquals(
        specifiers('const html = `${x-- / 2} ${import("./inside-minus-minus.js")}`;'),
        ["./inside-minus-minus.js"],
      );
    });

    it("bounds nested template substitution traversal", () => {
      const depth = 12_000;
      const source = "const html = `" + "${`".repeat(depth) + 'import("./deep.js")' +
        "`}".repeat(depth) + "`;";

      assertThrows(
        () => specifiers(source),
        RangeError,
        "Template literal nesting exceeds scanner limit",
      );
    });

    it("finds imports after nearby division forms", () => {
      assertEquals(
        specifiers('const ratio = value / 2; import("./after-numeric-division.js");'),
        ["./after-numeric-division.js"],
      );
      assertEquals(
        specifiers('const value = maybe?.count / 2; import("./after-optional-chain.js");'),
        ["./after-optional-chain.js"],
      );
      assertEquals(
        specifiers('const ratio = metrics.of / 2; import("./after-of-property.js");'),
        ["./after-of-property.js"],
      );
      assertEquals(
        specifiers('const of = 4; const ratio = of / 2; import("./after-of-identifier.js");'),
        ["./after-of-identifier.js"],
      );
      assertEquals(
        specifiers(
          'const html = `${constValue = {} / 2} ${import("./after-object-division.js")}`;',
        ),
        ["./after-object-division.js"],
      );
    });

    it("keeps brace-heavy division scans within a bounded runtime", () => {
      const source = "x={a:1}/2;\n".repeat(7_200);
      const startedAt = performance.now();

      assertEquals(specifiers(source), []);

      const durationMs = performance.now() - startedAt;
      assert(
        durationMs < 750,
        `Expected an 86 KB brace-heavy scan to finish within 750 ms, got ${
          durationMs.toFixed(1)
        } ms`,
      );
    });

    it("keeps repeated of-identifier division scans within a bounded runtime", () => {
      const source = "let " + Array.from(
        { length: 6_000 },
        (_, index) => `value${index} = of / 2`,
      ).join(", ") + ";";
      const startedAt = performance.now();

      assertEquals(specifiers(source), []);

      const durationMs = performance.now() - startedAt;
      assert(
        durationMs < 750,
        `Expected a ${Math.round(source.length / 1024)} KB of-identifier scan to finish within ` +
          `750 ms, got ${durationMs.toFixed(1)} ms`,
      );
    });

    it("keeps unmatched closing-delimiter division scans within a bounded runtime", () => {
      const source = ") / 2;\n".repeat(12_000) + "} / 2;\n".repeat(12_000);
      const startedAt = performance.now();

      assertEquals(specifiers(source), []);

      const durationMs = performance.now() - startedAt;
      assert(
        durationMs < 750,
        `Expected a ${Math.round(source.length / 1024)} KB closing-delimiter scan to finish ` +
          `within 750 ms, got ${durationMs.toFixed(1)} ms`,
      );
    });

    it("finds imports after division when literal contents look like control conditions", () => {
      assertEquals(
        specifiers('foo("if(") / 2 && import("./after-string-division.js");'),
        ["./after-string-division.js"],
      );
      assertEquals(
        specifiers("foo('while(') / 2 && import('./after-single-string-division.js');"),
        ["./after-single-string-division.js"],
      );
      assertEquals(
        specifiers("foo(`for(`) / 2 && import('./after-template-string-division.js');"),
        ["./after-template-string-division.js"],
      );
      assertEquals(
        specifiers("foo(/* switch( */ value) / 2 && import('./after-comment-division.js');"),
        ["./after-comment-division.js"],
      );
    });

    it("finds imports after regex literals following control statement conditions", () => {
      assertEquals(
        specifiers('if (ok) /"/.test(x); import("./after-if-quote.js");'),
        ["./after-if-quote.js"],
      );
      assertEquals(
        specifiers("while (ok) /`/.test(x); import('./after-while-backtick.js');"),
        ["./after-while-backtick.js"],
      );
      assertEquals(
        specifiers('for (; ok;) /\'/.test(x); import("./after-for-single.js");'),
        ["./after-for-single.js"],
      );
    });

    it("keeps nested import parentheses aligned with outer control conditions", () => {
      assertEquals(
        specifiers(
          'if (f(import("./inside.js"))) {} /}/.test(x); import("./after-block-regex.js");',
        ),
        ["./inside.js", "./after-block-regex.js"],
      );
    });

    it("finds imports after regex literals following noisy control blocks", () => {
      assertEquals(
        specifiers(
          'const html = `${(() => { if (ok) { const marker = "}"; /* { */ } /}/.test(x); return import("./after-noisy-block-regex.js"); })()}`;',
        ),
        ["./after-noisy-block-regex.js"],
      );
    });

    it("ignores a static import and a property called import", () => {
      assertEquals(specifiers(`import x from "./foo.js";`), []);
      assertEquals(specifiers(`obj.import("./foo.js");`), []);
    });

    it("ignores private methods named import", () => {
      assertEquals(
        vfModuleSpecifiers(
          'class Loader { #import(value) { return value; } load() { return this.#import("/_vf_modules/fake.js"); } }',
        ),
        [],
      );
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

    it("finds a non-interpolated template-literal specifier", () => {
      const source = "import(`./a.js`);";
      const [span] = findDynamicImportSpans(source, matchRelative, UNBOUNDED);
      assertEquals(span?.original, "`./a.js`");
      assertEquals(span?.path, "./a.js");
      assertEquals(
        replaceSourceSpans(source, [
          { start: span!.start, end: span!.end, replacement: `"file:///out/a.js"` },
        ]),
        `import("file:///out/a.js");`,
      );
    });

    it("spans only the quoted specifier when comments surround it", () => {
      const source = `import(/* hint */ "./a.js" /* eager */);`;
      const [span] = findDynamicImportSpans(source, matchRelative, UNBOUNDED);
      assertEquals(span?.original, `"./a.js"`);
      assertEquals(
        replaceSourceSpans(source, [
          { start: span!.start, end: span!.end, replacement: `"file:///out/a.js"` },
        ]),
        `import(/* hint */ "file:///out/a.js" /* eager */);`,
      );
    });
  });

  describe("findStaticSideEffectImportSpans", () => {
    const matchRelative = (specifier: string) => specifier.startsWith("./") ? specifier : null;

    it("requires a positive safe match bound", () => {
      for (const maxMatches of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(
          () => findStaticSideEffectImportSpans('import "./value.js";', matchRelative, maxMatches),
          RangeError,
          "positive safe integer",
        );
      }
    });

    it("stops collecting after the explicit match bound", () => {
      const source = Array.from(
        { length: 20 },
        (_, index) => `import "./value-${index}.js";`,
      ).join("\n");

      assertEquals(
        findStaticSideEffectImportSpans(source, matchRelative, 3).map((span) => span.path),
        ["./value-0.js", "./value-1.js", "./value-2.js"],
      );
    });

    // Only matched specifiers count against the bound, so unrelated side-effect
    // imports do not crowd out the ones the caller is looking for.
    it("counts only matched specifiers against the bound", () => {
      const source = [
        `import "some-package";`,
        `import "another-package";`,
        `import "./value.js";`,
      ].join("\n");

      assertEquals(
        findStaticSideEffectImportSpans(source, matchRelative, 2).map((span) => span.path),
        ["./value.js"],
      );
    });

    it("finds a non-interpolated template-literal side-effect specifier", () => {
      const [span] = findStaticSideEffectImportSpans(
        "import `./value.js`;",
        matchRelative,
        UNBOUNDED,
      );
      assertEquals(span?.original, "import `./value.js`");
      assertEquals(span?.path, "./value.js");
    });

    // Comments are legal wherever whitespace is, so a bundler hint can sit
    // between the keyword and the specifier. Missing the span leaves the
    // dependency neither materialised nor reported as unresolved: the module is
    // cached with a live `/_vf_modules/…` specifier and fails at execute time.
    it("finds a side-effect specifier behind a block comment", () => {
      const [span] = findStaticSideEffectImportSpans(
        'import /* @vite-ignore */ "./value.js";',
        matchRelative,
        UNBOUNDED,
      );
      assertEquals(span?.original, 'import /* @vite-ignore */ "./value.js"');
      assertEquals(span?.path, "./value.js");
    });

    it("finds a side-effect specifier behind a line comment", () => {
      const [span] = findStaticSideEffectImportSpans(
        'import // @vite-ignore\n"./value.js";',
        matchRelative,
        UNBOUNDED,
      );
      assertEquals(span?.path, "./value.js");
    });

    it("finds same-line side-effect imports after separators and comments", () => {
      const spans = findStaticSideEffectImportSpans(
        '/* preload; */ import "./a.js"; /* next; */ import "./b.js";',
        matchRelative,
        UNBOUNDED,
      );
      assertEquals(spans.map((span) => span.path), ["./a.js", "./b.js"]);
    });

    it("finds side-effect imports after top-level block declarations", () => {
      assertEquals(
        findStaticSideEffectImportSpans(
          'function f(){}import "./after-function.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./after-function.js"],
      );
      assertEquals(
        findStaticSideEffectImportSpans(
          'class C {}import "./after-class.js";',
          matchRelative,
          UNBOUNDED,
        ).map((span) => span.path),
        ["./after-class.js"],
      );
    });

    it("ignores side-effect import text inside regex literals", () => {
      assertEquals(
        findStaticSideEffectImportSpans(
          'const r = /;import "\\/_vf_modules\\/a.js"/;',
          (specifier) => specifier.startsWith("/_vf_modules/") ? specifier : null,
          UNBOUNDED,
        ),
        [],
      );
    });
  });
});
