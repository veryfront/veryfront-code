/**
 * Tests for Key Handler module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { handleKey } from "./key-handler.ts";
import {
  createAppState,
  updateAgents,
  updateCommandPalette,
  updateConfirmation,
  updateSearch,
} from "./app-state.ts";
import { setFiles, setTab } from "../components/views/project-detail.ts";

describe("handleKey - Global Keys", () => {
  it("handles Ctrl+C as quit", () => {
    const state = createAppState();
    const result = handleKey("\x03", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("quit");
  });

  it("handles Ctrl+P as open search", () => {
    const state = createAppState();
    const result = handleKey("\x10", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.search.open).toBe(true);
    expect(newState.mode).toBe("SEARCH");
  });

  it("handles Ctrl+A as open agent picker in normal mode", () => {
    const state = createAppState();
    const result = handleKey("\x01", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.agents.pickerOpen).toBe(true);
  });
});

describe("handleKey - Normal Mode", () => {
  it("handles q as quit", () => {
    const state = createAppState();
    const result = handleKey("q", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("quit");
  });

  it("handles : as open command palette", () => {
    const state = createAppState();
    const result = handleKey(":", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.commandPalette.open).toBe(true);
    expect(newState.mode).toBe("COMMAND");
  });

  it("handles / as open search", () => {
    const state = createAppState();
    const result = handleKey("/", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.search.open).toBe(true);
    expect(newState.mode).toBe("SEARCH");
  });

  it("handles ? as help", () => {
    const state = createAppState();
    const result = handleKey("?", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.view).toBe("help");
  });

  it("handles Escape to go back", () => {
    let state = createAppState();
    state = { ...state, navStack: [{ view: "dashboard" }, { view: "settings" }] };
    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.navStack.length).toBe(1);
  });

  it("handles Escape when at root", () => {
    const state = createAppState();
    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
  });

  it("handles n for new project", () => {
    const state = createAppState();
    const result = handleKey("n", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.view).toBe("new-project");
  });

  it("handles r for refresh", () => {
    const state = createAppState();
    const result = handleKey("r", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("refresh");
  });
});

describe("handleKey - Vim Navigation", () => {
  it("handles j for move down", () => {
    const state = createAppState();
    const result = handleKey("j", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles k for move up", () => {
    const state = createAppState();
    const result = handleKey("k", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });
});

describe("handleKey - Command Palette Modal", () => {
  it("handles Escape to close", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);

    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.commandPalette.open).toBe(false);
  });

  it("handles text input", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);

    const result = handleKey("d", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles Enter to execute", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({
      ...p,
      open: true,
      selectedIndex: 0,
      filtered: [{ id: "test", name: "Test", description: "Test command", category: "test" }],
    }))(state);

    const result = handleKey("\r", state);

    expect(result.handled).toBe(true);
  });
});

describe("handleKey - Search Modal", () => {
  it("handles Escape to close", () => {
    let state = createAppState();
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.search.open).toBe(false);
  });

  it("handles text input", () => {
    let state = createAppState();
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    const result = handleKey("a", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up/down navigation", () => {
    let state = createAppState();
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    const downResult = handleKey("\x1b[B", state);
    expect(downResult.handled).toBe(true);

    const upResult = handleKey("\x1b[A", state);
    expect(upResult.handled).toBe(true);
  });
});

describe("handleKey - Agent Picker Modal", () => {
  it("handles Escape to close", () => {
    let state = createAppState();
    state = updateAgents((a) => ({ ...a, pickerOpen: true }))(state);

    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.agents.pickerOpen).toBe(false);
  });

  it("handles up/down navigation", () => {
    let state = createAppState();
    state = updateAgents((a) => ({ ...a, pickerOpen: true }))(state);

    const downResult = handleKey("j", state);
    expect(downResult.handled).toBe(true);

    const upResult = handleKey("k", state);
    expect(upResult.handled).toBe(true);
  });
});

describe("handleKey - Confirmation Modal", () => {
  it("handles y for confirm", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({
      ...c,
      open: true,
      message: "Test?",
      selectedIndex: 0,
    }))(state);

    const result = handleKey("y", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("confirm");
    if (result.action?.type === "confirm") {
      expect(result.action.result).toBe(true);
    }
  });

  it("handles n for cancel", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({
      ...c,
      open: true,
      message: "Test?",
      selectedIndex: 0,
    }))(state);

    const result = handleKey("n", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("confirm");
    if (result.action?.type === "confirm") {
      expect(result.action.result).toBe(false);
    }
  });

  it("handles Escape for cancel", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({
      ...c,
      open: true,
      message: "Test?",
    }))(state);

    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("confirm");
    if (result.action?.type === "confirm") {
      expect(result.action.result).toBe(false);
    }
  });
});

describe("handleKey - Project Detail View", () => {
  it("handles Tab for next tab", () => {
    let state = createAppState();
    state = { ...state, view: "project-detail" };

    const result = handleKey("\t", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles number keys for tab selection", () => {
    let state = createAppState();
    state = { ...state, view: "project-detail" };

    const result = handleKey("2", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles o for open browser", () => {
    let state = createAppState();
    state = { ...state, view: "project-detail" };

    const result = handleKey("o", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("open-browser");
  });

  it("handles D for deploy", () => {
    let state = createAppState();
    state = { ...state, view: "project-detail" };

    const result = handleKey("D", state);

    expect(result.handled).toBe(true);
    expect(result.action?.type).toBe("deploy");
  });

  it("handles Enter to expand directory", () => {
    let state = createAppState();
    state = { ...state, view: "project-detail" };
    state = {
      ...state,
      projectDetail: setTab("files")(
        setFiles([
          { path: "src", name: "src", isDirectory: true, depth: 0 },
        ])(state.projectDetail),
      ),
    };

    const result = handleKey("\r", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });
});

describe("handleKey - Resources View", () => {
  it("handles Tab for next tab", () => {
    let state = createAppState();
    state = { ...state, view: "resources" };

    const result = handleKey("\t", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up/down navigation", () => {
    let state = createAppState();
    state = { ...state, view: "resources" };

    const downResult = handleKey("j", state);
    expect(downResult.handled).toBe(true);

    const upResult = handleKey("k", state);
    expect(upResult.handled).toBe(true);
  });

  it("handles Escape to go back", () => {
    let state = createAppState();
    // First navigate to resources so there's something to go back from
    state = {
      ...state,
      view: "resources",
      navStack: [{ view: "dashboard" }, { view: "resources" }],
    };

    const result = handleKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });
});

describe("handleKey - Mode-Specific Behavior", () => {
  it("passes through in INSERT mode", () => {
    let state = createAppState();
    state = { ...state, mode: "INSERT" };

    const result = handleKey("a", state);

    expect(result.handled).toBe(false);
  });

  it("opens command palette in COMMAND mode without modal", () => {
    let state = createAppState();
    state = { ...state, mode: "COMMAND" };

    const result = handleKey("a", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.commandPalette.open).toBe(true);
  });

  it("opens search in SEARCH mode without modal", () => {
    let state = createAppState();
    state = { ...state, mode: "SEARCH" };

    const result = handleKey("a", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();

    const newState = result.updater!(state);
    expect(newState.search.open).toBe(true);
  });
});

describe("handleKey - Action Types", () => {
  it("returns quit action", () => {
    const state = createAppState();
    const result = handleKey("q", state);

    expect(result.action).toEqual({ type: "quit" });
  });

  it("returns navigate action for help", () => {
    const state = createAppState();
    const result = handleKey("?", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("returns refresh action", () => {
    const state = createAppState();
    const result = handleKey("r", state);

    expect(result.action).toEqual({ type: "refresh" });
  });
});
