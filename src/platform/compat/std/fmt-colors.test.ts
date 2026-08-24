import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  blue,
  bold,
  createColor,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  reset,
  strikethrough,
  underline,
  white,
  yellow,
} from "./fmt-colors.ts";

describe("platform/compat/std/fmt-colors", () => {
  it("reopens an outer ANSI style after a nested close sequence", () => {
    const red = createColor(31, 39);
    const blue = createColor(34, 39);

    assertEquals(
      red(`before ${blue("nested")} after`),
      "\x1b[31mbefore \x1b[34mnested\x1b[31m after\x1b[39m",
    );
  });

  it("emits the documented open and close codes for each named style", () => {
    const cases: Array<[string, (str: string) => string, string]> = [
      ["red", red, "\x1b[31mx\x1b[39m"],
      ["green", green, "\x1b[32mx\x1b[39m"],
      ["yellow", yellow, "\x1b[33mx\x1b[39m"],
      ["blue", blue, "\x1b[34mx\x1b[39m"],
      ["magenta", magenta, "\x1b[35mx\x1b[39m"],
      ["cyan", cyan, "\x1b[36mx\x1b[39m"],
      ["white", white, "\x1b[37mx\x1b[39m"],
      ["gray", gray, "\x1b[90mx\x1b[39m"],
      ["bold", bold, "\x1b[1mx\x1b[22m"],
      ["dim", dim, "\x1b[2mx\x1b[22m"],
      ["italic", italic, "\x1b[3mx\x1b[23m"],
      ["underline", underline, "\x1b[4mx\x1b[24m"],
      ["strikethrough", strikethrough, "\x1b[9mx\x1b[29m"],
      ["reset", reset, "\x1b[0mx\x1b[0m"],
    ];
    for (const [name, style, expected] of cases) {
      assertEquals(style("x"), expected, `${name} emits its documented open and close codes`);
    }
  });
});
