import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ANSI_REGEX,
  bg16,
  bg256,
  bgRgb,
  CSI,
  cursor,
  ESC,
  fg16,
  fg256,
  fgRgb,
  getSpinnerFrame,
  RESET,
  screen,
  SPINNER_FRAMES,
  stripAnsi,
  style,
} from "./ansi.ts";

describe("cli/ui/ansi", () => {
  describe("constants", () => {
    it("should have correct ESC value", () => {
      assertEquals(ESC, "\x1b");
    });

    it("should have CSI as ESC + [", () => {
      assertEquals(CSI, "\x1b[");
    });

    it("should have RESET code", () => {
      assertEquals(RESET, "\x1b[0m");
    });
  });

  describe("cursor", () => {
    it("should generate hide cursor sequence", () => {
      assertEquals(cursor.hide, `${CSI}?25l`);
    });

    it("should generate show cursor sequence", () => {
      assertEquals(cursor.show, `${CSI}?25h`);
    });

    it("should generate moveTo sequence", () => {
      assertEquals(cursor.moveTo(5, 10), `${CSI}5;10H`);
    });

    it("should generate up sequence", () => {
      assertEquals(cursor.up(3), `${CSI}3A`);
    });

    it("should generate down sequence with default", () => {
      assertEquals(cursor.down(), `${CSI}1B`);
    });

    it("should generate right sequence", () => {
      assertEquals(cursor.right(2), `${CSI}2C`);
    });

    it("should generate left sequence", () => {
      assertEquals(cursor.left(4), `${CSI}4D`);
    });
  });

  describe("screen", () => {
    it("should have clear sequence", () => {
      assertEquals(screen.clear, `${CSI}2J`);
    });

    it("should have clearLine sequence", () => {
      assertEquals(screen.clearLine, `${CSI}2K`);
    });

    it("should have clearLineReturn sequence", () => {
      assertEquals(screen.clearLineReturn, `${CSI}2K\r`);
    });
  });

  describe("style", () => {
    it("should have bold code", () => {
      assertEquals(style.bold, `${CSI}1m`);
    });

    it("should have dim code", () => {
      assertEquals(style.dim, `${CSI}2m`);
    });

    it("should have italic code", () => {
      assertEquals(style.italic, `${CSI}3m`);
    });
  });

  describe("color functions", () => {
    it("should generate RGB foreground color", () => {
      assertEquals(fgRgb(255, 0, 128), `${CSI}38;2;255;0;128m`);
    });

    it("should generate RGB background color", () => {
      assertEquals(bgRgb(0, 255, 0), `${CSI}48;2;0;255;0m`);
    });

    it("should generate 256-color foreground", () => {
      assertEquals(fg256(196), `${CSI}38;5;196m`);
    });

    it("should generate 256-color background", () => {
      assertEquals(bg256(33), `${CSI}48;5;33m`);
    });

    it("should generate 16-color foreground", () => {
      assertEquals(fg16(1), `${CSI}31m`);
    });

    it("should generate 16-color background", () => {
      assertEquals(bg16(4), `${CSI}44m`);
    });
  });

  describe("ANSI_REGEX", () => {
    it("should match ANSI escape codes", () => {
      ANSI_REGEX.lastIndex = 0;
      assertEquals(ANSI_REGEX.test("\x1b[31m"), true);
    });

    it("should match bold code", () => {
      ANSI_REGEX.lastIndex = 0;
      assertEquals(ANSI_REGEX.test("\x1b[1m"), true);
    });

    it("should not match plain text", () => {
      ANSI_REGEX.lastIndex = 0;
      assertEquals(ANSI_REGEX.test("hello world"), false);
    });
  });

  describe("stripAnsi", () => {
    it("should strip ANSI codes from text", () => {
      assertEquals(stripAnsi("\x1b[31mhello\x1b[0m"), "hello");
    });

    it("should return plain text unchanged", () => {
      assertEquals(stripAnsi("hello"), "hello");
    });

    it("should strip multiple ANSI codes", () => {
      assertEquals(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m"), "bold red");
    });

    it("should handle empty string", () => {
      assertEquals(stripAnsi(""), "");
    });
  });

  describe("SPINNER_FRAMES", () => {
    it("should have 10 frames", () => {
      assertEquals(SPINNER_FRAMES.length, 10);
    });
  });

  describe("getSpinnerFrame", () => {
    it("should return first frame for index 0", () => {
      assertEquals(getSpinnerFrame(0), SPINNER_FRAMES[0]);
    });

    it("should wrap around at the end", () => {
      assertEquals(getSpinnerFrame(10), SPINNER_FRAMES[0]);
    });

    it("should return correct frame for index 5", () => {
      assertEquals(getSpinnerFrame(5), SPINNER_FRAMES[5]);
    });

    it("should handle large indices", () => {
      assertEquals(getSpinnerFrame(123), SPINNER_FRAMES[123 % 10]);
    });
  });
});
