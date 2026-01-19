import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HIDE_CURSOR, SHOW_CURSOR, type TypewriterOptions } from "./animated-text.ts";

describe("ANSI cursor codes", () => {
  it("should export HIDE_CURSOR constant", () => {
    assertExists(HIDE_CURSOR);
    assertEquals(typeof HIDE_CURSOR, "string");
    assertEquals(HIDE_CURSOR.includes("\x1b"), true, "Should contain escape sequence");
  });

  it("should export SHOW_CURSOR constant", () => {
    assertExists(SHOW_CURSOR);
    assertEquals(typeof SHOW_CURSOR, "string");
    assertEquals(SHOW_CURSOR.includes("\x1b"), true, "Should contain escape sequence");
  });

  it("should have different values for hide and show cursor", () => {
    // Compare string values (TypeScript knows these are different const types)
    assertEquals(String(HIDE_CURSOR) !== String(SHOW_CURSOR), true);
  });
});

describe("TypewriterOptions interface", () => {
  it("should accept charDelay option", () => {
    const options: TypewriterOptions = { charDelay: 50 };
    assertEquals(options.charDelay, 50);
  });

  it("should accept wordDelay option", () => {
    const options: TypewriterOptions = { wordDelay: 200 };
    assertEquals(options.wordDelay, 200);
  });

  it("should accept mode option", () => {
    const charMode: TypewriterOptions = { mode: "char" };
    const wordMode: TypewriterOptions = { mode: "word" };
    assertEquals(charMode.mode, "char");
    assertEquals(wordMode.mode, "word");
  });

  it("should accept hideCursor option", () => {
    const options: TypewriterOptions = { hideCursor: false };
    assertEquals(options.hideCursor, false);
  });

  it("should accept all options together", () => {
    const options: TypewriterOptions = {
      charDelay: 25,
      wordDelay: 150,
      mode: "word",
      hideCursor: true,
    };
    assertEquals(options.charDelay, 25);
    assertEquals(options.wordDelay, 150);
    assertEquals(options.mode, "word");
    assertEquals(options.hideCursor, true);
  });
});
