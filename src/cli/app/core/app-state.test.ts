/**
 * Tests for App State module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  AppStateSchema,
  closeAllModals,
  compose,
  createAppState,
  getActiveModal,
  goBack,
  isModalOpen,
  setMode,
  setTermSize,
  setView,
  toggleDebug,
  updateAgents,
  updateCommandPalette,
  updateConfig,
  updateConfirmation,
  updateHeader,
  updateKeyChord,
  updateProjectDetail,
  updateResourceViewer,
  updateSearch,
} from "./app-state.ts";

describe("AppStateSchema", () => {
  it("validates app state", () => {
    const state = createAppState();
    const result = AppStateSchema.safeParse(state);

    expect(result.success).toBe(true);
  });
});

describe("createAppState", () => {
  it("creates initial state", () => {
    const state = createAppState();

    expect(state.mode).toBe("NORMAL");
    expect(state.view).toBe("dashboard");
    expect(state.navStack).toEqual([{ view: "dashboard" }]);
    expect(state.debug).toBe(false);
    expect(state.termSize).toEqual({ width: 80, height: 24 });
  });

  it("creates with all substates initialized", () => {
    const state = createAppState();

    expect(state.keyChord).toBeDefined();
    expect(state.header).toBeDefined();
    expect(state.commandPalette).toBeDefined();
    expect(state.search).toBeDefined();
    expect(state.agents).toBeDefined();
    expect(state.confirmation).toBeDefined();
    expect(state.resourceViewer).toBeDefined();
    expect(state.projectDetail).toBeDefined();
    expect(state.config).toBeDefined();
  });
});

describe("setMode", () => {
  it("sets mode to NORMAL", () => {
    let state = createAppState();
    state = setMode("COMMAND")(state);
    state = setMode("NORMAL")(state);

    expect(state.mode).toBe("NORMAL");
  });

  it("sets mode to COMMAND", () => {
    let state = createAppState();
    state = setMode("COMMAND")(state);

    expect(state.mode).toBe("COMMAND");
  });

  it("sets mode to SEARCH", () => {
    let state = createAppState();
    state = setMode("SEARCH")(state);

    expect(state.mode).toBe("SEARCH");
  });

  it("sets mode to INSERT", () => {
    let state = createAppState();
    state = setMode("INSERT")(state);

    expect(state.mode).toBe("INSERT");
  });
});

describe("setView", () => {
  it("sets view", () => {
    let state = createAppState();
    state = setView("settings")(state);

    expect(state.view).toBe("settings");
  });

  it("pushes to nav stack", () => {
    let state = createAppState();
    state = setView("settings")(state);

    expect(state.navStack.length).toBe(2);
    expect(state.navStack[1]).toEqual({ view: "settings" });
  });

  it("supports all views", () => {
    const views = [
      "dashboard",
      "project-detail",
      "resources",
      "settings",
      "new-project",
      "templates",
      "examples",
      "auth",
      "help",
    ] as const;

    for (const view of views) {
      let state = createAppState();
      state = setView(view)(state);
      expect(state.view).toBe(view);
    }
  });
});

describe("goBack", () => {
  it("pops from nav stack", () => {
    let state = createAppState();
    state = setView("settings")(state);
    state = setView("help")(state);
    state = goBack()(state);

    expect(state.view).toBe("settings");
    expect(state.navStack.length).toBe(2);
  });

  it("does nothing at root", () => {
    let state = createAppState();
    state = goBack()(state);

    expect(state.view).toBe("dashboard");
    expect(state.navStack.length).toBe(1);
  });

  it("returns to dashboard when stack is empty", () => {
    let state = createAppState();
    state = setView("settings")(state);
    state = goBack()(state);

    expect(state.view).toBe("dashboard");
  });
});

describe("setTermSize", () => {
  it("sets terminal dimensions", () => {
    let state = createAppState();
    state = setTermSize(120, 40)(state);

    expect(state.termSize).toEqual({ width: 120, height: 40 });
  });
});

describe("toggleDebug", () => {
  it("toggles debug mode on", () => {
    let state = createAppState();
    state = toggleDebug()(state);

    expect(state.debug).toBe(true);
  });

  it("toggles debug mode off", () => {
    let state = createAppState();
    state = toggleDebug()(state);
    state = toggleDebug()(state);

    expect(state.debug).toBe(false);
  });
});

describe("updateHeader", () => {
  it("updates header state", () => {
    let state = createAppState();
    state = updateHeader((h) => ({
      ...h,
      status: "running",
    }))(state);

    expect(state.header.status).toBe("running");
  });
});

describe("updateCommandPalette", () => {
  it("updates command palette state", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({
      ...p,
      open: true,
    }))(state);

    expect(state.commandPalette.open).toBe(true);
  });
});

describe("updateSearch", () => {
  it("updates search state", () => {
    let state = createAppState();
    state = updateSearch((s) => ({
      ...s,
      open: true,
    }))(state);

    expect(state.search.open).toBe(true);
  });
});

describe("updateAgents", () => {
  it("updates agents state", () => {
    let state = createAppState();
    state = updateAgents((a) => ({
      ...a,
      pickerOpen: true,
    }))(state);

    expect(state.agents.pickerOpen).toBe(true);
  });
});

describe("updateConfirmation", () => {
  it("updates confirmation state", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({
      ...c,
      open: true,
    }))(state);

    expect(state.confirmation.open).toBe(true);
  });
});

describe("updateResourceViewer", () => {
  it("updates resource viewer state", () => {
    let state = createAppState();
    state = updateResourceViewer((r) => ({
      ...r,
      activeTab: "routes",
    }))(state);

    expect(state.resourceViewer.activeTab).toBe("routes");
  });
});

describe("updateProjectDetail", () => {
  it("updates project detail state", () => {
    let state = createAppState();
    state = updateProjectDetail((p) => ({
      ...p,
      activeTab: "files",
    }))(state);

    expect(state.projectDetail.activeTab).toBe("files");
  });
});

describe("updateConfig", () => {
  it("updates config state", () => {
    let state = createAppState();
    state = updateConfig((c) => ({
      ...c,
      preferences: {
        ...c.preferences,
        defaultAgent: "codex",
      },
    }))(state);

    expect(state.config.preferences.defaultAgent).toBe("codex");
  });
});

describe("updateKeyChord", () => {
  it("updates key chord state", () => {
    let state = createAppState();
    state = updateKeyChord((k) => ({
      ...k,
      pending: "g",
      startTime: Date.now(),
    }))(state);

    expect(state.keyChord.pending).toBe("g");
    expect(state.keyChord.startTime).not.toBeNull();
  });
});

describe("isModalOpen", () => {
  it("returns false when no modal is open", () => {
    const state = createAppState();

    expect(isModalOpen(state)).toBe(false);
  });

  it("returns true when command palette is open", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);

    expect(isModalOpen(state)).toBe(true);
  });

  it("returns true when search is open", () => {
    let state = createAppState();
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    expect(isModalOpen(state)).toBe(true);
  });

  it("returns true when agent picker is open", () => {
    let state = createAppState();
    state = updateAgents((a) => ({ ...a, pickerOpen: true }))(state);

    expect(isModalOpen(state)).toBe(true);
  });

  it("returns true when confirmation is open", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({ ...c, open: true }))(state);

    expect(isModalOpen(state)).toBe(true);
  });
});

describe("getActiveModal", () => {
  it("returns null when no modal is open", () => {
    const state = createAppState();

    expect(getActiveModal(state)).toBeNull();
  });

  it("returns command when command palette is open", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);

    expect(getActiveModal(state)).toBe("command");
  });

  it("returns search when search is open", () => {
    let state = createAppState();
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    expect(getActiveModal(state)).toBe("search");
  });

  it("returns agent when agent picker is open", () => {
    let state = createAppState();
    state = updateAgents((a) => ({ ...a, pickerOpen: true }))(state);

    expect(getActiveModal(state)).toBe("agent");
  });

  it("returns confirmation when confirmation is open", () => {
    let state = createAppState();
    state = updateConfirmation((c) => ({ ...c, open: true }))(state);

    expect(getActiveModal(state)).toBe("confirmation");
  });

  it("prioritizes command palette over other modals", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);
    state = updateSearch((s) => ({ ...s, open: true }))(state);

    expect(getActiveModal(state)).toBe("command");
  });
});

describe("closeAllModals", () => {
  it("closes all modals", () => {
    let state = createAppState();
    state = updateCommandPalette((p) => ({ ...p, open: true }))(state);
    state = updateSearch((s) => ({ ...s, open: true }))(state);
    state = updateAgents((a) => ({ ...a, pickerOpen: true }))(state);
    state = updateConfirmation((c) => ({ ...c, open: true }))(state);
    state = closeAllModals()(state);

    expect(state.commandPalette.open).toBe(false);
    expect(state.search.open).toBe(false);
    expect(state.agents.pickerOpen).toBe(false);
    expect(state.confirmation.open).toBe(false);
  });

  it("resets mode to NORMAL", () => {
    let state = createAppState();
    state = setMode("COMMAND")(state);
    state = closeAllModals()(state);

    expect(state.mode).toBe("NORMAL");
  });
});

describe("compose", () => {
  it("composes multiple updaters", () => {
    let state = createAppState();
    state = compose(
      setMode("COMMAND"),
      setView("settings"),
      toggleDebug(),
    )(state);

    expect(state.mode).toBe("COMMAND");
    expect(state.view).toBe("settings");
    expect(state.debug).toBe(true);
  });

  it("applies updaters in order", () => {
    let state = createAppState();
    state = compose(
      setView("settings"),
      setView("help"),
      setView("auth"),
    )(state);

    expect(state.view).toBe("auth");
    expect(state.navStack.length).toBe(4);
  });

  it("handles empty updaters", () => {
    const state = createAppState();
    const result = compose()(state);

    expect(result).toEqual(state);
  });

  it("handles single updater", () => {
    let state = createAppState();
    state = compose(setMode("INSERT"))(state);

    expect(state.mode).toBe("INSERT");
  });
});
