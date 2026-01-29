/**
 * Tests for agent picker modal
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  closeAgentPicker,
  handleAgentPickerKey,
  movePickerSelection,
  openAgentPicker,
  renderAgentPicker,
  selectCurrentAgent,
} from "./agent-picker.ts";
import { createAgentRegistry, initAgentState } from "../../core/agents.ts";

describe("openAgentPicker", () => {
  it("opens picker", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    expect(state.pickerOpen).toBe(true);
    expect(state.pickerIndex).toBe(0);
  });
});

describe("closeAgentPicker", () => {
  it("closes picker", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = closeAgentPicker()(state);

    expect(state.pickerOpen).toBe(false);
  });
});

describe("movePickerSelection", () => {
  it("moves down", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = movePickerSelection(1)(state);

    expect(state.pickerIndex).toBe(1);
  });

  it("moves up", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = { ...state, pickerIndex: 2 };
    state = movePickerSelection(-1)(state);

    expect(state.pickerIndex).toBe(1);
  });

  it("wraps at end", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = { ...state, pickerIndex: state.agents.length - 1 };
    state = movePickerSelection(1)(state);

    expect(state.pickerIndex).toBe(0);
  });

  it("wraps at start", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = movePickerSelection(-1)(state);

    expect(state.pickerIndex).toBe(state.agents.length - 1);
  });
});

describe("selectCurrentAgent", () => {
  it("sets active agent", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = selectCurrentAgent(state)(state);

    expect(state.activeAgent?.id).toBe(state.agents[0]?.id);
  });

  it("sets active agent at different index", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = { ...state, pickerIndex: 1 };
    state = selectCurrentAgent(state)(state);

    expect(state.activeAgent?.id).toBe(state.agents[1]?.id);
  });
});

describe("renderAgentPicker", () => {
  it("returns empty when closed", () => {
    const registry = createAgentRegistry();
    const state = initAgentState(registry);

    expect(renderAgentPicker(state)).toBe("");
  });

  it("renders picker content", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = renderAgentPicker(state);

    expect(result).toContain("Launch Coding Agent");
    expect(result).toContain("CLI Agents");
    expect(result).toContain("Claude Code");
  });

  it("shows installed status", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry, ["claude"]);
    state = openAgentPicker()(state);

    const result = renderAgentPicker(state);

    expect(result).toContain("installed");
  });

  it("shows active agent", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry, ["claude"]);
    state = openAgentPicker()(state);
    state = selectCurrentAgent(state)(state);
    // Need to reopen picker after setting active
    state = { ...state, pickerOpen: true };

    const result = renderAgentPicker(state);

    expect(result).toContain("active");
  });

  it("shows IDE agents section", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = renderAgentPicker(state);

    expect(result).toContain("IDE Agents");
    expect(result).toContain("Cursor");
  });

  it("shows add custom option", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = renderAgentPicker(state);

    expect(result).toContain("Add custom agent");
  });
});

describe("handleAgentPickerKey", () => {
  it("returns not handled when closed", () => {
    const registry = createAgentRegistry();
    const state = initAgentState(registry);

    const result = handleAgentPickerKey("j", state);
    expect(result.handled).toBe(false);
  });

  it("handles escape to close", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles enter to launch", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("\r", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(result.launchAgent).toBeDefined();
    expect(result.updater).toBeDefined();
  });

  it("handles j to move down", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("j", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles k to move up", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = { ...state, pickerIndex: 1 };

    const result = handleAgentPickerKey("k", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up arrow", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = { ...state, pickerIndex: 1 };

    const result = handleAgentPickerKey("\x1b[A", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles down arrow", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("\x1b[B", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles number keys for quick select", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("1", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(result.launchAgent).toBeDefined();
  });

  it("consumes unhandled keys", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    const result = handleAgentPickerKey("x", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(false);
  });
});
