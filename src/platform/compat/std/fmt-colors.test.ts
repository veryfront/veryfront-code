import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createColor } from "./fmt-colors.ts";

describe("platform/compat/std/fmt-colors", () => {
  it("reopens an outer ANSI style after a nested close sequence", () => {
    const red = createColor(31, 39);
    const blue = createColor(34, 39);

    assertEquals(
      red(`before ${blue("nested")} after`),
      "\x1b[31mbefore \x1b[34mnested\x1b[31m after\x1b[39m",
    );
  });
});
