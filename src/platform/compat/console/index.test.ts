import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
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
    assertExists(red);
    assertExists(green);
    assertExists(yellow);
    assertExists(blue);
    assertExists(cyan);
    assertExists(magenta);
    assertExists(white);
    assertExists(gray);
  });

  it("should export style functions", () => {
    assertExists(bold);
    assertExists(dim);
    assertExists(italic);
    assertExists(underline);
    assertExists(strikethrough);
    assertExists(reset);
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
    assertEquals(typeof red("test"), "string");
    assertEquals(typeof green("test"), "string");
    assertEquals(typeof bold("test"), "string");
  });

  it("color functions should contain the input text", () => {
    const input = "test message";
    assertEquals(red(input).includes(input) || red(input) === input, true);
  });
});
