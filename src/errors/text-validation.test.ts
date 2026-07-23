import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasUnsafeControlCharacters, stripUnsafeControlCharacters } from "./text-validation.ts";

describe("errors/text-validation", () => {
  it("rejects terminal and bidirectional control characters", () => {
    for (const character of ["\u0085", "\u202e", "\u2066", "\u2069"]) {
      assertEquals(hasUnsafeControlCharacters(`safe${character}spoofed`), true);
      assertEquals(stripUnsafeControlCharacters(`safe${character}spoofed`), "safespoofed");
    }
  });

  it("preserves allowed formatting whitespace", () => {
    assertEquals(hasUnsafeControlCharacters("line one\n\tline two", true), false);
    assertEquals(stripUnsafeControlCharacters("line one\n\tline two"), "line one\n\tline two");
  });
});
