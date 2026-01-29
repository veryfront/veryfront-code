// Slash Command Module
// Parses and handles /command syntax with arguments and flags

import { z } from "zod";
import type { SlashCommand } from "./types.ts";

// ============================================================================
// Slash Command Definitions
// ============================================================================

export interface SlashCommandDef {
  name: string;
  description: string;
  args?: z.ZodType;
  flags?: z.ZodType;
  aliases?: string[];
}

export const SLASH_COMMANDS: Record<string, SlashCommandDef> = {
  // Navigation
  dashboard: {
    name: "dashboard",
    description: "Go to dashboard",
    aliases: ["home"],
  },
  settings: {
    name: "settings",
    description: "Open settings",
    aliases: ["config"],
  },
  help: {
    name: "help",
    description: "Show help",
    aliases: ["?"],
  },

  // Project
  new: {
    name: "new",
    description: "Create new project",
    args: z.string().optional(),
    flags: z.object({
      template: z.string().optional(),
      quiet: z.boolean().optional(),
    }).optional(),
    aliases: ["create", "init"],
  },
  deploy: {
    name: "deploy",
    description: "Deploy project",
    flags: z.object({
      env: z.string().optional(),
      force: z.boolean().optional(),
    }).optional(),
  },
  pull: {
    name: "pull",
    description: "Pull from remote",
    aliases: ["fetch"],
  },
  push: {
    name: "push",
    description: "Push to remote",
    aliases: ["upload"],
  },

  // Agent
  "coding-agent": {
    name: "coding-agent",
    description: "Switch coding agent",
    args: z.string().optional(),
    aliases: ["agent"],
  },
  model: {
    name: "model",
    description: "Switch AI model",
    args: z.string().optional(),
  },
  shell: {
    name: "shell",
    description: "Open raw shell",
    aliases: ["terminal"],
  },

  // IDE
  cursor: {
    name: "cursor",
    description: "Open in Cursor",
  },
  windsurf: {
    name: "windsurf",
    description: "Open in Windsurf",
  },
  vscode: {
    name: "vscode",
    description: "Open in VS Code",
    aliases: ["code"],
  },
  ide: {
    name: "ide",
    description: "Open in default IDE",
  },

  // Utility
  clear: {
    name: "clear",
    description: "Clear screen",
    aliases: ["cls"],
  },
  reload: {
    name: "reload",
    description: "Reload current view",
    aliases: ["refresh"],
  },
  logs: {
    name: "logs",
    description: "Toggle logs panel",
  },
  feedback: {
    name: "feedback",
    description: "Send feedback",
  },
  quit: {
    name: "quit",
    description: "Exit application",
    aliases: ["exit", "q"],
  },
};

// ============================================================================
// Parsing
// ============================================================================

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  // Remove leading slash
  const content = trimmed.slice(1);
  if (!content) return null;

  // Tokenize
  const tokens = tokenize(content);
  if (tokens.length === 0) return null;

  // First token is the command
  const command = tokens[0]!.toLowerCase();

  // Parse remaining tokens as args and flags
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token.startsWith("--")) {
      // Long flag: --name or --name=value
      const flagContent = token.slice(2);
      const eqIdx = flagContent.indexOf("=");
      if (eqIdx >= 0) {
        const name = flagContent.slice(0, eqIdx);
        const value = flagContent.slice(eqIdx + 1);
        flags[name] = value;
      } else {
        // Check if next token is a value (not a flag)
        if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith("-")) {
          flags[flagContent] = tokens[i + 1]!;
          i++; // Skip value token
        } else {
          flags[flagContent] = true;
        }
      }
    } else if (token.startsWith("-") && token.length === 2) {
      // Short flag: -n (with optional next token as value)
      const name = token.slice(1);
      // Check if next token is a value (not a flag)
      if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith("-")) {
        flags[name] = tokens[i + 1]!;
        i++; // Skip value token
      } else {
        flags[name] = true;
      }
    } else {
      // Positional argument
      args.push(token);
    }
  }

  return { command, args, flags };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// ============================================================================
// Resolution
// ============================================================================

export function resolveCommand(name: string): SlashCommandDef | null {
  const lowered = name.toLowerCase();

  // Direct match
  if (SLASH_COMMANDS[lowered]) {
    return SLASH_COMMANDS[lowered] ?? null;
  }

  // Search aliases
  for (const def of Object.values(SLASH_COMMANDS)) {
    if (def.aliases?.includes(lowered)) {
      return def;
    }
  }

  return null;
}

export function getSlashSuggestions(partial: string, limit = 5): SlashCommandDef[] {
  const lowered = partial.toLowerCase();
  const results: SlashCommandDef[] = [];

  for (const def of Object.values(SLASH_COMMANDS)) {
    if (def.name.startsWith(lowered)) {
      results.push(def);
    } else if (def.aliases?.some((a) => a.startsWith(lowered))) {
      results.push(def);
    }
  }

  // Sort by name length (shorter = more relevant)
  results.sort((a, b) => a.name.length - b.name.length);

  return results.slice(0, limit);
}

export function getAllSlashCommands(): SlashCommandDef[] {
  return Object.values(SLASH_COMMANDS);
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  parsedArgs?: unknown;
  parsedFlags?: unknown;
}

export function validateSlashCommand(
  parsed: SlashCommand,
  def: SlashCommandDef,
): ValidationResult {
  const errors: string[] = [];
  let parsedArgs: unknown = undefined;
  let parsedFlags: unknown = undefined;

  // Validate args if schema defined
  if (def.args) {
    // For now, treat first arg as the main argument
    const argValue = parsed.args[0];
    try {
      parsedArgs = def.args.parse(argValue);
    } catch (e) {
      if (e instanceof z.ZodError) {
        errors.push(...e.errors.map((err) => err.message));
      } else {
        errors.push("Invalid argument");
      }
    }
  }

  // Validate flags if schema defined
  if (def.flags) {
    try {
      parsedFlags = def.flags.parse(parsed.flags);
    } catch (e) {
      if (e instanceof z.ZodError) {
        errors.push(...e.errors.map((err) => `${err.path.join(".")}: ${err.message}`));
      } else {
        errors.push("Invalid flags");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsedArgs,
    parsedFlags,
  };
}

// ============================================================================
// Formatting
// ============================================================================

export function formatSlashCommand(def: SlashCommandDef): string {
  let result = `/${def.name}`;

  if (def.aliases && def.aliases.length > 0) {
    result += ` (${def.aliases.map((a) => "/" + a).join(", ")})`;
  }

  return result;
}

export function formatSlashHelp(def: SlashCommandDef): string {
  const lines: string[] = [];

  lines.push(`/${def.name} - ${def.description}`);

  if (def.aliases && def.aliases.length > 0) {
    lines.push(`  Aliases: ${def.aliases.map((a) => "/" + a).join(", ")}`);
  }

  return lines.join("\n");
}
