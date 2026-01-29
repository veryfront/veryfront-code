/**
 * Tests for mode system module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  canTransition,
  COMMAND_KEY,
  enterCommand,
  enterInsert,
  enterSearch,
  ESCAPE_KEY,
  exitMode,
  exitToNormal,
  getModeDisplay,
  getModeFromKey,
  getModeIndicator,
  handleModeKey,
  MODE_COLORS,
  MODE_LABELS,
  SEARCH_CTRL_KEY,
  SEARCH_KEY,
  setMode,
  shouldExitMode,
  transition,
  transitionMode,
} from "./mode.ts";
import type { Mode } from "./types.ts";

describe("canTransition", () => {
  it("allows NORMAL to COMMAND", () => {
    expect(canTransition("NORMAL", "COMMAND")).toBe(true);
  });

  it("allows NORMAL to SEARCH", () => {
    expect(canTransition("NORMAL", "SEARCH")).toBe(true);
  });

  it("allows NORMAL to INSERT", () => {
    expect(canTransition("NORMAL", "INSERT")).toBe(true);
  });

  it("allows COMMAND to NORMAL", () => {
    expect(canTransition("COMMAND", "NORMAL")).toBe(true);
  });

  it("allows SEARCH to NORMAL", () => {
    expect(canTransition("SEARCH", "NORMAL")).toBe(true);
  });

  it("allows INSERT to NORMAL", () => {
    expect(canTransition("INSERT", "NORMAL")).toBe(true);
  });

  it("disallows COMMAND to SEARCH", () => {
    expect(canTransition("COMMAND", "SEARCH")).toBe(false);
  });

  it("disallows SEARCH to COMMAND", () => {
    expect(canTransition("SEARCH", "COMMAND")).toBe(false);
  });

  it("disallows INSERT to COMMAND", () => {
    expect(canTransition("INSERT", "COMMAND")).toBe(false);
  });

  it("allows same-mode transition", () => {
    expect(canTransition("NORMAL", "NORMAL")).toBe(true);
    expect(canTransition("COMMAND", "COMMAND")).toBe(true);
  });
});

describe("transition", () => {
  it("transitions to valid target", () => {
    expect(transition("NORMAL", "COMMAND")).toBe("COMMAND");
    expect(transition("COMMAND", "NORMAL")).toBe("NORMAL");
  });

  it("stays in current mode for invalid transition", () => {
    expect(transition("COMMAND", "SEARCH")).toBe("COMMAND");
    expect(transition("SEARCH", "INSERT")).toBe("SEARCH");
  });
});

describe("exitToNormal", () => {
  it("returns NORMAL", () => {
    expect(exitToNormal()).toBe("NORMAL");
  });
});

describe("enterCommand", () => {
  it("enters COMMAND from NORMAL", () => {
    expect(enterCommand("NORMAL")).toBe("COMMAND");
  });

  it("stays in current mode if invalid", () => {
    expect(enterCommand("SEARCH")).toBe("SEARCH");
  });
});

describe("enterSearch", () => {
  it("enters SEARCH from NORMAL", () => {
    expect(enterSearch("NORMAL")).toBe("SEARCH");
  });

  it("stays in current mode if invalid", () => {
    expect(enterSearch("COMMAND")).toBe("COMMAND");
  });
});

describe("enterInsert", () => {
  it("enters INSERT from NORMAL", () => {
    expect(enterInsert("NORMAL")).toBe("INSERT");
  });

  it("stays in current mode if invalid", () => {
    expect(enterInsert("COMMAND")).toBe("COMMAND");
  });
});

describe("Key Constants", () => {
  it("COMMAND_KEY is colon", () => {
    expect(COMMAND_KEY).toBe(":");
  });

  it("SEARCH_KEY is slash", () => {
    expect(SEARCH_KEY).toBe("/");
  });

  it("SEARCH_CTRL_KEY is p", () => {
    expect(SEARCH_CTRL_KEY).toBe("p");
  });

  it("ESCAPE_KEY is escape character", () => {
    expect(ESCAPE_KEY).toBe("\x1b");
  });
});

describe("getModeFromKey", () => {
  it("returns COMMAND for colon", () => {
    expect(getModeFromKey(":", false)).toBe("COMMAND");
  });

  it("returns SEARCH for slash", () => {
    expect(getModeFromKey("/", false)).toBe("SEARCH");
  });

  it("returns SEARCH for Ctrl+P", () => {
    expect(getModeFromKey("p", true)).toBe("SEARCH");
    expect(getModeFromKey("P", true)).toBe("SEARCH");
  });

  it("returns NORMAL for escape", () => {
    expect(getModeFromKey("\x1b", false)).toBe("NORMAL");
  });

  it("returns null for other keys", () => {
    expect(getModeFromKey("a", false)).toBeNull();
    expect(getModeFromKey("j", false)).toBeNull();
    expect(getModeFromKey("Enter", false)).toBeNull();
  });

  it("does not trigger search for p without Ctrl", () => {
    expect(getModeFromKey("p", false)).toBeNull();
  });
});

describe("shouldExitMode", () => {
  it("returns false in NORMAL mode", () => {
    expect(shouldExitMode("\x1b", "NORMAL")).toBe(false);
    expect(shouldExitMode(":", "NORMAL")).toBe(false);
  });

  it("returns true for escape in COMMAND mode", () => {
    expect(shouldExitMode("\x1b", "COMMAND")).toBe(true);
  });

  it("returns true for escape in SEARCH mode", () => {
    expect(shouldExitMode("\x1b", "SEARCH")).toBe(true);
  });

  it("returns true for escape in INSERT mode", () => {
    expect(shouldExitMode("\x1b", "INSERT")).toBe(true);
  });

  it("returns false for non-escape keys", () => {
    expect(shouldExitMode("a", "COMMAND")).toBe(false);
    expect(shouldExitMode(":", "SEARCH")).toBe(false);
  });
});

describe("MODE_LABELS", () => {
  it("has labels for all modes", () => {
    expect(MODE_LABELS.NORMAL).toBe("NORMAL");
    expect(MODE_LABELS.COMMAND).toBe("COMMAND");
    expect(MODE_LABELS.SEARCH).toBe("SEARCH");
    expect(MODE_LABELS.INSERT).toBe("INSERT");
  });
});

describe("MODE_COLORS", () => {
  it("has ANSI colors for all modes", () => {
    expect(MODE_COLORS.NORMAL).toContain("\x1b[");
    expect(MODE_COLORS.COMMAND).toContain("\x1b[");
    expect(MODE_COLORS.SEARCH).toContain("\x1b[");
    expect(MODE_COLORS.INSERT).toContain("\x1b[");
  });
});

describe("getModeIndicator", () => {
  it("returns colored label for NORMAL", () => {
    const result = getModeIndicator("NORMAL");
    expect(result).toContain("NORMAL");
    expect(result).toContain("\x1b["); // Has color
    expect(result).toContain("\x1b[0m"); // Has reset
  });

  it("returns colored label for COMMAND", () => {
    const result = getModeIndicator("COMMAND");
    expect(result).toContain("COMMAND");
  });
});

describe("getModeDisplay", () => {
  it("returns colon for COMMAND", () => {
    expect(getModeDisplay("COMMAND")).toBe(":");
  });

  it("returns slash for SEARCH", () => {
    expect(getModeDisplay("SEARCH")).toBe("/");
  });

  it("returns arrow for INSERT", () => {
    expect(getModeDisplay("INSERT")).toBe(">");
  });

  it("returns empty for NORMAL", () => {
    expect(getModeDisplay("NORMAL")).toBe("");
  });
});

// State updater tests
interface TestState {
  mode: Mode;
  other: string;
}

describe("setMode", () => {
  it("sets mode directly", () => {
    const state: TestState = { mode: "NORMAL", other: "test" };
    const result = setMode<TestState>("COMMAND")(state);

    expect(result.mode).toBe("COMMAND");
    expect(result.other).toBe("test");
  });
});

describe("transitionMode", () => {
  it("transitions to valid mode", () => {
    const state: TestState = { mode: "NORMAL", other: "test" };
    const result = transitionMode<TestState>("COMMAND")(state);

    expect(result.mode).toBe("COMMAND");
  });

  it("stays in current mode for invalid transition", () => {
    const state: TestState = { mode: "COMMAND", other: "test" };
    const result = transitionMode<TestState>("SEARCH")(state);

    expect(result.mode).toBe("COMMAND");
  });
});

describe("exitMode", () => {
  it("returns to NORMAL mode", () => {
    const state: TestState = { mode: "COMMAND", other: "test" };
    const result = exitMode<TestState>()(state);

    expect(result.mode).toBe("NORMAL");
  });

  it("preserves other state", () => {
    const state: TestState = { mode: "SEARCH", other: "data" };
    const result = exitMode<TestState>()(state);

    expect(result.other).toBe("data");
  });
});

describe("handleModeKey", () => {
  it("returns updater for mode-changing keys", () => {
    const updater = handleModeKey<TestState>(":", false);
    expect(updater).not.toBeNull();

    const state: TestState = { mode: "NORMAL", other: "test" };
    const result = updater!(state);
    expect(result.mode).toBe("COMMAND");
  });

  it("returns null for non-mode keys", () => {
    const updater = handleModeKey<TestState>("a", false);
    expect(updater).toBeNull();
  });

  it("handles Ctrl+P for search", () => {
    const updater = handleModeKey<TestState>("p", true);
    expect(updater).not.toBeNull();

    const state: TestState = { mode: "NORMAL", other: "test" };
    const result = updater!(state);
    expect(result.mode).toBe("SEARCH");
  });

  it("handles escape to exit mode", () => {
    const updater = handleModeKey<TestState>("\x1b", false);
    expect(updater).not.toBeNull();

    const state: TestState = { mode: "COMMAND", other: "test" };
    const result = updater!(state);
    expect(result.mode).toBe("NORMAL");
  });
});
