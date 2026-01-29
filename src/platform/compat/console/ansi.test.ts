import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bold, colors, cyan, dim, green, red, reset, yellow } from "./ansi.ts";

describe("platform/compat/console/ansi", () => {
  describe("color functions", () => {
    it("should wrap text with red ANSI codes", () => {
      assertEquals(red("hello"), "\x1b[31mhello\x1b[39m");
    });

    it("should wrap text with green ANSI codes", () => {
      assertEquals(green("ok"), "\x1b[32mok\x1b[39m");
    });

    it("should wrap text with yellow ANSI codes", () => {
      assertEquals(yellow("warn"), "\x1b[33mwarn\x1b[39m");
    });

    it("should wrap text with cyan ANSI codes", () => {
      assertEquals(cyan("info"), "\x1b[36minfo\x1b[39m");
    });

    it("should wrap text with bold ANSI codes", () => {
      assertEquals(bold("important"), "\x1b[1mimportant\x1b[22m");
    });

    it("should wrap text with dim ANSI codes", () => {
      assertEquals(dim("subtle"), "\x1b[2msubtle\x1b[22m");
    });

    it("should apply reset", () => {
      assertEquals(reset("text"), "\x1b[0mtext");
    });
  });

  describe("colors object", () => {
    it("should expose all color functions", () => {
      assertEquals(typeof colors.red, "function");
      assertEquals(typeof colors.green, "function");
      assertEquals(typeof colors.yellow, "function");
      assertEquals(typeof colors.blue, "function");
      assertEquals(typeof colors.cyan, "function");
      assertEquals(typeof colors.bold, "function");
      assertEquals(typeof colors.dim, "function");
    });
  });
});
