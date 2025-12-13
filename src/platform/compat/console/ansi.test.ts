import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import {
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  bold,
  dim,
  italic,
  underline,
  strikethrough,
  reset,
  colors,
} from "./ansi.ts";

describe("platform/compat/console/ansi", () => {
  describe("color functions", () => {
    it("red should wrap text with red ANSI codes", () => {
      const result = red("test");
      assertEquals(result, "\x1b[31mtest\x1b[39m");
    });

    it("green should wrap text with green ANSI codes", () => {
      const result = green("test");
      assertEquals(result, "\x1b[32mtest\x1b[39m");
    });

    it("yellow should wrap text with yellow ANSI codes", () => {
      const result = yellow("test");
      assertEquals(result, "\x1b[33mtest\x1b[39m");
    });

    it("blue should wrap text with blue ANSI codes", () => {
      const result = blue("test");
      assertEquals(result, "\x1b[34mtest\x1b[39m");
    });

    it("magenta should wrap text with magenta ANSI codes", () => {
      const result = magenta("test");
      assertEquals(result, "\x1b[35mtest\x1b[39m");
    });

    it("cyan should wrap text with cyan ANSI codes", () => {
      const result = cyan("test");
      assertEquals(result, "\x1b[36mtest\x1b[39m");
    });

    it("white should wrap text with white ANSI codes", () => {
      const result = white("test");
      assertEquals(result, "\x1b[37mtest\x1b[39m");
    });

    it("gray should wrap text with gray ANSI codes", () => {
      const result = gray("test");
      assertEquals(result, "\x1b[90mtest\x1b[39m");
    });
  });

  describe("style functions", () => {
    it("bold should wrap text with bold ANSI codes", () => {
      const result = bold("test");
      assertEquals(result, "\x1b[1mtest\x1b[22m");
    });

    it("dim should wrap text with dim ANSI codes", () => {
      const result = dim("test");
      assertEquals(result, "\x1b[2mtest\x1b[22m");
    });

    it("italic should wrap text with italic ANSI codes", () => {
      const result = italic("test");
      assertEquals(result, "\x1b[3mtest\x1b[23m");
    });

    it("underline should wrap text with underline ANSI codes", () => {
      const result = underline("test");
      assertEquals(result, "\x1b[4mtest\x1b[24m");
    });

    it("strikethrough should wrap text with strikethrough ANSI codes", () => {
      const result = strikethrough("test");
      assertEquals(result, "\x1b[9mtest\x1b[29m");
    });

    it("reset should wrap text with reset ANSI code", () => {
      const result = reset("test");
      assertEquals(result, "\x1b[0mtest");
    });
  });

  describe("colors object", () => {
    it("should contain all color functions", () => {
      assert(typeof colors.red === "function");
      assert(typeof colors.green === "function");
      assert(typeof colors.yellow === "function");
      assert(typeof colors.blue === "function");
      assert(typeof colors.cyan === "function");
      assert(typeof colors.magenta === "function");
      assert(typeof colors.white === "function");
      assert(typeof colors.gray === "function");
    });

    it("should contain all style functions", () => {
      assert(typeof colors.bold === "function");
      assert(typeof colors.dim === "function");
      assert(typeof colors.italic === "function");
      assert(typeof colors.underline === "function");
      assert(typeof colors.strikethrough === "function");
      assert(typeof colors.reset === "function");
    });

    it("colors object functions should work correctly", () => {
      assertEquals(colors.red("test"), "\x1b[31mtest\x1b[39m");
      assertEquals(colors.bold("test"), "\x1b[1mtest\x1b[22m");
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      assertEquals(red(""), "\x1b[31m\x1b[39m");
      assertEquals(bold(""), "\x1b[1m\x1b[22m");
    });

    it("should handle special characters", () => {
      const text = "Hello\nWorld\t!";
      const result = red(text);
      assertEquals(result, `\x1b[31m${text}\x1b[39m`);
    });

    it("should handle unicode characters", () => {
      const text = "Hello 世界 🌍";
      const result = green(text);
      assertEquals(result, `\x1b[32m${text}\x1b[39m`);
    });
  });
});
