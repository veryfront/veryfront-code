import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getColorEnabled, red, setColorEnabled } from "./fmt-colors.ts";

describe("platform/compat/std/fmt-colors", () => {
  it("supports disabling color output", () => {
    const original = getColorEnabled();
    try {
      setColorEnabled(false);
      assertEquals(red("message"), "message");
    } finally {
      setColorEnabled(original);
    }
  });

  it("reopens a style after a nested formatter closes it", () => {
    const original = getColorEnabled();
    try {
      setColorEnabled(true);
      if (!getColorEnabled()) {
        assertEquals(red("message"), "message");
        return;
      }

      assertEquals(red("message"), "\x1b[31mmessage\x1b[39m");
      assertEquals(
        red(`outer ${red("inner")} tail`),
        "\x1b[31mouter \x1b[31minner\x1b[31m tail\x1b[39m",
      );
    } finally {
      setColorEnabled(original);
    }
  });
});
