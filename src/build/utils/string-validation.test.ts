import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasControlCharacters } from "./string-validation.ts";

describe("build/utils/string-validation", () => {
  it("recognizes C0, DEL, and C1 control characters", () => {
    assertEquals(
      hasControlCharacters("plain text"),
      false,
      "plain text carries no control characters",
    );
    assertEquals(hasControlCharacters("line\nbreak"), true, "a line feed is a control character");
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x00)),
      true,
      "NUL starts the C0 range",
    );
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x1f)),
      true,
      "0x1f ends the C0 range",
    );
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x7f)),
      true,
      "DEL is a control character",
    );
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x9f)),
      true,
      "0x9f ends the C1 range",
    );
  });

  it("does not reject printable characters around the control ranges", () => {
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x20)),
      false,
      "space is printable, not a control character",
    );
    assertEquals(
      hasControlCharacters(String.fromCharCode(0x7e)),
      false,
      "tilde is printable, not a control character",
    );
    assertEquals(
      hasControlCharacters(String.fromCharCode(0xa0)),
      false,
      "NBSP is printable, not a control character",
    );
  });

  it("does not reject printable Unicode", () => {
    assertEquals(hasControlCharacters("Grüße 世界 🚀"), false, "printable Unicode is accepted");
  });
});
