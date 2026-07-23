import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { tokenizeJavaScriptSource } from "./import-specifiers.ts";

describe("modules/loader-shared/import-specifiers", () => {
  it("treats division after a string literal as executable code", () => {
    const tokens = tokenizeJavaScriptSource('const ratio = "value" / divisor / 2;');

    assertEquals(tokens.some((token) => token.value === "divisor"), true);
  });

  it("treats division after a regex literal as executable code", () => {
    const tokens = tokenizeJavaScriptSource("const ratio = /value/ / divisor / 2;");

    assertEquals(tokens.some((token) => token.value === "divisor"), true);
  });
});
