import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasControlCharacters } from "./string-validation.ts";

describe("build/utils/string-validation", () => {
  it("recognizes C0, DEL, and C1 control characters", () => {
    assertEquals(hasControlCharacters("plain text"), false);
    assertEquals(hasControlCharacters("line\nbreak"), true);
    assertEquals(hasControlCharacters(`del${String.fromCharCode(0x7f)}`), true);
    assertEquals(hasControlCharacters(`c1${String.fromCharCode(0x85)}`), true);
  });

  it("does not reject printable Unicode", () => {
    assertEquals(hasControlCharacters("Grüße 世界 🚀"), false);
  });
});
