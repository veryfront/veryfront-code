/**
 * Tests for core TUI types and Zod schemas
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  AgentSessionSchema,
  AgentTypeSchema,
  CodingAgentDefSchema,
  CodingAgentStateSchema,
  CommandCategorySchema,
  CommandDefSchema,
  CommandPaletteStateSchema,
  ConfirmationOptionsSchema,
  ConfirmationStateSchema,
  createCodingAgentState,
  createCommandPaletteState,
  createConfirmationState,
  createExtendedState,
  createKeyChordState,
  createNavStack,
  createSearchState,
  ExtendedStateSchema,
  KeyChordStateSchema,
  ModalTypeSchema,
  ModeSchema,
  NavEntrySchema,
  NavStackSchema,
  ProjectTabSchema,
  ResourceTabSchema,
  SearchResultSchema,
  SearchResultTypeSchema,
  SearchStateSchema,
  SlashCommandSchema,
  UserPreferencesSchema,
  ViewSchema,
} from "./types.ts";

describe("ModeSchema", () => {
  it("accepts valid modes", () => {
    expect(ModeSchema.parse("NORMAL")).toBe("NORMAL");
    expect(ModeSchema.parse("COMMAND")).toBe("COMMAND");
    expect(ModeSchema.parse("SEARCH")).toBe("SEARCH");
    expect(ModeSchema.parse("INSERT")).toBe("INSERT");
  });

  it("rejects invalid modes", () => {
    expect(() => ModeSchema.parse("INVALID")).toThrow();
    expect(() => ModeSchema.parse("")).toThrow();
    expect(() => ModeSchema.parse(123)).toThrow();
  });
});

describe("ViewSchema", () => {
  it("accepts all valid views", () => {
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
    ];
    for (const view of views) {
      expect(ViewSchema.parse(view)).toBe(view);
    }
  });

  it("rejects invalid views", () => {
    expect(() => ViewSchema.parse("unknown")).toThrow();
  });
});

describe("ProjectTabSchema", () => {
  it("accepts valid project tabs", () => {
    const tabs = ["dashboard", "files", "routes", "agents", "terminal", "logs"];
    for (const tab of tabs) {
      expect(ProjectTabSchema.parse(tab)).toBe(tab);
    }
  });
});

describe("ResourceTabSchema", () => {
  it("accepts valid resource tabs", () => {
    const tabs = ["files", "routes", "agents", "tools", "mcp"];
    for (const tab of tabs) {
      expect(ResourceTabSchema.parse(tab)).toBe(tab);
    }
  });
});

describe("NavEntrySchema", () => {
  it("accepts minimal entry", () => {
    const entry = { view: "dashboard" };
    const result = NavEntrySchema.parse(entry);
    expect(result.view).toBe("dashboard");
  });

  it("accepts entry with all fields", () => {
    const entry = {
      view: "project-detail",
      params: { projectId: "test-123" },
      scrollPosition: 100,
    };
    const result = NavEntrySchema.parse(entry);
    expect(result.view).toBe("project-detail");
    expect(result.params?.projectId).toBe("test-123");
    expect(result.scrollPosition).toBe(100);
  });

  it("rejects invalid view", () => {
    expect(() => NavEntrySchema.parse({ view: "invalid" })).toThrow();
  });
});

describe("NavStackSchema", () => {
  it("accepts empty stack", () => {
    const stack = { stack: [], maxSize: 20 };
    const result = NavStackSchema.parse(stack);
    expect(result.stack).toHaveLength(0);
    expect(result.maxSize).toBe(20);
  });

  it("applies default maxSize", () => {
    const stack = { stack: [] };
    const result = NavStackSchema.parse(stack);
    expect(result.maxSize).toBe(20);
  });
});

describe("CommandCategorySchema", () => {
  it("accepts valid categories", () => {
    const categories = ["navigation", "project", "server", "agent", "files", "utility"];
    for (const cat of categories) {
      expect(CommandCategorySchema.parse(cat)).toBe(cat);
    }
  });
});

describe("CommandDefSchema", () => {
  it("accepts minimal command", () => {
    const cmd = {
      id: "test",
      name: "Test Command",
      description: "A test command",
      category: "utility",
    };
    const result = CommandDefSchema.parse(cmd);
    expect(result.id).toBe("test");
    expect(result.shortcut).toBeUndefined();
  });

  it("accepts command with all fields", () => {
    const cmd = {
      id: "deploy",
      name: "Deploy",
      description: "Deploy to production",
      category: "project",
      shortcut: "D",
      aliases: ["d", "push"],
    };
    const result = CommandDefSchema.parse(cmd);
    expect(result.shortcut).toBe("D");
    expect(result.aliases).toEqual(["d", "push"]);
  });
});

describe("CommandPaletteStateSchema", () => {
  it("accepts valid state", () => {
    const state = {
      open: true,
      query: "dep",
      selectedIndex: 0,
      filteredCommands: [],
    };
    const result = CommandPaletteStateSchema.parse(state);
    expect(result.open).toBe(true);
  });
});

describe("SearchResultTypeSchema", () => {
  it("accepts valid types", () => {
    const types = ["file", "route", "command", "agent", "tool"];
    for (const type of types) {
      expect(SearchResultTypeSchema.parse(type)).toBe(type);
    }
  });
});

describe("SearchResultSchema", () => {
  it("accepts minimal result", () => {
    const result = {
      type: "file",
      id: "src/index.ts",
      label: "index.ts",
      score: 0.95,
    };
    const parsed = SearchResultSchema.parse(result);
    expect(parsed.type).toBe("file");
    expect(parsed.score).toBe(0.95);
  });

  it("accepts result with matches", () => {
    const result = {
      type: "route",
      id: "/api/users",
      label: "GET /api/users",
      description: "List all users",
      score: 0.8,
      matches: [[0, 3], [5, 8]] as [number, number][],
    };
    const parsed = SearchResultSchema.parse(result);
    expect(parsed.matches).toEqual([[0, 3], [5, 8]]);
  });
});

describe("SearchStateSchema", () => {
  it("accepts valid state", () => {
    const state = {
      open: false,
      query: "",
      selectedIndex: 0,
      results: [],
      loading: false,
    };
    const result = SearchStateSchema.parse(state);
    expect(result.open).toBe(false);
  });
});

describe("SlashCommandSchema", () => {
  it("accepts minimal command", () => {
    const cmd = {
      command: "deploy",
      args: [],
      flags: {},
    };
    const result = SlashCommandSchema.parse(cmd);
    expect(result.command).toBe("deploy");
  });

  it("accepts command with args and flags", () => {
    const cmd = {
      command: "new",
      args: ["my-app"],
      flags: { template: "ai", quiet: true },
    };
    const result = SlashCommandSchema.parse(cmd);
    expect(result.args).toEqual(["my-app"]);
    expect(result.flags.template).toBe("ai");
    expect(result.flags.quiet).toBe(true);
  });
});

describe("AgentTypeSchema", () => {
  it("accepts cli and ide", () => {
    expect(AgentTypeSchema.parse("cli")).toBe("cli");
    expect(AgentTypeSchema.parse("ide")).toBe("ide");
  });
});

describe("CodingAgentDefSchema", () => {
  it("accepts minimal agent", () => {
    const agent = {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      provider: "Anthropic",
      type: "cli",
    };
    const result = CodingAgentDefSchema.parse(agent);
    expect(result.id).toBe("claude");
    expect(result.models).toBeUndefined();
  });

  it("accepts agent with models", () => {
    const agent = {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      provider: "Anthropic",
      type: "cli",
      models: ["claude-3.5-sonnet", "claude-3-opus"],
      defaultModel: "claude-3.5-sonnet",
    };
    const result = CodingAgentDefSchema.parse(agent);
    expect(result.models).toHaveLength(2);
    expect(result.defaultModel).toBe("claude-3.5-sonnet");
  });
});

describe("AgentSessionSchema", () => {
  it("accepts valid session", () => {
    const session = {
      id: "session-123",
      agentId: "claude",
      model: "claude-3.5-sonnet",
      status: "running",
      projectPath: "/path/to/project",
      startedAt: Date.now(),
    };
    const result = AgentSessionSchema.parse(session);
    expect(result.status).toBe("running");
  });

  it("accepts all status values", () => {
    const statuses = ["starting", "running", "backgrounded", "stopped"];
    for (const status of statuses) {
      const session = {
        id: "test",
        agentId: "claude",
        status,
        projectPath: "/test",
        startedAt: 0,
      };
      expect(AgentSessionSchema.parse(session).status).toBe(status);
    }
  });
});

describe("CodingAgentStateSchema", () => {
  it("accepts valid state", () => {
    const state = {
      activeAgent: null,
      activeModel: null,
      agents: [],
      installedAgents: [],
      sessions: [],
      pickerOpen: false,
      pickerIndex: 0,
    };
    const result = CodingAgentStateSchema.parse(state);
    expect(result.activeAgent).toBeNull();
  });
});

describe("KeyChordStateSchema", () => {
  it("accepts empty state", () => {
    const state = {
      pending: null,
      startTime: null,
      count: null,
    };
    const result = KeyChordStateSchema.parse(state);
    expect(result.pending).toBeNull();
  });

  it("accepts pending chord", () => {
    const state = {
      pending: "g",
      startTime: Date.now(),
      count: 5,
    };
    const result = KeyChordStateSchema.parse(state);
    expect(result.pending).toBe("g");
    expect(result.count).toBe(5);
  });
});

describe("ModalTypeSchema", () => {
  it("accepts all modal types", () => {
    const types = ["command-palette", "search", "agent-picker", "confirmation", "model-picker"];
    for (const type of types) {
      expect(ModalTypeSchema.parse(type)).toBe(type);
    }
  });
});

describe("ConfirmationOptionsSchema", () => {
  it("accepts minimal options", () => {
    const opts = {
      title: "Confirm",
      message: "Are you sure?",
    };
    const result = ConfirmationOptionsSchema.parse(opts);
    expect(result.confirmLabel).toBe("Yes");
    expect(result.cancelLabel).toBe("No");
    expect(result.variant).toBe("info");
  });

  it("accepts custom labels", () => {
    const opts = {
      title: "Delete Project",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Keep",
      variant: "danger" as const,
    };
    const result = ConfirmationOptionsSchema.parse(opts);
    expect(result.confirmLabel).toBe("Delete");
    expect(result.variant).toBe("danger");
  });
});

describe("ConfirmationStateSchema", () => {
  it("accepts valid state", () => {
    const state = {
      open: false,
      options: null,
      selectedIndex: 0,
      onConfirm: null,
      onCancel: null,
    };
    const result = ConfirmationStateSchema.parse(state);
    expect(result.open).toBe(false);
  });
});

describe("UserPreferencesSchema", () => {
  it("accepts minimal preferences", () => {
    const prefs = {
      defaultAgent: null,
    };
    const result = UserPreferencesSchema.parse(prefs);
    expect(result.autoConnect).toBe(true);
    expect(result.theme).toBe("auto");
  });

  it("accepts full preferences", () => {
    const prefs = {
      defaultAgent: "claude",
      autoConnect: false,
      fallbackToTui: false,
      theme: "dark" as const,
    };
    const result = UserPreferencesSchema.parse(prefs);
    expect(result.defaultAgent).toBe("claude");
    expect(result.autoConnect).toBe(false);
  });
});

describe("ExtendedStateSchema", () => {
  it("accepts valid state", () => {
    const state = createExtendedState();
    const result = ExtendedStateSchema.parse(state);
    expect(result.mode).toBe("NORMAL");
  });
});

// Factory function tests
describe("Factory Functions", () => {
  describe("createNavStack", () => {
    it("creates empty stack with default max size", () => {
      const stack = createNavStack();
      expect(stack.stack).toHaveLength(0);
      expect(stack.maxSize).toBe(20);
    });
  });

  describe("createKeyChordState", () => {
    it("creates state with all nulls", () => {
      const state = createKeyChordState();
      expect(state.pending).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.count).toBeNull();
    });
  });

  describe("createCommandPaletteState", () => {
    it("creates closed palette with empty query", () => {
      const state = createCommandPaletteState();
      expect(state.open).toBe(false);
      expect(state.query).toBe("");
      expect(state.selectedIndex).toBe(0);
      expect(state.filteredCommands).toHaveLength(0);
    });
  });

  describe("createSearchState", () => {
    it("creates closed search with empty query", () => {
      const state = createSearchState();
      expect(state.open).toBe(false);
      expect(state.query).toBe("");
      expect(state.results).toHaveLength(0);
      expect(state.loading).toBe(false);
    });
  });

  describe("createCodingAgentState", () => {
    it("creates state with no active agent", () => {
      const state = createCodingAgentState();
      expect(state.activeAgent).toBeNull();
      expect(state.activeModel).toBeNull();
      expect(state.agents).toHaveLength(0);
      expect(state.pickerOpen).toBe(false);
    });
  });

  describe("createConfirmationState", () => {
    it("creates closed dialog", () => {
      const state = createConfirmationState();
      expect(state.open).toBe(false);
      expect(state.options).toBeNull();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe("createExtendedState", () => {
    it("creates complete initial state", () => {
      const state = createExtendedState();
      expect(state.mode).toBe("NORMAL");
      expect(state.navStack.stack).toHaveLength(0);
      expect(state.commandPalette.open).toBe(false);
      expect(state.search.open).toBe(false);
      expect(state.codingAgent.activeAgent).toBeNull();
      expect(state.projectTab).toBe("dashboard");
      expect(state.resourceTab).toBe("files");
    });
  });
});
