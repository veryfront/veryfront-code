/**
 * Tests for multi select component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  clearAll,
  createMultiSelect,
  getSelectedOptions,
  getSelectedValues,
  handleMultiSelectKey,
  isSelected,
  moveCursorDown,
  moveCursorUp,
  MultiSelectStateSchema,
  renderMultiSelect,
  selectAll,
  toggleSelection,
} from "./multi-select.ts";

describe("MultiSelectStateSchema", () => {
  it("validates state", () => {
    const result = MultiSelectStateSchema.parse({
      options: [{ value: "a", label: "A" }],
      cursorIndex: 0,
      selected: new Set(["a"]),
      prompt: "Choose:",
    });

    expect(result.prompt).toBe("Choose:");
    expect(result.selected.has("a")).toBe(true);
  });
});

describe("createMultiSelect", () => {
  it("creates state with defaults", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    expect(state.prompt).toBe("Choose:");
    expect(state.cursorIndex).toBe(0);
    expect(state.selected.size).toBe(0);
  });

  it("respects preselected values", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      ["b"],
    );

    expect(state.selected.has("b")).toBe(true);
    expect(state.selected.has("a")).toBe(false);
  });
});

describe("moveCursorUp", () => {
  it("moves up", () => {
    let state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    state = { ...state, cursorIndex: 1 };

    state = moveCursorUp()(state);
    expect(state.cursorIndex).toBe(0);
  });

  it("wraps to bottom", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    const result = moveCursorUp()(state);
    expect(result.cursorIndex).toBe(1);
  });
});

describe("moveCursorDown", () => {
  it("moves down", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    const result = moveCursorDown()(state);
    expect(result.cursorIndex).toBe(1);
  });

  it("wraps to top", () => {
    let state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    state = { ...state, cursorIndex: 1 };

    state = moveCursorDown()(state);
    expect(state.cursorIndex).toBe(0);
  });
});

describe("toggleSelection", () => {
  it("selects unselected", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
    ]);

    const result = toggleSelection()(state);
    expect(result.selected.has("a")).toBe(true);
  });

  it("deselects selected", () => {
    const state = createMultiSelect("Choose:", [{ value: "a", label: "A" }], ["a"]);

    const result = toggleSelection()(state);
    expect(result.selected.has("a")).toBe(false);
  });

  it("ignores disabled options", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A", disabled: true },
    ]);

    const result = toggleSelection()(state);
    expect(result.selected.has("a")).toBe(false);
  });
});

describe("selectAll", () => {
  it("selects all enabled options", () => {
    const state = createMultiSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true },
      { value: "c", label: "C" },
    ]);

    const result = selectAll()(state);

    expect(result.selected.has("a")).toBe(true);
    expect(result.selected.has("b")).toBe(false);
    expect(result.selected.has("c")).toBe(true);
  });
});

describe("clearAll", () => {
  it("clears all selections", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      ["a", "b"],
    );

    const result = clearAll()(state);
    expect(result.selected.size).toBe(0);
  });
});

describe("getSelectedValues", () => {
  it("returns selected values", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      ["a"],
    );

    const values = getSelectedValues(state);
    expect(values).toContain("a");
    expect(values).not.toContain("b");
  });
});

describe("getSelectedOptions", () => {
  it("returns selected options", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      ["a"],
    );

    const options = getSelectedOptions(state);
    expect(options.length).toBe(1);
    expect(options[0]?.value).toBe("a");
  });
});

describe("isSelected", () => {
  it("returns true for selected", () => {
    const state = createMultiSelect("Choose:", [{ value: "a", label: "A" }], ["a"]);
    expect(isSelected(state, "a")).toBe(true);
  });

  it("returns false for unselected", () => {
    const state = createMultiSelect("Choose:", [{ value: "a", label: "A" }]);
    expect(isSelected(state, "a")).toBe(false);
  });
});

describe("renderMultiSelect", () => {
  it("renders prompt and options", () => {
    const state = createMultiSelect("Which integrations?", [
      { value: "gmail", label: "Gmail", description: "Read and send emails" },
      { value: "slack", label: "Slack", description: "Send messages" },
    ]);

    const result = renderMultiSelect(state);

    expect(result).toContain("Which integrations?");
    expect(result).toContain("Gmail");
    expect(result).toContain("Slack");
    expect(result).toContain("Space to toggle");
  });

  it("shows selection count", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      ["a"],
    );

    const result = renderMultiSelect(state);
    expect(result).toContain("1 of 2 selected");
  });

  it("shows checkboxes", () => {
    const state = createMultiSelect(
      "Choose:",
      [{ value: "a", label: "A" }],
      ["a"],
    );

    const result = renderMultiSelect(state);
    expect(result).toContain("◉"); // Checked
  });
});

describe("handleMultiSelectKey", () => {
  it("handles up arrow", () => {
    const result = handleMultiSelectKey("\x1b[A");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles down arrow", () => {
    const result = handleMultiSelectKey("\x1b[B");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles space to toggle", () => {
    const result = handleMultiSelectKey(" ");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles Ctrl+A to select all", () => {
    const result = handleMultiSelectKey("\x01");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles enter to confirm", () => {
    const result = handleMultiSelectKey("\r");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("handles escape to cancel", () => {
    const result = handleMultiSelectKey("\x1b");
    expect(result.handled).toBe(true);
    expect(result.cancelled).toBe(true);
  });
});
