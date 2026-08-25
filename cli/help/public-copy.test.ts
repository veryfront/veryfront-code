import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { COMMANDS } from "./command-definitions.ts";

describe("CLI help public copy", () => {
  it("uses ASCII punctuation", () => {
    assertEquals(/[\u2013\u2014]/.test(JSON.stringify(COMMANDS)), false);
  });
});
