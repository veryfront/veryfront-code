/**
 * Tests for vim keybindings module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  addDigitToCount,
  applyNavToIndex,
  ARROW_KEYS,
  calculateScrollOffset,
  CHORD_PREFIX,
  CHORD_TIMEOUT,
  clearChord,
  CTRL_KEYS,
  getChordAction,
  getEffectiveCount,
  getNavAction,
  handleVimKey,
  isChordTimedOut,
  parseKey,
  setChordCount,
  startChord,
  VIM_KEYS,
} from "./keybindings.ts";
import { createKeyChordState } from "./types.ts";

describe("Key Constants", () => {
  it("defines vim keys", () => {
    expect(VIM_KEYS.UP).toBe("k");
    expect(VIM_KEYS.DOWN).toBe("j");
    expect(VIM_KEYS.LEFT).toBe("h");
    expect(VIM_KEYS.RIGHT).toBe("l");
  });

  it("defines arrow key sequences", () => {
    expect(ARROW_KEYS.UP).toBe("\x1b[A");
    expect(ARROW_KEYS.DOWN).toBe("\x1b[B");
    expect(ARROW_KEYS.LEFT).toBe("\x1b[D");
    expect(ARROW_KEYS.RIGHT).toBe("\x1b[C");
  });

  it("defines ctrl keys", () => {
    expect(CTRL_KEYS.D).toBe("\x04");
    expect(CTRL_KEYS.U).toBe("\x15");
    expect(CTRL_KEYS.C).toBe("\x03");
  });

  it("defines chord prefix", () => {
    expect(CHORD_PREFIX.GO_TO).toBe("g");
  });

  it("has reasonable chord timeout", () => {
    expect(CHORD_TIMEOUT).toBeGreaterThan(100);
    expect(CHORD_TIMEOUT).toBeLessThan(2000);
  });
});

describe("Chord State Management", () => {
  describe("startChord", () => {
    it("creates chord with prefix", () => {
      const state = startChord("g");
      expect(state.pending).toBe("g");
      expect(state.startTime).toBeDefined();
      expect(state.count).toBeNull();
    });
  });

  describe("setChordCount", () => {
    it("sets count on chord", () => {
      const state = startChord("g");
      const result = setChordCount(state, 5);
      expect(result.count).toBe(5);
      expect(result.pending).toBe("g");
    });
  });

  describe("addDigitToCount", () => {
    it("adds first digit", () => {
      const state = createKeyChordState();
      const result = addDigitToCount(state, 5);
      expect(result.count).toBe(5);
    });

    it("appends digit to existing count", () => {
      let state = createKeyChordState();
      state = addDigitToCount(state, 1);
      state = addDigitToCount(state, 2);
      expect(state.count).toBe(12);
    });

    it("builds multi-digit number", () => {
      let state = createKeyChordState();
      state = addDigitToCount(state, 1);
      state = addDigitToCount(state, 0);
      state = addDigitToCount(state, 0);
      expect(state.count).toBe(100);
    });
  });

  describe("clearChord", () => {
    it("resets all fields", () => {
      const state = clearChord();
      expect(state.pending).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.count).toBeNull();
    });
  });

  describe("isChordTimedOut", () => {
    it("returns false for no pending chord", () => {
      const state = createKeyChordState();
      expect(isChordTimedOut(state)).toBe(false);
    });

    it("returns false for recent chord", () => {
      const state = startChord("g");
      expect(isChordTimedOut(state)).toBe(false);
    });

    it("returns true for old chord", () => {
      const state = {
        pending: "g",
        startTime: Date.now() - CHORD_TIMEOUT - 100,
        count: null,
      };
      expect(isChordTimedOut(state)).toBe(true);
    });
  });

  describe("getEffectiveCount", () => {
    it("returns 1 for null count", () => {
      const state = createKeyChordState();
      expect(getEffectiveCount(state)).toBe(1);
    });

    it("returns actual count", () => {
      const state = setChordCount(createKeyChordState(), 5);
      expect(getEffectiveCount(state)).toBe(5);
    });
  });
});

describe("parseKey", () => {
  it("parses vim navigation keys", () => {
    expect(parseKey("j").key).toBe("j");
    expect(parseKey("k").key).toBe("k");
    expect(parseKey("h").key).toBe("h");
    expect(parseKey("l").key).toBe("l");
  });

  it("parses arrow keys", () => {
    expect(parseKey("\x1b[A").key).toBe("up");
    expect(parseKey("\x1b[A").isArrow).toBe(true);
    expect(parseKey("\x1b[B").key).toBe("down");
    expect(parseKey("\x1b[D").key).toBe("left");
    expect(parseKey("\x1b[C").key).toBe("right");
  });

  it("parses digits", () => {
    const result = parseKey("5");
    expect(result.isDigit).toBe(true);
    expect(result.digit).toBe(5);
  });

  it("parses zero as digit", () => {
    const result = parseKey("0");
    expect(result.isDigit).toBe(true);
    expect(result.digit).toBe(0);
  });

  it("parses Ctrl keys", () => {
    // Ctrl+D = \x04
    const resultD = parseKey("\x04");
    expect(resultD.ctrl).toBe(true);
    expect(resultD.key).toBe("d");

    // Ctrl+U = \x15
    const resultU = parseKey("\x15");
    expect(resultU.ctrl).toBe(true);
    expect(resultU.key).toBe("u");
  });

  it("detects uppercase keys", () => {
    const result = parseKey("G");
    expect(result.key).toBe("G");
    expect(result.shift).toBe(true);
  });

  it("handles regular lowercase", () => {
    const result = parseKey("g");
    expect(result.key).toBe("g");
    expect(result.shift).toBe(false);
    expect(result.ctrl).toBe(false);
  });
});

describe("getNavAction", () => {
  it("returns up action for k", () => {
    const parsed = parseKey("k");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("up");
    expect(action?.count).toBe(1);
  });

  it("returns down action for j", () => {
    const parsed = parseKey("j");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("down");
    expect(action?.count).toBe(1);
  });

  it("returns up action for arrow up", () => {
    const parsed = parseKey("\x1b[A");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("up");
  });

  it("returns page-down for Ctrl+D", () => {
    const parsed = parseKey("\x04");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("page-down");
  });

  it("returns page-up for Ctrl+U", () => {
    const parsed = parseKey("\x15");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("page-up");
  });

  it("returns bottom for G", () => {
    const parsed = parseKey("G");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action?.direction).toBe("bottom");
  });

  it("uses count from chord state", () => {
    const parsed = parseKey("j");
    const chord = setChordCount(createKeyChordState(), 5);
    const action = getNavAction(parsed, chord);

    expect(action?.count).toBe(5);
  });

  it("returns null for non-nav keys", () => {
    const parsed = parseKey("a");
    const chord = createKeyChordState();
    const action = getNavAction(parsed, chord);

    expect(action).toBeNull();
  });
});

describe("getChordAction", () => {
  it("returns top for gg", () => {
    const action = getChordAction("g", "g");
    expect(action).toEqual({ direction: "top", count: 1 });
  });

  it("returns go-to string for g+letter", () => {
    expect(getChordAction("g", "d")).toBe("go:d");
    expect(getChordAction("g", "s")).toBe("go:s");
    expect(getChordAction("g", "h")).toBe("go:h");
  });

  it("returns null for invalid chord", () => {
    expect(getChordAction("g", "G")).toBeNull(); // Capital
    expect(getChordAction("g", "1")).toBeNull(); // Digit
    expect(getChordAction("x", "y")).toBeNull(); // Not a chord
  });
});

describe("handleVimKey", () => {
  it("handles simple navigation", () => {
    const chord = createKeyChordState();
    const result = handleVimKey("j", chord);

    expect(result.navAction?.direction).toBe("down");
    expect(result.consumed).toBe(true);
    expect(result.chord.pending).toBeNull();
  });

  it("handles count prefix", () => {
    let chord = createKeyChordState();

    // Press 5
    const result1 = handleVimKey("5", chord);
    expect(result1.chord.count).toBe(5);
    expect(result1.consumed).toBe(true);
    chord = result1.chord;

    // Press j
    const result2 = handleVimKey("j", chord);
    expect(result2.navAction?.direction).toBe("down");
    expect(result2.navAction?.count).toBe(5);
  });

  it("handles g chord", () => {
    let chord = createKeyChordState();

    // Press g
    const result1 = handleVimKey("g", chord);
    expect(result1.chord.pending).toBe("g");
    expect(result1.consumed).toBe(true);
    chord = result1.chord;

    // Press g again for gg
    const result2 = handleVimKey("g", chord);
    expect(result2.navAction?.direction).toBe("top");
    expect(result2.chord.pending).toBeNull();
  });

  it("handles g+letter for go-to", () => {
    let chord = createKeyChordState();

    // Press g
    const result1 = handleVimKey("g", chord);
    chord = result1.chord;

    // Press d for go-to dashboard
    const result2 = handleVimKey("d", chord);
    expect(result2.stringAction).toBe("go:d");
    expect(result2.navAction).toBeNull();
  });

  it("clears timed out chord", () => {
    const oldChord = {
      pending: "g",
      startTime: Date.now() - CHORD_TIMEOUT - 100,
      count: null,
    };

    const result = handleVimKey("d", oldChord);
    // Should not interpret as go:d because chord timed out
    expect(result.stringAction).toBeNull();
  });

  it("returns consumed=false for unhandled keys", () => {
    const chord = createKeyChordState();
    const result = handleVimKey("x", chord);

    expect(result.consumed).toBe(false);
    expect(result.navAction).toBeNull();
    expect(result.stringAction).toBeNull();
  });
});

describe("applyNavToIndex", () => {
  it("moves down by count", () => {
    const result = applyNavToIndex({ direction: "down", count: 1 }, 0, 10);
    expect(result).toBe(1);
  });

  it("moves down by multiple", () => {
    const result = applyNavToIndex({ direction: "down", count: 3 }, 0, 10);
    expect(result).toBe(3);
  });

  it("wraps down at end", () => {
    const result = applyNavToIndex({ direction: "down", count: 1 }, 9, 10);
    expect(result).toBe(0);
  });

  it("wraps down with count", () => {
    const result = applyNavToIndex({ direction: "down", count: 3 }, 8, 10);
    expect(result).toBe(1);
  });

  it("moves up by count", () => {
    const result = applyNavToIndex({ direction: "up", count: 1 }, 5, 10);
    expect(result).toBe(4);
  });

  it("wraps up at start", () => {
    const result = applyNavToIndex({ direction: "up", count: 1 }, 0, 10);
    expect(result).toBe(9);
  });

  it("goes to top", () => {
    const result = applyNavToIndex({ direction: "top", count: 1 }, 5, 10);
    expect(result).toBe(0);
  });

  it("goes to bottom", () => {
    const result = applyNavToIndex({ direction: "bottom", count: 1 }, 5, 10);
    expect(result).toBe(9);
  });

  it("pages down", () => {
    const result = applyNavToIndex({ direction: "page-down", count: 1 }, 0, 100, 10);
    expect(result).toBe(10);
  });

  it("pages up", () => {
    const result = applyNavToIndex({ direction: "page-up", count: 1 }, 50, 100, 10);
    expect(result).toBe(40);
  });

  it("clamps page-down at end", () => {
    const result = applyNavToIndex({ direction: "page-down", count: 1 }, 95, 100, 10);
    expect(result).toBe(99);
  });

  it("clamps page-up at start", () => {
    const result = applyNavToIndex({ direction: "page-up", count: 1 }, 5, 100, 10);
    expect(result).toBe(0);
  });

  it("handles empty list", () => {
    const result = applyNavToIndex({ direction: "down", count: 1 }, 0, 0);
    expect(result).toBe(0);
  });
});

describe("calculateScrollOffset", () => {
  it("keeps offset when index visible", () => {
    const result = calculateScrollOffset(5, 0, 10, 20);
    expect(result).toBe(0);
  });

  it("scrolls up when index above visible", () => {
    const result = calculateScrollOffset(2, 5, 10, 20);
    expect(result).toBe(2);
  });

  it("scrolls down when index below visible", () => {
    const result = calculateScrollOffset(15, 5, 10, 20);
    expect(result).toBe(6);
  });

  it("handles edge case at end of list", () => {
    const result = calculateScrollOffset(19, 5, 10, 20);
    expect(result).toBe(10); // Max offset to show last items
  });
});
