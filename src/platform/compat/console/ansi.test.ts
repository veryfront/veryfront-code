import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bold, colors, cyan, dim, green, red, reset, yellow } from "./ansi.ts";

describe("platform/compat/console/ansi", () => {
  describe("color functions", () => {
    const cases: Array<[string, (text: string) => string, string, string]> = [
      ["red", red, "hello", "\x1b[31mhello\x1b[39m"],
      ["green", green, "ok", "\x1b[32mok\x1b[39m"],
      ["yellow", yellow, "warn", "\x1b[33mwarn\x1b[39m"],
      ["cyan", cyan, "info", "\x1b[36minfo\x1b[39m"],
      ["bold", bold, "important", "\x1b[1mimportant\x1b[22m"],
      ["dim", dim, "subtle", "\x1b[2msubtle\x1b[22m"],
      ["reset", reset, "text", "\x1b[0mtext"],
    ];

    for (const [name, fn, input, expected] of cases) {
      it(`should wrap text with ${name} ANSI codes`, () => {
        assertEquals(fn(input), expected);
      });
    }

    it("reopens an outer color after a nested color closes", () => {
      assertEquals(
        red(`before ${green("inside")} after`),
        "\x1b[31mbefore \x1b[32minside\x1b[31m after\x1b[39m",
      );
    });

    it("reopens an outer modifier after a nested modifier closes", () => {
      assertEquals(
        bold(`before ${dim("inside")} after`),
        "\x1b[1mbefore \x1b[2minside\x1b[1m after\x1b[22m",
      );
    });
  });

  describe("colors object", () => {
    it("should expose all color functions", () => {
      const keys: Array<keyof typeof colors> = [
        "red",
        "green",
        "yellow",
        "blue",
        "cyan",
        "bold",
        "dim",
      ];

      for (const key of keys) {
        assertEquals(typeof colors[key], "function");
      }
    });
  });
});
