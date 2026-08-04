import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  FALLBACK_COLUMNS,
  FALLBACK_ROWS,
  getTerminalHeight,
  getTerminalWidth,
  lines,
  maxLineWidth,
  pad,
  repeat,
  stripAnsi,
  truncate,
  usableSize,
  visibleLength,
  wrap,
} from "./layout.ts";

describe("cli/ui/layout", () => {
  describe("terminal size", () => {
    it("falls back when the terminal reports zero", () => {
      // A pty with no window size reports 0 columns. Callers subtract from
      // this and pass the result to String.repeat, which throws on a negative
      // count, and that took the whole TUI down when the prompt rendered.
      // Asserted on the pure helper so a host with a real terminal cannot
      // make the old implementation pass.
      assertEquals(usableSize(0, FALLBACK_COLUMNS), FALLBACK_COLUMNS);
      assertEquals(usableSize(0, FALLBACK_ROWS), FALLBACK_ROWS);
    });

    it("falls back for negative and non-finite sizes", () => {
      assertEquals(usableSize(-10, FALLBACK_COLUMNS), FALLBACK_COLUMNS);
      assertEquals(usableSize(Number.NaN, FALLBACK_COLUMNS), FALLBACK_COLUMNS);
      assertEquals(usableSize(Number.POSITIVE_INFINITY, FALLBACK_COLUMNS), FALLBACK_COLUMNS);
    });

    it("keeps a real terminal size", () => {
      assertEquals(usableSize(120, FALLBACK_COLUMNS), 120);
    });

    it("reports usable dimensions through the public helpers", () => {
      assertEquals(getTerminalWidth() > 0, true);
      assertEquals(getTerminalHeight() > 0, true);
    });

    it("keeps the derived divider width non-negative", () => {
      const dividerWidth = Math.max(0, Math.min(getTerminalWidth() - 4, 80));
      assertEquals(dividerWidth >= 0, true);
      // Would throw RangeError if the width went negative.
      assertEquals(typeof "-".repeat(dividerWidth), "string");
    });
  });

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
      assertEquals(visibleLength(result) <= 1, true);
    });
  });

  describe("pad", () => {
    it("should left-pad by default", () => {
      assertEquals(pad("hi", 5), "hi   ");
    });

    it("should right-pad", () => {
      assertEquals(pad("hi", 5, "right"), "   hi");
    });

    it("should center-pad", () => {
      assertEquals(pad("hi", 6, "center"), "  hi  ");
    });

    it("should center-pad with odd padding", () => {
      assertEquals(pad("hi", 5, "center"), " hi  ");
    });

    it("should not pad if text is already wide enough", () => {
      assertEquals(pad("hello", 3), "hello");
    });

    it("should handle ANSI codes in text", () => {
      assertEquals(visibleLength(pad("\x1b[31mhi\x1b[0m", 5)), 5);
    });
  });

  describe("wrap", () => {
    it("should not wrap text shorter than maxWidth", () => {
      assertEquals(wrap("hello", 20), ["hello"]);
    });

    it("should wrap long text at word boundaries", () => {
      assertEquals(wrap("hello world foo bar", 11), ["hello world", "foo bar"]);
    });

    it("should handle single long word", () => {
      assertEquals(wrap("superlongword", 5), ["superlongword"]);
    });

    it("should return original text for maxWidth <= 0", () => {
      assertEquals(wrap("hello world", 0), ["hello world"]);
    });

    it("should wrap each word separately when maxWidth is very small", () => {
      assertEquals(wrap("a b c", 1), ["a", "b", "c"]);
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
