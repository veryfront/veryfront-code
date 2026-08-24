import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  blue,
  bold,
  colors,
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
} from "./ansi.ts";

describe("platform/compat/console/ansi", () => {
  describe("color functions", () => {
    const cases: Array<[string, (text: string) => string, string, string]> = [
      ["red", red, "hello", "\x1b[31mhello\x1b[39m"],
      ["green", green, "ok", "\x1b[32mok\x1b[39m"],
      ["yellow", yellow, "warn", "\x1b[33mwarn\x1b[39m"],
      ["cyan", cyan, "info", "\x1b[36minfo\x1b[39m"],
      ["blue", blue, "x", "\x1b[34mx\x1b[39m"],
      ["magenta", magenta, "x", "\x1b[35mx\x1b[39m"],
      ["white", white, "x", "\x1b[37mx\x1b[39m"],
      ["gray", gray, "x", "\x1b[90mx\x1b[39m"],
      ["bold", bold, "important", "\x1b[1mimportant\x1b[22m"],
      ["dim", dim, "subtle", "\x1b[2msubtle\x1b[22m"],
      ["italic", italic, "x", "\x1b[3mx\x1b[23m"],
      ["underline", underline, "x", "\x1b[4mx\x1b[24m"],
      ["strikethrough", strikethrough, "x", "\x1b[9mx\x1b[29m"],
      ["reset", reset, "text", "\x1b[0mtext"],
    ];

    for (const [name, fn, input, expected] of cases) {
      it(`should wrap text with ${name} ANSI codes`, () => {
        assertEquals(fn(input), expected);
      });
    }
  });

  describe("colors object", () => {
    it("should expose all color functions", () => {
      const expected: Record<keyof typeof colors, (text: string) => string> = {
        red,
        green,
        yellow,
        blue,
        cyan,
        magenta,
        white,
        gray,
        bold,
        dim,
        italic,
        underline,
        strikethrough,
        reset,
      };

      for (const [key, fn] of Object.entries(expected)) {
        assertEquals(
          colors[key as keyof typeof colors],
          fn,
          `colors.${key} must be the ${key} function`,
        );
      }
    });
  });
});
