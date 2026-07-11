import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { replaceSourceSpans } from "./source-spans.ts";

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
});
