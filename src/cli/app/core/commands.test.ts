/**
 * Tests for command registry module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  addToHistory,
  createHistory,
  createRegistry,
  DEFAULT_COMMANDS,
  findCommand,
  fuzzyScore,
  getCategories,
  getCategory,
  getCommand,
  getCompletions,
  historyDown,
  historyUp,
  resetHistoryPosition,
  searchCommands,
} from "./commands.ts";

describe("DEFAULT_COMMANDS", () => {
  it("has commands defined", () => {
    expect(DEFAULT_COMMANDS.length).toBeGreaterThan(0);
  });

  it("has essential commands", () => {
    const ids = DEFAULT_COMMANDS.map((c) => c.id);
    expect(ids).toContain("dashboard");
    expect(ids).toContain("new");
    expect(ids).toContain("deploy");
    expect(ids).toContain("quit");
  });

  it("all commands have required fields", () => {
    for (const cmd of DEFAULT_COMMANDS) {
      expect(cmd.id).toBeDefined();
      expect(cmd.name).toBeDefined();
      expect(cmd.description).toBeDefined();
      expect(cmd.category).toBeDefined();
    }
  });
});

describe("createRegistry", () => {
  it("creates registry with default commands", () => {
    const registry = createRegistry();
    expect(registry.commands.length).toBe(DEFAULT_COMMANDS.length);
  });

  it("indexes commands by id", () => {
    const registry = createRegistry();
    const cmd = registry.byId.get("dashboard");
    expect(cmd?.name).toBe("Dashboard");
  });

  it("indexes commands by category", () => {
    const registry = createRegistry();
    const navCommands = registry.byCategory.get("navigation");
    expect(navCommands).toBeDefined();
    expect(navCommands!.length).toBeGreaterThan(0);
  });

  it("indexes commands by alias", () => {
    const registry = createRegistry();
    const cmd = registry.byAlias.get("home");
    expect(cmd?.id).toBe("dashboard");
  });

  it("creates registry from custom commands", () => {
    const custom = [
      { id: "test", name: "Test", description: "Test command", category: "utility" as const },
    ];
    const registry = createRegistry(custom);
    expect(registry.commands.length).toBe(1);
    expect(registry.byId.get("test")?.name).toBe("Test");
  });
});

describe("getCommand", () => {
  it("returns command by id", () => {
    const registry = createRegistry();
    const cmd = getCommand(registry, "deploy");
    expect(cmd?.name).toBe("Deploy");
  });

  it("returns undefined for unknown id", () => {
    const registry = createRegistry();
    const cmd = getCommand(registry, "unknown");
    expect(cmd).toBeUndefined();
  });
});

describe("findCommand", () => {
  it("finds by id", () => {
    const registry = createRegistry();
    const cmd = findCommand(registry, "dashboard");
    expect(cmd?.id).toBe("dashboard");
  });

  it("finds by alias", () => {
    const registry = createRegistry();
    const cmd = findCommand(registry, "home");
    expect(cmd?.id).toBe("dashboard");
  });

  it("finds by name (case insensitive)", () => {
    const registry = createRegistry();
    const cmd = findCommand(registry, "Dashboard");
    expect(cmd?.id).toBe("dashboard");
  });

  it("returns undefined for unknown", () => {
    const registry = createRegistry();
    const cmd = findCommand(registry, "xyz123");
    expect(cmd).toBeUndefined();
  });

  it("handles whitespace", () => {
    const registry = createRegistry();
    const cmd = findCommand(registry, "  dashboard  ");
    expect(cmd?.id).toBe("dashboard");
  });
});

describe("getCategory", () => {
  it("returns commands in category", () => {
    const registry = createRegistry();
    const commands = getCategory(registry, "navigation");
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      expect(cmd.category).toBe("navigation");
    }
  });

  it("returns empty array for empty category", () => {
    const registry = createRegistry([]);
    const commands = getCategory(registry, "navigation");
    expect(commands).toEqual([]);
  });
});

describe("getCategories", () => {
  it("returns all categories with commands", () => {
    const registry = createRegistry();
    const categories = getCategories(registry);
    expect(categories).toContain("navigation");
    expect(categories).toContain("project");
    expect(categories).toContain("utility");
  });
});

describe("fuzzyScore", () => {
  it("returns high score for exact match at start", () => {
    const result = fuzzyScore("dash", "dashboard");
    expect(result.score).toBe(100);
    expect(result.matches).toEqual([[0, 4]]);
  });

  it("returns good score for exact match elsewhere", () => {
    const result = fuzzyScore("board", "dashboard");
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(100);
  });

  it("returns lower score for fuzzy match", () => {
    const result = fuzzyScore("dbd", "dashboard");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(80);
  });

  it("returns 0 for no match", () => {
    const result = fuzzyScore("xyz", "dashboard");
    expect(result.score).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("is case insensitive", () => {
    const result = fuzzyScore("DASH", "dashboard");
    expect(result.score).toBe(100);
  });

  it("gives bonus for word boundary matches", () => {
    const result1 = fuzzyScore("n", "new");
    const result2 = fuzzyScore("e", "new");
    expect(result1.score).toBeGreaterThan(result2.score);
  });
});

describe("searchCommands", () => {
  it("returns all commands for empty query", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "");
    expect(results.length).toBeGreaterThan(0);
  });

  it("limits results", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("finds commands by name prefix", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "dep");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.command.id).toContain("deploy");
  });

  it("finds commands by alias", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "home");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.command.id).toBe("dashboard");
  });

  it("sorts by score descending", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "de");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("returns empty for no matches", () => {
    const registry = createRegistry();
    const results = searchCommands(registry, "zzzzxxx");
    expect(results.length).toBe(0);
  });
});

describe("getCompletions", () => {
  it("returns command ids", () => {
    const registry = createRegistry();
    const completions = getCompletions(registry, "dep");
    expect(completions.length).toBeGreaterThan(0);
    expect(completions[0]).toContain("deploy");
  });

  it("limits completions", () => {
    const registry = createRegistry();
    const completions = getCompletions(registry, "", 3);
    expect(completions.length).toBeLessThanOrEqual(3);
  });
});

describe("Command History", () => {
  describe("createHistory", () => {
    it("creates empty history", () => {
      const history = createHistory();
      expect(history.entries).toEqual([]);
      expect(history.position).toBe(-1);
    });

    it("respects custom max size", () => {
      const history = createHistory(50);
      expect(history.maxSize).toBe(50);
    });
  });

  describe("addToHistory", () => {
    it("adds command to front", () => {
      let history = createHistory();
      history = addToHistory(history, "deploy");
      expect(history.entries[0]).toBe("deploy");
    });

    it("resets position", () => {
      let history = createHistory();
      history = addToHistory(history, "one");
      history = { ...history, position: 0 };
      history = addToHistory(history, "two");
      expect(history.position).toBe(-1);
    });

    it("ignores empty commands", () => {
      let history = createHistory();
      history = addToHistory(history, "");
      history = addToHistory(history, "   ");
      expect(history.entries.length).toBe(0);
    });

    it("ignores duplicate of last", () => {
      let history = createHistory();
      history = addToHistory(history, "deploy");
      history = addToHistory(history, "deploy");
      expect(history.entries.length).toBe(1);
    });

    it("limits size", () => {
      let history = createHistory(3);
      history = addToHistory(history, "one");
      history = addToHistory(history, "two");
      history = addToHistory(history, "three");
      history = addToHistory(history, "four");
      expect(history.entries.length).toBe(3);
      expect(history.entries[0]).toBe("four");
      expect(history.entries).not.toContain("one");
    });
  });

  describe("historyUp", () => {
    it("returns null for empty history", () => {
      const history = createHistory();
      const result = historyUp(history);
      expect(result.command).toBeNull();
    });

    it("returns first entry from initial position", () => {
      let history = createHistory();
      history = addToHistory(history, "one");
      history = addToHistory(history, "two");

      const result = historyUp(history);
      expect(result.command).toBe("two");
      expect(result.history.position).toBe(0);
    });

    it("navigates through history", () => {
      let history = createHistory();
      history = addToHistory(history, "one");
      history = addToHistory(history, "two");

      const result1 = historyUp(history);
      const result2 = historyUp(result1.history);
      expect(result2.command).toBe("one");
    });

    it("stops at oldest entry", () => {
      let history = createHistory();
      history = addToHistory(history, "one");

      const result1 = historyUp(history);
      const result2 = historyUp(result1.history);
      const result3 = historyUp(result2.history);
      expect(result3.command).toBe("one");
      expect(result3.history.position).toBe(0);
    });
  });

  describe("historyDown", () => {
    it("returns null at initial position", () => {
      let history = createHistory();
      history = addToHistory(history, "one");

      const result = historyDown(history);
      expect(result.command).toBeNull();
      expect(result.history.position).toBe(-1);
    });

    it("navigates back through history", () => {
      let history = createHistory();
      history = addToHistory(history, "one");
      history = addToHistory(history, "two");

      // Go up twice
      const up1 = historyUp(history);
      const up2 = historyUp(up1.history);

      // Now go down
      const down1 = historyDown(up2.history);
      expect(down1.command).toBe("two");
    });

    it("returns to initial position", () => {
      let history = createHistory();
      history = addToHistory(history, "one");

      const up = historyUp(history);
      const down = historyDown(up.history);
      expect(down.history.position).toBe(-1);
    });
  });

  describe("resetHistoryPosition", () => {
    it("resets position to -1", () => {
      let history = createHistory();
      history = addToHistory(history, "one");
      const up = historyUp(history);

      const reset = resetHistoryPosition(up.history);
      expect(reset.position).toBe(-1);
    });
  });
});
