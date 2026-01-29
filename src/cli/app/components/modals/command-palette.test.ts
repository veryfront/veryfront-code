/**
 * Tests for command palette modal
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  closeCommandPalette,
  getSelectedCommand,
  handleCommandPaletteKey,
  moveSelectionDown,
  moveSelectionUp,
  openCommandPalette,
  renderCommandPalette,
  updateQuery,
} from "./command-palette.ts";
import { createCommandPaletteState } from "../../core/types.ts";
import { createRegistry } from "../../core/commands.ts";

describe("openCommandPalette", () => {
  it("opens palette with all commands", () => {
    const state = createCommandPaletteState();
    const result = openCommandPalette()(state);

    expect(result.open).toBe(true);
    expect(result.query).toBe("");
    expect(result.selectedIndex).toBe(0);
    expect(result.filteredCommands.length).toBeGreaterThan(0);
  });

  it("uses provided registry", () => {
    const custom = createRegistry([
      { id: "test", name: "Test", description: "Test", category: "utility" },
    ]);
    const state = createCommandPaletteState();
    const result = openCommandPalette(custom)(state);

    expect(result.filteredCommands.length).toBe(1);
    expect(result.filteredCommands[0]?.id).toBe("test");
  });
});

describe("closeCommandPalette", () => {
  it("resets state", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("dep")(state);

    const result = closeCommandPalette()(state);

    expect(result.open).toBe(false);
    expect(result.query).toBe("");
    expect(result.filteredCommands).toEqual([]);
  });
});

describe("updateQuery", () => {
  it("updates query and filters", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("dep")(state);

    expect(state.query).toBe("dep");
    expect(state.filteredCommands.length).toBeGreaterThan(0);
    expect(state.filteredCommands[0]?.name.toLowerCase()).toContain("deploy");
  });

  it("resets selection index", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = moveSelectionDown()(state);
    state = updateQuery("new")(state);

    expect(state.selectedIndex).toBe(0);
  });
});

describe("moveSelectionUp", () => {
  it("moves selection up", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = { ...state, selectedIndex: 2 };

    const result = moveSelectionUp()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("wraps to bottom", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = { ...state, selectedIndex: 0 };

    const result = moveSelectionUp()(state);
    expect(result.selectedIndex).toBe(state.filteredCommands.length - 1);
  });

  it("handles empty list", () => {
    const state = {
      open: true,
      query: "",
      selectedIndex: 0,
      filteredCommands: [],
    };

    const result = moveSelectionUp()(state);
    expect(result.selectedIndex).toBe(0);
  });
});

describe("moveSelectionDown", () => {
  it("moves selection down", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = moveSelectionDown()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("wraps to top", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = { ...state, selectedIndex: state.filteredCommands.length - 1 };

    const result = moveSelectionDown()(state);
    expect(result.selectedIndex).toBe(0);
  });
});

describe("getSelectedCommand", () => {
  it("returns selected command", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const cmd = getSelectedCommand(state);
    expect(cmd).toBeDefined();
    expect(cmd?.id).toBeDefined();
  });

  it("returns null for empty list", () => {
    const state = {
      open: true,
      query: "",
      selectedIndex: 0,
      filteredCommands: [],
    };

    expect(getSelectedCommand(state)).toBeNull();
  });
});

describe("renderCommandPalette", () => {
  it("returns empty when closed", () => {
    const state = createCommandPaletteState();
    expect(renderCommandPalette(state)).toBe("");
  });

  it("renders palette content", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = renderCommandPalette(state);

    expect(result).toContain(":"); // Input prefix
    expect(result).toContain("select");
    expect(result).toContain("Enter");
  });

  it("shows query in input", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("deploy")(state);

    const result = renderCommandPalette(state);
    expect(result).toContain("deploy");
  });

  it("shows no results message", () => {
    const state = {
      open: true,
      query: "xyz123",
      selectedIndex: 0,
      filteredCommands: [],
    };

    const result = renderCommandPalette(state);
    expect(result).toContain("No matching");
  });
});

describe("handleCommandPaletteKey", () => {
  it("returns not handled when closed", () => {
    const state = createCommandPaletteState();
    const result = handleCommandPaletteKey("a", state);
    expect(result.handled).toBe(false);
  });

  it("handles escape", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = handleCommandPaletteKey("\x1b", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
  });

  it("handles enter to execute", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = handleCommandPaletteKey("\r", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(result.executeCommand).toBeDefined();
  });

  it("handles tab for completion", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("de")(state);

    const result = handleCommandPaletteKey("\t", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up arrow", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = { ...state, selectedIndex: 2 };

    const result = handleCommandPaletteKey("\x1b[A", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles down arrow", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = handleCommandPaletteKey("\x1b[B", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles backspace", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("test")(state);

    const result = handleCommandPaletteKey("\x7f", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles Ctrl+U to clear", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);
    state = updateQuery("test")(state);

    const result = handleCommandPaletteKey("\x15", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles character input", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = handleCommandPaletteKey("d", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("consumes unhandled keys", () => {
    let state = createCommandPaletteState();
    state = openCommandPalette()(state);

    const result = handleCommandPaletteKey("\x1b[5~", state); // Page Up
    expect(result.handled).toBe(true);
    expect(result.close).toBe(false);
  });
});
