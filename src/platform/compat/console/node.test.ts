import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { colors } from "./node.ts";

describe("platform/compat/console/node", () => {
  it("keeps every style neutral", () => {
    const input = "plain text";
    for (const style of Object.values(colors)) {
      assertEquals(style(input), input);
    }
  });
});
