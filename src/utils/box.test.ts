import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BORDER_STYLES,
  box,
  divider,
  dividerWithText,
  joinHorizontal,
  joinVertical,
} from "./box.ts";
import { stripAnsi } from "./box.ts";

describe("cli/ui/box", () => {
  describe("BORDER_STYLES", () => {
    it("should have rounded style", () => {
      assertEquals(BORDER_STYLES.rounded.topLeft, "\u256D");
      assertEquals(BORDER_STYLES.rounded.horizontal, "\u2500");
    });

    it("should have square style", () => {
      assertEquals(BORDER_STYLES.square.topLeft, "\u250C");
    });

    it("should have double style", () => {
      assertEquals(BORDER_STYLES.double.topLeft, "\u2554");
    });

    it("should have heavy style", () => {
      assertEquals(BORDER_STYLES.heavy.topLeft, "\u250F");
    });

    it("should have none style with spaces", () => {
      assertEquals(BORDER_STYLES.none.topLeft, " ");
      assertEquals(BORDER_STYLES.none.horizontal, " ");
    });
  });

  describe("box", () => {
    it("should create a box around content", () => {
      const lines = box("hello").split("\n");
      assertEquals(lines.length >= 3, true);
    });

    it("should use rounded style by default", () => {
      const result = box("hi");
      assertEquals(result.includes("\u256D"), true);
      assertEquals(result.includes("\u256E"), true);
    });

    it("should use specified border style", () => {
      const result = box("hi", { style: "square" });
      assertEquals(result.includes("\u250C"), true);
    });

    it("should include title in top border", () => {
      assertEquals(box("content", { title: "Title" }).includes("Title"), true);
    });

    it("should handle center-aligned title", () => {
      const { topLeft, topRight, horizontal } = BORDER_STYLES.rounded;
      const topBorder = stripAnsi(
        box("content", { title: "C", titleAlign: "center", width: 20 }).split("\n")[0]!,
      );

      assertEquals(
        topBorder,
        `${topLeft}${horizontal.repeat(7)} C ${horizontal.repeat(8)}${topRight}`,
        "a centered title splits the remaining border fill on both sides",
      );
    });

    it("should handle right-aligned title", () => {
      const { topLeft, topRight, horizontal } = BORDER_STYLES.rounded;
      const topBorder = stripAnsi(
        box("content", { title: "C", titleAlign: "right", width: 20 }).split("\n")[0]!,
      );

      assertEquals(
        topBorder,
        `${topLeft}${horizontal.repeat(15)} C ${topRight}`,
        "a right-aligned title puts the whole border fill on its left",
      );
    });

    it("should left-align the title by default", () => {
      const { topLeft, topRight, horizontal } = BORDER_STYLES.rounded;
      const topBorder = stripAnsi(box("content", { title: "C", width: 20 }).split("\n")[0]!);

      assertEquals(
        topBorder,
        `${topLeft} C ${horizontal.repeat(15)}${topRight}`,
        "the default alignment puts the whole border fill on the title's right",
      );
    });

    it("should handle multi-line content", () => {
      const lines = box("line1\nline2\nline3").split("\n");
      assertEquals(lines.length >= 5, true);
    });

    it("should apply custom width", () => {
      const firstLine = box("hi", { width: 30 }).split("\n")[0]!;
      assertEquals(stripAnsi(firstLine).length, 30);
    });

    it("should handle zero paddingY", () => {
      const lines = box("hi", { paddingY: 0, padding: 0 }).split("\n");
      assertEquals(lines.length, 3);
    });

    it("should apply border color", () => {
      assertEquals(box("hi", { borderColor: "\x1b[31m" }).includes("\x1b[31m"), true);
    });

    it("should apply title color", () => {
      assertEquals(
        box("hi", { title: "T", titleColor: "\x1b[32m" }).includes("\x1b[32m"),
        true,
      );
    });
  });

  describe("joinHorizontal", () => {
    it("should return empty string for no items", () => {
      assertEquals(joinHorizontal("top", 2), "");
    });

    it("should return single item unchanged", () => {
      assertEquals(joinHorizontal("top", 2, "hello"), "hello");
    });

    it("should join two items horizontally", () => {
      const result = joinHorizontal("top", 2, "A", "B");
      assertEquals(result.includes("A"), true);
      assertEquals(result.includes("B"), true);
    });

    it("should insert exactly gap spaces between columns", () => {
      assertEquals(
        joinHorizontal("top", 3, "A", "B"),
        "A   B",
        "gap inserts exactly gap spaces between columns",
      );
    });

    it("should handle items with different heights (top align)", () => {
      assertEquals(
        joinHorizontal("top", 1, "a\nb", "c"),
        "a c\nb  ",
        "top alignment pads the short column below",
      );
    });

    it("should handle bottom alignment", () => {
      assertEquals(
        joinHorizontal("bottom", 1, "a\nb", "c"),
        "a  \nb c",
        "bottom alignment pads the short column above",
      );
    });

    it("should handle center alignment", () => {
      assertEquals(
        joinHorizontal("center", 1, "a\nb\nc", "d"),
        "a  \nb d\nc  ",
        "center alignment centers the short column",
      );
    });
  });

  describe("joinVertical", () => {
    it("should return empty string for no items", () => {
      assertEquals(joinVertical("left", 0), "");
    });

    it("should return single item unchanged", () => {
      assertEquals(joinVertical("left", 0, "hello"), "hello");
    });

    it("should join items vertically", () => {
      const lines = joinVertical("left", 0, "first", "second").split("\n");
      assertEquals(lines.length, 2);
    });

    it("should add gap between items", () => {
      const lines = joinVertical("left", 1, "first", "second").split("\n");
      assertEquals(lines.length, 3);
    });

    it("should align center", () => {
      const lines = joinVertical("center", 0, "hi", "hello").split("\n");
      assertEquals(lines[0]!.length, lines[1]!.length);
    });

    it("should align right", () => {
      const lines = joinVertical("right", 0, "hi", "hello").split("\n");
      assertEquals(lines[0]!.endsWith("hi"), true);
    });
  });

  describe("divider", () => {
    it("should create a horizontal divider of given width", () => {
      const result = divider(10);
      assertEquals(result.length, 10);
      assertEquals(result, "\u2500".repeat(10));
    });

    it("should use specified border style", () => {
      assertEquals(divider(5, "heavy"), "\u2501".repeat(5));
    });
  });

  describe("dividerWithText", () => {
    it("should create a divider with centered text", () => {
      const result = dividerWithText("Title", 20);
      assertEquals(result.includes("Title"), true);
      assertEquals(result.length, 20);
    });

    it("should use specified border style", () => {
      assertEquals(dividerWithText("Text", 20, "heavy").includes("\u2501"), true);
    });
  });
});
