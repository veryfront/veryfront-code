/**
 * Tests for coding agent connector module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  addInstalledAgent,
  addSession,
  buildAgentCommand,
  closeAgentPicker,
  createAgentRegistry,
  createSession,
  DEFAULT_AGENTS,
  getActiveSessions,
  getAgent,
  getAgentDisplayName,
  getAgentModels,
  getCLIAgents,
  getIDEAgents,
  initAgentState,
  isAgentInstalled,
  movePickerSelection,
  openAgentPicker,
  removeSession,
  setActiveAgent,
  setActiveModel,
  updateSessionStatus,
} from "./agents.ts";

describe("DEFAULT_AGENTS", () => {
  it("includes essential agents", () => {
    const ids = DEFAULT_AGENTS.map((a) => a.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("codex");
    expect(ids).toContain("aider");
    expect(ids).toContain("cursor");
  });

  it("all agents have required fields", () => {
    for (const agent of DEFAULT_AGENTS) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.command).toBeDefined();
      expect(agent.provider).toBeDefined();
      expect(agent.type).toBeDefined();
    }
  });

  it("has both CLI and IDE agents", () => {
    const cliAgents = DEFAULT_AGENTS.filter((a) => a.type === "cli");
    const ideAgents = DEFAULT_AGENTS.filter((a) => a.type === "ide");
    expect(cliAgents.length).toBeGreaterThan(0);
    expect(ideAgents.length).toBeGreaterThan(0);
  });
});

describe("createAgentRegistry", () => {
  it("creates registry with default agents", () => {
    const registry = createAgentRegistry();
    expect(registry.agents.length).toBe(DEFAULT_AGENTS.length);
  });

  it("indexes agents by id", () => {
    const registry = createAgentRegistry();
    const claude = registry.byId.get("claude");
    expect(claude?.name).toBe("Claude Code");
  });

  it("creates registry from custom agents", () => {
    const custom = [
      { id: "test", name: "Test", command: "test", provider: "Test", type: "cli" as const },
    ];
    const registry = createAgentRegistry(custom);
    expect(registry.agents.length).toBe(1);
  });
});

describe("getAgent", () => {
  it("returns agent by id", () => {
    const registry = createAgentRegistry();
    const agent = getAgent(registry, "claude");
    expect(agent?.name).toBe("Claude Code");
  });

  it("returns undefined for unknown id", () => {
    const registry = createAgentRegistry();
    expect(getAgent(registry, "unknown")).toBeUndefined();
  });
});

describe("getCLIAgents", () => {
  it("returns only CLI agents", () => {
    const registry = createAgentRegistry();
    const cliAgents = getCLIAgents(registry);
    for (const agent of cliAgents) {
      expect(agent.type).toBe("cli");
    }
  });
});

describe("getIDEAgents", () => {
  it("returns only IDE agents", () => {
    const registry = createAgentRegistry();
    const ideAgents = getIDEAgents(registry);
    for (const agent of ideAgents) {
      expect(agent.type).toBe("ide");
    }
  });
});

describe("initAgentState", () => {
  it("creates state with agents from registry", () => {
    const registry = createAgentRegistry();
    const state = initAgentState(registry);
    expect(state.agents.length).toBe(DEFAULT_AGENTS.length);
    expect(state.activeAgent).toBeNull();
  });

  it("sets installed agents", () => {
    const registry = createAgentRegistry();
    const state = initAgentState(registry, ["claude", "aider"]);
    expect(state.installedAgents).toContain("claude");
    expect(state.installedAgents).toContain("aider");
  });
});

describe("setActiveAgent", () => {
  it("sets active agent", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = setActiveAgent("claude")(state);

    expect(state.activeAgent?.id).toBe("claude");
    expect(state.activeModel).toBe("claude-sonnet-4-20250514");
  });

  it("clears agent when null", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = setActiveAgent("claude")(state);
    state = setActiveAgent(null)(state);

    expect(state.activeAgent).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("does nothing for unknown agent", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = setActiveAgent("unknown")(state);

    expect(state.activeAgent).toBeNull();
  });
});

describe("setActiveModel", () => {
  it("sets model", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = setActiveAgent("claude")(state);
    state = setActiveModel("claude-opus-4-20250514")(state);

    expect(state.activeModel).toBe("claude-opus-4-20250514");
  });

  it("clears model when null", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = setActiveAgent("claude")(state);
    state = setActiveModel(null)(state);

    expect(state.activeModel).toBeNull();
  });
});

describe("addInstalledAgent", () => {
  it("adds agent to installed list", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = addInstalledAgent("claude")(state);

    expect(state.installedAgents).toContain("claude");
  });

  it("does not add duplicates", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry, ["claude"]);
    state = addInstalledAgent("claude")(state);

    expect(state.installedAgents.filter((a) => a === "claude").length).toBe(1);
  });
});

describe("Agent Picker", () => {
  it("opens picker", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);

    expect(state.pickerOpen).toBe(true);
    expect(state.pickerIndex).toBe(0);
  });

  it("closes picker", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = closeAgentPicker()(state);

    expect(state.pickerOpen).toBe(false);
  });

  it("moves selection down", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = movePickerSelection(1)(state);

    expect(state.pickerIndex).toBe(1);
  });

  it("wraps selection at end", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    // Move past end
    for (let i = 0; i < state.agents.length + 1; i++) {
      state = movePickerSelection(1)(state);
    }

    expect(state.pickerIndex).toBe(1);
  });

  it("wraps selection at start", () => {
    const registry = createAgentRegistry();
    let state = initAgentState(registry);
    state = openAgentPicker()(state);
    state = movePickerSelection(-1)(state);

    expect(state.pickerIndex).toBe(state.agents.length - 1);
  });
});

describe("Session Management", () => {
  describe("createSession", () => {
    it("creates session with unique id", () => {
      const session1 = createSession("claude", "/path/to/project");
      const session2 = createSession("claude", "/path/to/project");

      expect(session1.id).not.toBe(session2.id);
    });

    it("sets initial status to starting", () => {
      const session = createSession("claude", "/path");
      expect(session.status).toBe("starting");
    });

    it("includes model if provided", () => {
      const session = createSession("claude", "/path", "claude-opus-4-20250514");
      expect(session.model).toBe("claude-opus-4-20250514");
    });
  });

  describe("addSession", () => {
    it("adds session to state", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);
      const session = createSession("claude", "/path");
      state = addSession(session)(state);

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.agentId).toBe("claude");
    });
  });

  describe("updateSessionStatus", () => {
    it("updates session status", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);
      const session = createSession("claude", "/path");
      state = addSession(session)(state);
      state = updateSessionStatus(session.id, "running")(state);

      expect(state.sessions[0]?.status).toBe("running");
    });
  });

  describe("removeSession", () => {
    it("removes session from state", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);
      const session = createSession("claude", "/path");
      state = addSession(session)(state);
      state = removeSession(session.id)(state);

      expect(state.sessions).toHaveLength(0);
    });
  });

  describe("getActiveSessions", () => {
    it("returns non-stopped sessions", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);

      const session1 = createSession("claude", "/path1");
      const session2 = createSession("aider", "/path2");

      state = addSession(session1)(state);
      state = addSession(session2)(state);
      state = updateSessionStatus(session1.id, "running")(state);
      state = updateSessionStatus(session2.id, "stopped")(state);

      const active = getActiveSessions(state);
      expect(active).toHaveLength(1);
      expect(active[0]?.agentId).toBe("claude");
    });
  });
});

describe("buildAgentCommand", () => {
  it("builds simple command", () => {
    const agent = DEFAULT_AGENTS.find((a) => a.id === "claude")!;
    const result = buildAgentCommand(agent, "/project");

    expect(result.command).toBe("claude");
    expect(result.args).toEqual([]);
  });

  it("replaces dot with project path", () => {
    const agent = DEFAULT_AGENTS.find((a) => a.id === "cursor")!;
    const result = buildAgentCommand(agent, "/my/project");

    expect(result.command).toBe("cursor");
    expect(result.args).toContain("/my/project");
  });

  it("adds model flag for claude", () => {
    const agent = DEFAULT_AGENTS.find((a) => a.id === "claude")!;
    const result = buildAgentCommand(agent, "/project", "claude-opus-4-20250514");

    expect(result.args).toContain("--model");
    expect(result.args).toContain("claude-opus-4-20250514");
  });
});

describe("Query Functions", () => {
  describe("isAgentInstalled", () => {
    it("returns true for installed agent", () => {
      const registry = createAgentRegistry();
      const state = initAgentState(registry, ["claude"]);
      expect(isAgentInstalled(state, "claude")).toBe(true);
    });

    it("returns false for not installed agent", () => {
      const registry = createAgentRegistry();
      const state = initAgentState(registry);
      expect(isAgentInstalled(state, "claude")).toBe(false);
    });
  });

  describe("getAgentModels", () => {
    it("returns models for agent", () => {
      const registry = createAgentRegistry();
      const state = initAgentState(registry);
      const models = getAgentModels(state, "claude");

      expect(models).toContain("claude-sonnet-4-20250514");
    });

    it("returns empty array for unknown agent", () => {
      const registry = createAgentRegistry();
      const state = initAgentState(registry);
      const models = getAgentModels(state, "unknown");

      expect(models).toEqual([]);
    });
  });

  describe("getAgentDisplayName", () => {
    it("returns 'None' when no agent", () => {
      const registry = createAgentRegistry();
      const state = initAgentState(registry);
      expect(getAgentDisplayName(state)).toBe("None");
    });

    it("returns agent name when active", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);
      state = setActiveAgent("claude")(state);

      const name = getAgentDisplayName(state);
      expect(name).toContain("Claude Code");
    });

    it("includes model when set", () => {
      const registry = createAgentRegistry();
      let state = initAgentState(registry);
      state = setActiveAgent("claude")(state);
      state = setActiveModel("claude-opus-4-20250514")(state);

      const name = getAgentDisplayName(state);
      expect(name).toContain("claude-opus-4-20250514");
    });
  });
});
