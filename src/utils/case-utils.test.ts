import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { capitalizeSeparatedWords } from "./case-utils.ts";

describe("case-utils", () => {
  it("capitalizes separated words", () => {
    assertEquals(capitalizeSeparatedWords("hello-world", "-", " "), "Hello World");
    assertEquals(capitalizeSeparatedWords("hello_world value", /[_\s]+/, ""), "HelloWorldValue");
  });

  it("ignores empty segments created by repeated separators", () => {
    assertEquals(capitalizeSeparatedWords("--hello---world--", /-+/, " "), "Hello World");
  });
});
