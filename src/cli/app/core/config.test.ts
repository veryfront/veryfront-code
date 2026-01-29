/**
 * Tests for config persistence module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  addRecentProject,
  addToHistory,
  clearHistory,
  clearRecentProjects,
  ConfigStateSchema,
  createConfigState,
  RecentProjectSchema,
  removeRecentProject,
  updatePreferences,
  UserPreferencesSchema,
} from "./config.ts";

describe("UserPreferencesSchema", () => {
  it("parses with defaults", () => {
    const result = UserPreferencesSchema.parse({});

    expect(result.defaultAgent).toBeNull();
    expect(result.autoConnect).toBe(true);
    expect(result.fallbackToTui).toBe(true);
    expect(result.defaultPort).toBe(8080);
    expect(result.theme).toBe("default");
  });

  it("parses custom values", () => {
    const result = UserPreferencesSchema.parse({
      defaultAgent: "claude",
      autoConnect: false,
      defaultPort: 3000,
    });

    expect(result.defaultAgent).toBe("claude");
    expect(result.autoConnect).toBe(false);
    expect(result.defaultPort).toBe(3000);
  });
});

describe("RecentProjectSchema", () => {
  it("parses project", () => {
    const result = RecentProjectSchema.parse({
      id: "my-app",
      name: "My App",
      path: "/home/user/my-app",
      lastAccessed: 12345,
    });

    expect(result.id).toBe("my-app");
    expect(result.path).toBe("/home/user/my-app");
  });
});

describe("ConfigStateSchema", () => {
  it("parses full state", () => {
    const result = ConfigStateSchema.parse({
      preferences: {},
      commandHistory: ["deploy", "pull"],
      recentProjects: [],
    });

    expect(result.commandHistory).toEqual(["deploy", "pull"]);
  });
});

describe("createConfigState", () => {
  it("creates state with defaults", () => {
    const state = createConfigState();

    expect(state.preferences.defaultAgent).toBeNull();
    expect(state.commandHistory).toEqual([]);
    expect(state.recentProjects).toEqual([]);
  });
});

describe("updatePreferences", () => {
  it("updates preferences", () => {
    let state = createConfigState();
    state = updatePreferences({ defaultAgent: "claude" })(state);

    expect(state.preferences.defaultAgent).toBe("claude");
    expect(state.preferences.autoConnect).toBe(true);
  });

  it("preserves unchanged preferences", () => {
    let state = createConfigState();
    state = updatePreferences({ defaultPort: 3000 })(state);

    expect(state.preferences.defaultAgent).toBeNull();
    expect(state.preferences.defaultPort).toBe(3000);
  });
});

describe("addToHistory", () => {
  it("adds command to front", () => {
    let state = createConfigState();
    state = addToHistory("deploy")(state);
    state = addToHistory("pull")(state);

    expect(state.commandHistory).toEqual(["pull", "deploy"]);
  });

  it("removes duplicates", () => {
    let state = createConfigState();
    state = addToHistory("deploy")(state);
    state = addToHistory("pull")(state);
    state = addToHistory("deploy")(state);

    expect(state.commandHistory).toEqual(["deploy", "pull"]);
  });

  it("limits history size", () => {
    let state = createConfigState();

    for (let i = 0; i < 150; i++) {
      state = addToHistory(`cmd-${i}`)(state);
    }

    expect(state.commandHistory.length).toBe(100);
    expect(state.commandHistory[0]).toBe("cmd-149");
  });
});

describe("clearHistory", () => {
  it("clears all history", () => {
    let state = createConfigState();
    state = addToHistory("deploy")(state);
    state = addToHistory("pull")(state);
    state = clearHistory()(state);

    expect(state.commandHistory).toEqual([]);
  });
});

describe("addRecentProject", () => {
  it("adds project to front", () => {
    let state = createConfigState();
    state = addRecentProject({
      id: "app1",
      name: "App 1",
      path: "/app1",
    })(state);

    expect(state.recentProjects.length).toBe(1);
    expect(state.recentProjects[0]?.id).toBe("app1");
    expect(state.recentProjects[0]?.lastAccessed).toBeGreaterThan(0);
  });

  it("updates existing project", () => {
    let state = createConfigState();
    state = addRecentProject({ id: "app1", name: "App 1", path: "/app1" })(state);
    const _firstAccess = state.recentProjects[0]?.lastAccessed;

    // Wait a bit to get different timestamp
    state = addRecentProject({ id: "app2", name: "App 2", path: "/app2" })(state);
    state = addRecentProject({ id: "app1", name: "App 1 Updated", path: "/app1" })(state);

    expect(state.recentProjects.length).toBe(2);
    expect(state.recentProjects[0]?.id).toBe("app1");
    expect(state.recentProjects[0]?.name).toBe("App 1 Updated");
  });

  it("limits recent projects", () => {
    let state = createConfigState();

    for (let i = 0; i < 30; i++) {
      state = addRecentProject({
        id: `app-${i}`,
        name: `App ${i}`,
        path: `/app-${i}`,
      })(state);
    }

    expect(state.recentProjects.length).toBe(20);
    expect(state.recentProjects[0]?.id).toBe("app-29");
  });
});

describe("removeRecentProject", () => {
  it("removes project by id", () => {
    let state = createConfigState();
    state = addRecentProject({ id: "app1", name: "App 1", path: "/app1" })(state);
    state = addRecentProject({ id: "app2", name: "App 2", path: "/app2" })(state);
    state = removeRecentProject("app1")(state);

    expect(state.recentProjects.length).toBe(1);
    expect(state.recentProjects[0]?.id).toBe("app2");
  });
});

describe("clearRecentProjects", () => {
  it("clears all projects", () => {
    let state = createConfigState();
    state = addRecentProject({ id: "app1", name: "App 1", path: "/app1" })(state);
    state = clearRecentProjects()(state);

    expect(state.recentProjects).toEqual([]);
  });
});
