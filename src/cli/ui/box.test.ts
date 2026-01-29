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
import { stripAnsi } from "./layout.ts";

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
      const result = box("hello");
      const lines = result.split("\n");
      assertEquals(lines.length >= 3, true); // at least top border, content, bottom border
    });

    it("should use rounded style by default", () => {
      const result = box("hi");
      assertEquals(result.includes("\u256D"), true); // rounded top-left
      assertEquals(result.includes("\u256E"), true); // rounded top-right
    });

    it("should use specified border style", () => {
      const result = box("hi", { style: "square" });
      assertEquals(result.includes("\u250C"), true); // square top-left
    });

    it("should include title in top border", () => {
      const result = box("content", { title: "Title" });
      assertEquals(result.includes("Title"), true);
    });

    it("should handle center-aligned title", () => {
      const result = box("content", { title: "Center", titleAlign: "center" });
      assertEquals(result.includes("Center"), true);
    });

    it("should handle right-aligned title", () => {
      const result = box("content", { title: "Right", titleAlign: "right" });
      assertEquals(result.includes("Right"), true);
    });

    it("should handle multi-line content", () => {
      const result = box("line1\nline2\nline3");
      const lines = result.split("\n");
      assertEquals(lines.length >= 5, true); // top + 3 content + bottom
    });

    it("should apply custom width", () => {
      const result = box("hi", { width: 30 });
      const firstLine = result.split("\n")[0]!;
      // The first line (top border) should have visible length of 30
      assertEquals(stripAnsi(firstLine).length, 30);
    });

    it("should handle zero paddingY", () => {
      const result = box("hi", { paddingY: 0, padding: 0 });
      const lines = result.split("\n");
      // top border + content + bottom border = 3 lines minimum
      assertEquals(lines.length, 3);
    });

    it("should apply border color", () => {
      const result = box("hi", { borderColor: "\x1b[31m" });
      assertEquals(result.includes("\x1b[31m"), true);
    });

    it("should apply title color", () => {
      const result = box("hi", { title: "T", titleColor: "\x1b[32m" });
      assertEquals(result.includes("\x1b[32m"), true);
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

    it("should handle items with different heights (top align)", () => {
      const result = joinHorizontal("top", 1, "a\nb", "c");
      const lines = result.split("\n");
      assertEquals(lines.length, 2);
    });

    it("should handle bottom alignment", () => {
      const result = joinHorizontal("bottom", 1, "a\nb", "c");
      const lines = result.split("\n");
      assertEquals(lines.length, 2);
    });

    it("should handle center alignment", () => {
      const result = joinHorizontal("center", 1, "a\nb\nc", "d");
      const lines = result.split("\n");
      assertEquals(lines.length, 3);
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
      const result = joinVertical("left", 0, "first", "second");
      const lines = result.split("\n");
      assertEquals(lines.length, 2);
    });

    it("should add gap between items", () => {
      const result = joinVertical("left", 1, "first", "second");
      const lines = result.split("\n");
      assertEquals(lines.length, 3); // first + gap + second
    });

    it("should align center", () => {
      const result = joinVertical("center", 0, "hi", "hello");
      const lines = result.split("\n");
      // "hi" should be centered within width of "hello" (5)
      assertEquals(lines[0]!.length, lines[1]!.length);
    });

    it("should align right", () => {
      const result = joinVertical("right", 0, "hi", "hello");
      const lines = result.split("\n");
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
      const result = divider(5, "heavy");
      assertEquals(result, "\u2501".repeat(5));
    });
  });

  describe("dividerWithText", () => {
    it("should create a divider with centered text", () => {
      const result = dividerWithText("Title", 20);
      assertEquals(result.includes("Title"), true);
      assertEquals(result.length, 20);
    });

    it("should use specified border style", () => {
      const result = dividerWithText("Text", 20, "heavy");
      assertEquals(result.includes("\u2501"), true);
    });
  });
});
