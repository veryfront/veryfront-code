import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  blue,
  bold,
  colors,
  colorsPromise,
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
} from "./index.ts";

describe("compat/console/index.ts exports", () => {
  it("should export color functions", () => {
    for (const fn of [red, green, yellow, blue, cyan, magenta, white, gray]) {
      assertExists(fn);
    }
  });

  it("should export style functions", () => {
    for (const fn of [bold, dim, italic, underline, strikethrough, reset]) {
      assertExists(fn);
    }
  });

  it("should export colors object", () => {
    assertExists(colors);
    assertExists(colors.red);
    assertExists(colors.green);
    assertExists(colors.bold);
  });

  it("should export colorsPromise", () => {
    assertExists(colorsPromise);
  });

  it("color functions should return strings", () => {
    for (const fn of [red, green, bold]) {
      assertEquals(typeof fn("test"), "string");
    }
  });

  it("color functions should contain the input text", () => {
    const input = "test message";
    const output = red(input);
    assertEquals(output.includes(input) || output === input, true);
  });
});
