import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { isWellFormedString } from "./is-well-formed-string.ts";

describe("ext-css-lightning isWellFormedString", () => {
  it("accepts valid UTF-16 and rejects unpaired surrogates", () => {
    assertEquals(isWellFormedString("styles/\uD83D\uDE00.css"), true);
    assertEquals(isWellFormedString("\uD800"), false);
    assertEquals(isWellFormedString("\uDC00"), false);
    assertEquals(isWellFormedString("\uD800x"), false);
  });
});
