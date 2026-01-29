/**
 * Tests for single select component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createSingleSelect,
  getSelectedOption,
  getSelectedValue,
  handleSingleSelectKey,
  moveDown,
  moveUp,
  renderSingleSelect,
  SelectOptionSchema,
  SingleSelectStateSchema as _SingleSelectStateSchema,
} from "./single-select.ts";

describe("SelectOptionSchema", () => {
  it("validates full option", () => {
    const result = SelectOptionSchema.parse({
      value: "opt1",
      label: "Option 1",
      description: "First option",
      disabled: false,
    });

    expect(result.value).toBe("opt1");
    expect(result.description).toBe("First option");
  });

  it("validates minimal option", () => {
    const result = SelectOptionSchema.parse({
      value: "opt1",
      label: "Option 1",
    });

    expect(result.value).toBe("opt1");
    expect(result.description).toBeUndefined();
  });
});

describe("createSingleSelect", () => {
  it("creates state with defaults", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    expect(state.prompt).toBe("Choose:");
    expect(state.options.length).toBe(2);
    expect(state.selectedIndex).toBe(0);
  });

  it("respects default index", () => {
    const state = createSingleSelect(
      "Choose:",
      [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      1,
    );

    expect(state.selectedIndex).toBe(1);
  });

  it("clamps default index to valid range", () => {
    const state = createSingleSelect(
      "Choose:",
      [{ value: "a", label: "A" }],
      5,
    );

    expect(state.selectedIndex).toBe(0);
  });
});

describe("moveUp", () => {
  it("moves up", () => {
    let state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    state = { ...state, selectedIndex: 1 };

    state = moveUp()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps to bottom", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    const result = moveUp()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("skips disabled options", () => {
    let state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true },
      { value: "c", label: "C" },
    ]);
    state = { ...state, selectedIndex: 2 };

    state = moveUp()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("handles empty list", () => {
    const state = createSingleSelect("Choose:", []);
    const result = moveUp()(state);
    expect(result.selectedIndex).toBe(-1);
  });
});

describe("moveDown", () => {
  it("moves down", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    const result = moveDown()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("wraps to top", () => {
    let state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    state = { ...state, selectedIndex: 1 };

    state = moveDown()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("skips disabled options", () => {
    let state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true },
      { value: "c", label: "C" },
    ]);

    state = moveDown()(state);
    expect(state.selectedIndex).toBe(2);
  });
});

describe("getSelectedValue", () => {
  it("returns selected value", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    expect(getSelectedValue(state)).toBe("a");
  });

  it("returns null for disabled option", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A", disabled: true },
    ]);

    expect(getSelectedValue(state)).toBeNull();
  });

  it("returns null for empty list", () => {
    const state = createSingleSelect("Choose:", []);
    expect(getSelectedValue(state)).toBeNull();
  });
});

describe("getSelectedOption", () => {
  it("returns selected option", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
    ]);

    const option = getSelectedOption(state);
    expect(option?.value).toBe("a");
    expect(option?.label).toBe("A");
  });
});

describe("renderSingleSelect", () => {
  it("renders prompt and options", () => {
    const state = createSingleSelect("Choose template:", [
      { value: "ai", label: "AI", description: "AI-powered app" },
      { value: "app", label: "App", description: "Standard app" },
    ]);

    const result = renderSingleSelect(state);

    expect(result).toContain("Choose template:");
    expect(result).toContain("AI");
    expect(result).toContain("AI-powered app");
    expect(result).toContain("App");
    expect(result).toContain("↑↓ to select");
  });

  it("shows selection indicator", () => {
    const state = createSingleSelect("Choose:", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);

    const result = renderSingleSelect(state);
    expect(result).toContain("›"); // Selection indicator
  });
});

describe("handleSingleSelectKey", () => {
  it("handles up arrow", () => {
    const result = handleSingleSelectKey("\x1b[A");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles k for up", () => {
    const result = handleSingleSelectKey("k");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles down arrow", () => {
    const result = handleSingleSelectKey("\x1b[B");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles j for down", () => {
    const result = handleSingleSelectKey("j");
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles enter to confirm", () => {
    const result = handleSingleSelectKey("\r");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  it("handles escape to cancel", () => {
    const result = handleSingleSelectKey("\x1b");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it("consumes other keys", () => {
    const result = handleSingleSelectKey("x");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.cancelled).toBe(false);
  });
});
