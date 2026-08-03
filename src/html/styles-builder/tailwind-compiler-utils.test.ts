import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  evaluateProjectCSSLocalCacheState,
  formatCSSErrorMessage,
  parseProjectCSSCacheEntry,
} from "./tailwind-compiler-utils.ts";
import { hashCSS, hashString } from "./css-identity.ts";

describe("styles-builder/tailwind-compiler-utils", () => {
  describe("parseProjectCSSCacheEntry", () => {
    it("returns parsed entry when JSON shape is valid", () => {
      const css = ".foo{color:red}";
      const raw = JSON.stringify({
        css,
        hash: hashCSS(css),
        candidatesHash: hashString("candidates"),
      });
      assertEquals(parseProjectCSSCacheEntry(raw), {
        css,
        hash: hashCSS(css),
        candidatesHash: hashString("candidates"),
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
    it("formats plugin options errors", () => {
      assertEquals(
        formatCSSErrorMessage('The plugin "@tailwindcss/forms" does not accept options'),
        {
          title: "Plugin Options Not Supported",
          message: "@tailwindcss/forms does not accept options",
          suggestion: 'Remove the options block from @plugin "@tailwindcss/forms".',
        },
      );
    });

    it("formats plugin load errors with single quotes", () => {
      const formatted = formatCSSErrorMessage("Failed to load plugin 'my-plugin'");
      assertEquals(formatted.title, "Plugin Not Available");
      assertEquals(formatted.message, "The configured CSS processor could not load: my-plugin");
    });

    it("falls back to generic formatting", () => {
      assertEquals(formatCSSErrorMessage("Something else"), {
        title: "CSS Compilation Error",
        message: "Something else",
        suggestion: "Check the stylesheet and explicit CSS provider configuration.",
      });
    });
  });
});
