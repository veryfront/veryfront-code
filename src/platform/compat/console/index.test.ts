import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "../runtime.ts";
import { colors as denoColors } from "./deno.ts";
import { colors as nodeColors } from "./node.ts";
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

  it("delegates every style to the styler selected for the current runtime", () => {
    const expected = isDeno ? denoColors : nodeColors;
    for (const key of ["red", "green", "bold", "dim", "reset"] as const) {
      assertEquals(
        colors[key]("test message"),
        expected[key]("test message"),
        `barrel must delegate ${key} to the ${isDeno ? "deno" : "node"} styler`,
      );
    }
    if (!isDeno) {
      assertEquals(
        red("x"),
        "x",
        "Node/Bun styling stays identity so escapes never reach pipes or JSON logs",
      );
    }
  });
});
