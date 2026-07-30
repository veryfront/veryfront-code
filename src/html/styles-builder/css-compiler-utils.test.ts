import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCSSCacheEntry,
  evaluateProjectCSSLocalCacheState,
  formatCSSErrorMessage,
  parseCSSCacheEntry,
  parseProjectCSSCacheEntry,
  resolveStylesheet,
} from "./css-compiler-utils.ts";

describe("styles-builder/css-compiler-utils", () => {
  describe("resolveStylesheet", () => {
    it("uses fallback when stylesheet is undefined", () => {
      assertEquals(resolveStylesheet(undefined, "default"), "default");
    });

    it("keeps provided stylesheet when present", () => {
      assertEquals(resolveStylesheet("custom", "default"), "custom");
    });
  });

  describe("buildCSSCacheEntry", () => {
    it("normalizes Set candidates to an array", () => {
      const entry = buildCSSCacheEntry("body{}", {
        candidates: new Set(["mt-4", "p-2"]),
        stylesheet: "custom",
      }, "default");

      assertEquals(entry.css, "body{}");
      assertEquals(entry.candidates, ["mt-4", "p-2"]);
      assertEquals(entry.stylesheet, "custom");
    });

    it("uses defaults when inputs are missing", () => {
      const entry = buildCSSCacheEntry("body{}", undefined, "default");
      assertEquals(entry.css, "body{}");
      assertEquals(entry.candidates, []);
      assertEquals(entry.stylesheet, "default");
    });
  });

  describe("parseCSSCacheEntry", () => {
    it("parses structured JSON entries", () => {
      const raw = JSON.stringify({
        css: ".foo{color:red}",
        candidates: ["foo", "bar"],
        stylesheet: "custom",
      });
      const entry = parseCSSCacheEntry(raw, "default");
      assertEquals(entry.css, ".foo{color:red}");
      assertEquals(entry.candidates, ["foo", "bar"]);
      assertEquals(entry.stylesheet, "custom");
    });

    it("falls back to defaults when optional JSON fields are missing", () => {
      const raw = JSON.stringify({ css: ".foo{color:red}" });
      const entry = parseCSSCacheEntry(raw, "default");
      assertEquals(entry.css, ".foo{color:red}");
      assertEquals(entry.candidates, []);
      assertEquals(entry.stylesheet, "default");
    });

    it("treats malformed JSON as legacy plain CSS", () => {
      const raw = "{not valid json";
      const entry = parseCSSCacheEntry(raw, "default");
      assertEquals(entry.css, raw);
      assertEquals(entry.candidates, []);
      assertEquals(entry.stylesheet, "default");
    });
  });

  describe("parseProjectCSSCacheEntry", () => {
    it("returns parsed entry when JSON shape is valid", () => {
      const raw = JSON.stringify({
        css: ".foo{color:red}",
        hash: "abcd1234",
        candidatesHash: "candidates123",
      });
      assertEquals(parseProjectCSSCacheEntry(raw), {
        css: ".foo{color:red}",
        hash: "abcd1234",
        candidatesHash: "candidates123",
      });
    });

    it("returns undefined for invalid JSON shape", () => {
      const raw = JSON.stringify({ css: ".foo{color:red}", hash: "abcd1234" });
      assertEquals(parseProjectCSSCacheEntry(raw), undefined);
    });
  });

  describe("evaluateProjectCSSLocalCacheState", () => {
    it("classifies missing entry as miss", () => {
      assertEquals(evaluateProjectCSSLocalCacheState(undefined, "abc", 1000), "miss");
    });

    it("classifies expired entry", () => {
      assertEquals(
        evaluateProjectCSSLocalCacheState({ expiresAt: 999, candidatesHash: "abc" }, "abc", 1000),
        "expired",
      );
    });

    it("classifies candidates mismatch", () => {
      assertEquals(
        evaluateProjectCSSLocalCacheState({ expiresAt: 1001, candidatesHash: "abc" }, "def", 1000),
        "mismatch",
      );
    });

    it("classifies equal expiry timestamp as hit", () => {
      assertEquals(
        evaluateProjectCSSLocalCacheState({ expiresAt: 1000, candidatesHash: "abc" }, "abc", 1000),
        "hit",
      );
    });
  });

  describe("formatCSSErrorMessage", () => {
    it("formats parser syntax errors without provider-specific policy", () => {
      assertEquals(
        formatCSSErrorMessage("Unexpected closing brace"),
        {
          title: "CSS Syntax Error",
          message: "Unexpected closing brace",
          suggestion: "Check the stylesheet syntax reported by the configured CSS processor",
        },
      );
    });

    it("falls back to generic formatting", () => {
      assertEquals(formatCSSErrorMessage("Something else"), {
        title: "CSS Compilation Error",
        message: "Something else",
        suggestion: "Check your stylesheet for errors",
      });
    });
  });
});
