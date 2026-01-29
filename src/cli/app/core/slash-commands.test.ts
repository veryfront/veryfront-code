/**
 * Tests for slash command module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  formatSlashCommand,
  formatSlashHelp,
  getAllSlashCommands,
  getSlashSuggestions,
  isSlashCommand,
  parseSlashCommand,
  resolveCommand,
  SLASH_COMMANDS,
  validateSlashCommand,
} from "./slash-commands.ts";

describe("SLASH_COMMANDS", () => {
  it("has essential commands", () => {
    expect(SLASH_COMMANDS.dashboard).toBeDefined();
    expect(SLASH_COMMANDS.new).toBeDefined();
    expect(SLASH_COMMANDS.deploy).toBeDefined();
    expect(SLASH_COMMANDS["coding-agent"]).toBeDefined();
  });

  it("all commands have name and description", () => {
    for (const [key, def] of Object.entries(SLASH_COMMANDS)) {
      expect(def.name).toBe(key);
      expect(def.description).toBeDefined();
    }
  });
});

describe("isSlashCommand", () => {
  it("returns true for slash prefix", () => {
    expect(isSlashCommand("/deploy")).toBe(true);
    expect(isSlashCommand("/new my-app")).toBe(true);
    expect(isSlashCommand("  /settings")).toBe(true);
  });

  it("returns false for non-slash input", () => {
    expect(isSlashCommand("deploy")).toBe(false);
    expect(isSlashCommand(":deploy")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
  });
});

describe("parseSlashCommand", () => {
  it("parses simple command", () => {
    const result = parseSlashCommand("/deploy");
    expect(result?.command).toBe("deploy");
    expect(result?.args).toEqual([]);
    expect(result?.flags).toEqual({});
  });

  it("parses command with arg", () => {
    const result = parseSlashCommand("/new my-app");
    expect(result?.command).toBe("new");
    expect(result?.args).toEqual(["my-app"]);
  });

  it("parses command with multiple args", () => {
    const result = parseSlashCommand("/generate page about");
    expect(result?.command).toBe("generate");
    expect(result?.args).toEqual(["page", "about"]);
  });

  it("parses long flags", () => {
    const result = parseSlashCommand("/new my-app --template ai");
    expect(result?.flags.template).toBe("ai");
  });

  it("parses long flag with equals", () => {
    const result = parseSlashCommand("/deploy --env=staging");
    expect(result?.flags.env).toBe("staging");
  });

  it("parses boolean long flags", () => {
    const result = parseSlashCommand("/deploy --force");
    expect(result?.flags.force).toBe(true);
  });

  it("parses short flags", () => {
    const result = parseSlashCommand("/new -t ai");
    expect(result?.flags.t).toBe("ai");
  });

  it("parses boolean short flags", () => {
    const result = parseSlashCommand("/deploy -f");
    expect(result?.flags.f).toBe(true);
  });

  it("handles quoted strings", () => {
    const result = parseSlashCommand('/new "my app name"');
    expect(result?.args).toEqual(["my app name"]);
  });

  it("handles single quotes", () => {
    const result = parseSlashCommand("/new 'my app'");
    expect(result?.args).toEqual(["my app"]);
  });

  it("normalizes command to lowercase", () => {
    const result = parseSlashCommand("/DEPLOY");
    expect(result?.command).toBe("deploy");
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("deploy")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("handles complex command", () => {
    const result = parseSlashCommand("/new my-app --template ai --quiet -v");
    expect(result?.command).toBe("new");
    expect(result?.args).toEqual(["my-app"]);
    expect(result?.flags.template).toBe("ai");
    expect(result?.flags.quiet).toBe(true);
    expect(result?.flags.v).toBe(true);
  });
});

describe("resolveCommand", () => {
  it("resolves direct command name", () => {
    const result = resolveCommand("deploy");
    expect(result?.name).toBe("deploy");
  });

  it("resolves alias", () => {
    const result = resolveCommand("home");
    expect(result?.name).toBe("dashboard");
  });

  it("is case insensitive", () => {
    const result = resolveCommand("DEPLOY");
    expect(result?.name).toBe("deploy");
  });

  it("returns null for unknown command", () => {
    expect(resolveCommand("xyz123")).toBeNull();
  });
});

describe("getSlashSuggestions", () => {
  it("returns matching commands", () => {
    const results = getSlashSuggestions("de");
    const names = results.map((r) => r.name);
    expect(names).toContain("deploy");
  });

  it("returns commands matching aliases", () => {
    const results = getSlashSuggestions("ho");
    const names = results.map((r) => r.name);
    expect(names).toContain("dashboard"); // "home" alias
  });

  it("limits results", () => {
    const results = getSlashSuggestions("", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for no matches", () => {
    const results = getSlashSuggestions("xyz123");
    expect(results.length).toBe(0);
  });
});

describe("getAllSlashCommands", () => {
  it("returns all commands", () => {
    const commands = getAllSlashCommands();
    expect(commands.length).toBe(Object.keys(SLASH_COMMANDS).length);
  });
});

describe("validateSlashCommand", () => {
  it("validates command with no schema", () => {
    const parsed = { command: "dashboard", args: [], flags: {} };
    const def = SLASH_COMMANDS.dashboard!;
    const result = validateSlashCommand(parsed, def);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates command with valid args", () => {
    const parsed = { command: "new", args: ["my-app"], flags: {} };
    const def = SLASH_COMMANDS.new!;
    const result = validateSlashCommand(parsed, def);
    expect(result.valid).toBe(true);
  });

  it("validates command with valid flags", () => {
    const parsed = {
      command: "deploy",
      args: [],
      flags: { env: "staging", force: true },
    };
    const def = SLASH_COMMANDS.deploy!;
    const result = validateSlashCommand(parsed, def);
    expect(result.valid).toBe(true);
  });
});

describe("formatSlashCommand", () => {
  it("formats simple command", () => {
    const def = { name: "deploy", description: "Deploy" };
    expect(formatSlashCommand(def)).toBe("/deploy");
  });

  it("formats command with aliases", () => {
    const def = { name: "dashboard", description: "Go home", aliases: ["home", "main"] };
    const result = formatSlashCommand(def);
    expect(result).toContain("/dashboard");
    expect(result).toContain("/home");
    expect(result).toContain("/main");
  });
});

describe("formatSlashHelp", () => {
  it("formats help text", () => {
    const def = { name: "deploy", description: "Deploy to production" };
    const result = formatSlashHelp(def);
    expect(result).toContain("/deploy");
    expect(result).toContain("Deploy to production");
  });

  it("includes aliases in help", () => {
    const def = { name: "dashboard", description: "Go home", aliases: ["home"] };
    const result = formatSlashHelp(def);
    expect(result).toContain("Aliases");
    expect(result).toContain("/home");
  });
});
