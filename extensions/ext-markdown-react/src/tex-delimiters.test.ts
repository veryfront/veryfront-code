import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { normalizeTexDelimiters } from "./tex-delimiters.ts";

describe("normalizeTexDelimiters", () => {
  it("converts inline and display TeX delimiters", () => {
    assertEquals(
      normalizeTexDelimiters("Tip: \\(0.18 \\times 84.50\\) per head."),
      "Tip: $$0.18 \\times 84.50$$ per head.",
    );
    assertEquals(
      normalizeTexDelimiters("\\[a^2 + b^2 = c^2\\]"),
      "\n\n$$\na^2 + b^2 = c^2\n$$\n\n",
    );
  });

  it("converts a display expression spanning several lines", () => {
    assertEquals(
      normalizeTexDelimiters("\\[\n  a + b\n\\]"),
      "\n\n$$\na + b\n$$\n\n",
    );
  });

  it("leaves fenced code untouched", () => {
    const source = "```tex\n\\(not math here\\)\n```";

    assertEquals(normalizeTexDelimiters(source), source);
  });

  it("leaves an inline code span untouched", () => {
    const source = "Escape it as `\\(x\\)` in source.";

    assertEquals(normalizeTexDelimiters(source), source);
  });

  it("converts around a fence without touching it", () => {
    assertEquals(
      normalizeTexDelimiters("\\(a\\)\n\n```\n\\(b\\)\n```\n\n\\(c\\)"),
      "$$a$$\n\n```\n\\(b\\)\n```\n\n$$c$$",
    );
  });

  it("returns the source unchanged when it holds no TeX delimiters", () => {
    const source = "Plain **markdown** with $84.50 and a `code` span.";

    assertEquals(normalizeTexDelimiters(source), source);
  });

  it("leaves an unpaired delimiter alone", () => {
    const source = "A stray \\( with no closer.";

    assertEquals(normalizeTexDelimiters(source), source);
  });
});
