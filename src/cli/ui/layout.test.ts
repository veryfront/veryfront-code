import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  lines,
  maxLineWidth,
  pad,
  repeat,
  stripAnsi,
  truncate,
  visibleLength,
  wrap,
} from "./layout.ts";

describe("cli/ui/layout", () => {
  describe("visibleLength", () => {
    it("should return length of plain text", () => {
      assertEquals(visibleLength("hello"), 5);
    });

    it("should exclude ANSI escape codes from length", () => {
      assertEquals(visibleLength("\x1b[31mhello\x1b[0m"), 5);
    });

    it("should handle empty string", () => {
      assertEquals(visibleLength(""), 0);
    });

    it("should handle text with multiple ANSI codes", () => {
      assertEquals(visibleLength("\x1b[1m\x1b[31mbold red\x1b[0m"), 8);
    });
  });

  describe("truncate", () => {
    it("should not truncate text shorter than maxWidth", () => {
      assertEquals(truncate("hello", 10), "hello");
    });

    it("should truncate text longer than maxWidth", () => {
      const result = truncate("hello world", 8);
      // Should be 7 visible chars + ellipsis
      assertEquals(stripAnsi(result).length <= 8, true);
    });

    it("should use custom ellipsis", () => {
      const result = truncate("hello world", 8, "...");
      assertEquals(result.includes("..."), true);
    });

    it("should handle exact width", () => {
      assertEquals(truncate("hello", 5), "hello");
    });

    it("should handle width of 1 with default ellipsis", () => {
      const result = truncate("hello world", 1);
      // Result should have visible length <= 1
      assertEquals(visibleLength(result) <= 1, true);
    });
  });

  describe("pad", () => {
    it("should left-pad by default", () => {
      const result = pad("hi", 5);
      assertEquals(result, "hi   ");
    });

    it("should right-pad", () => {
      const result = pad("hi", 5, "right");
      assertEquals(result, "   hi");
    });

    it("should center-pad", () => {
      const result = pad("hi", 6, "center");
      assertEquals(result, "  hi  ");
    });

    it("should center-pad with odd padding", () => {
      const result = pad("hi", 5, "center");
      // 3 padding chars: floor(3/2)=1 left, 2 right
      assertEquals(result, " hi  ");
    });

    it("should not pad if text is already wide enough", () => {
      assertEquals(pad("hello", 3), "hello");
    });

    it("should handle ANSI codes in text", () => {
      const result = pad("\x1b[31mhi\x1b[0m", 5);
      assertEquals(visibleLength(result), 5);
    });
  });

  describe("wrap", () => {
    it("should not wrap text shorter than maxWidth", () => {
      const result = wrap("hello", 20);
      assertEquals(result, ["hello"]);
    });

    it("should wrap long text at word boundaries", () => {
      const result = wrap("hello world foo bar", 11);
      assertEquals(result, ["hello world", "foo bar"]);
    });

    it("should handle single long word", () => {
      const result = wrap("superlongword", 5);
      assertEquals(result, ["superlongword"]);
    });

    it("should return original text for maxWidth <= 0", () => {
      const result = wrap("hello world", 0);
      assertEquals(result, ["hello world"]);
    });

    it("should wrap each word separately when maxWidth is very small", () => {
      const result = wrap("a b c", 1);
      assertEquals(result, ["a", "b", "c"]);
    });
  });

  describe("repeat", () => {
    it("should repeat character n times", () => {
      assertEquals(repeat("-", 5), "-----");
    });

    it("should return empty string for count 0", () => {
      assertEquals(repeat("-", 0), "");
    });

    it("should return empty string for negative count", () => {
      assertEquals(repeat("-", -1), "");
    });

    it("should repeat multi-char strings", () => {
      assertEquals(repeat("ab", 3), "ababab");
    });
  });

  describe("stripAnsi", () => {
    it("should strip ANSI codes", () => {
      assertEquals(stripAnsi("\x1b[31mhello\x1b[0m"), "hello");
    });

    it("should return plain text unchanged", () => {
      assertEquals(stripAnsi("hello"), "hello");
    });
  });

  describe("lines", () => {
    it("should split text into lines", () => {
      assertEquals(lines("a\nb\nc"), ["a", "b", "c"]);
    });

    it("should handle single line", () => {
      assertEquals(lines("hello"), ["hello"]);
    });

    it("should handle empty string", () => {
      assertEquals(lines(""), [""]);
    });
  });

  describe("maxLineWidth", () => {
    it("should return max visible width", () => {
      assertEquals(maxLineWidth(["hi", "hello", "yo"]), 5);
    });

    it("should return 0 for empty array", () => {
      assertEquals(maxLineWidth([]), 0);
    });

    it("should ignore ANSI codes in width calculation", () => {
      assertEquals(maxLineWidth(["\x1b[31mhi\x1b[0m", "hello"]), 5);
    });
  });
});
