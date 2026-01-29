// Command Registry Module
// Manages command definitions, categories, lookup, and fuzzy matching

import type { CommandCategory, CommandDef } from "./types.ts";

// ============================================================================
// Default Commands
// ============================================================================

export const DEFAULT_COMMANDS: CommandDef[] = [
  // Navigation
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Go to dashboard",
    category: "navigation",
    shortcut: "gd",
    aliases: ["home", "main"],
  },
  {
    id: "settings",
    name: "Settings",
    description: "Open settings",
    category: "navigation",
    shortcut: "gs",
    aliases: ["config", "preferences"],
  },
  {
    id: "help",
    name: "Help",
    description: "Show help",
    category: "navigation",
    shortcut: "?",
    aliases: ["?", "man"],
  },
  {
    id: "resources",
    name: "Resources",
    description: "View project resources",
    category: "navigation",
    shortcut: "gr",
    aliases: ["files", "tree"],
  },

  // Project
  {
    id: "new",
    name: "New Project",
    description: "Create a new project",
    category: "project",
    shortcut: "n",
    aliases: ["create", "init"],
  },
  {
    id: "deploy",
    name: "Deploy",
    description: "Deploy to production",
    category: "project",
    shortcut: "D",
    aliases: ["publish", "ship"],
  },
  {
    id: "deploy:staging",
    name: "Deploy to Staging",
    description: "Deploy to staging environment",
    category: "project",
  },
  {
    id: "deploy:preview",
    name: "Deploy Preview",
    description: "Deploy a preview build",
    category: "project",
  },
  {
    id: "pull",
    name: "Pull",
    description: "Pull project from remote",
    category: "project",
    shortcut: "p",
    aliases: ["fetch", "sync"],
  },
  {
    id: "push",
    name: "Push",
    description: "Push project to remote",
    category: "project",
    shortcut: "u",
    aliases: ["upload"],
  },

  // Server
  {
    id: "restart",
    name: "Restart Server",
    description: "Restart the dev server",
    category: "server",
    aliases: ["reload"],
  },
  {
    id: "clean",
    name: "Clean Cache",
    description: "Clear project cache",
    category: "server",
    aliases: ["clear"],
  },
  {
    id: "doctor",
    name: "Doctor",
    description: "Check system health",
    category: "server",
    aliases: ["health", "check"],
  },

  // Agent
  {
    id: "coding-agent",
    name: "Switch Coding Agent",
    description: "Change the active coding agent",
    category: "agent",
    aliases: ["agent", "claude", "codex"],
  },
  {
    id: "model",
    name: "Switch Model",
    description: "Change the AI model",
    category: "agent",
    aliases: ["llm"],
  },
  {
    id: "shell",
    name: "Open Shell",
    description: "Open a raw shell (no agent)",
    category: "agent",
    aliases: ["terminal", "bash", "zsh"],
  },

  // Files
  {
    id: "generate:page",
    name: "Generate Page",
    description: "Create a new page",
    category: "files",
    aliases: ["new:page", "add:page"],
  },
  {
    id: "generate:api",
    name: "Generate API",
    description: "Create a new API route",
    category: "files",
    aliases: ["new:api", "add:api"],
  },
  {
    id: "generate:component",
    name: "Generate Component",
    description: "Create a new component",
    category: "files",
    aliases: ["new:component", "add:component"],
  },

  // Utility
  {
    id: "clear",
    name: "Clear Screen",
    description: "Clear the terminal",
    category: "utility",
    aliases: ["cls"],
  },
  {
    id: "logs",
    name: "Toggle Logs",
    description: "Show/hide logs panel",
    category: "utility",
    shortcut: "l",
  },
  {
    id: "feedback",
    name: "Send Feedback",
    description: "Report an issue or send feedback",
    category: "utility",
  },
  {
    id: "quit",
    name: "Quit",
    description: "Exit the application",
    category: "utility",
    shortcut: "q",
    aliases: ["exit", "bye"],
  },
];

// ============================================================================
// Command Registry
// ============================================================================

export interface CommandRegistry {
  commands: CommandDef[];
  byId: Map<string, CommandDef>;
  byCategory: Map<CommandCategory, CommandDef[]>;
  byAlias: Map<string, CommandDef>;
}

export function createRegistry(commands: CommandDef[] = DEFAULT_COMMANDS): CommandRegistry {
  const byId = new Map<string, CommandDef>();
  const byCategory = new Map<CommandCategory, CommandDef[]>();
  const byAlias = new Map<string, CommandDef>();

  for (const cmd of commands) {
    byId.set(cmd.id, cmd);

    // Index by category
    const categoryList = byCategory.get(cmd.category) ?? [];
    categoryList.push(cmd);
    byCategory.set(cmd.category, categoryList);

    // Index by aliases
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        byAlias.set(alias.toLowerCase(), cmd);
      }
    }

    // Also index by id as alias
    byAlias.set(cmd.id.toLowerCase(), cmd);
    byAlias.set(cmd.name.toLowerCase(), cmd);
  }

  return { commands, byId, byCategory, byAlias };
}

export function getCommand(registry: CommandRegistry, id: string): CommandDef | undefined {
  return registry.byId.get(id);
}

export function findCommand(registry: CommandRegistry, query: string): CommandDef | undefined {
  const normalized = query.toLowerCase().trim();
  return registry.byAlias.get(normalized);
}

export function getCategory(
  registry: CommandRegistry,
  category: CommandCategory,
): CommandDef[] {
  return registry.byCategory.get(category) ?? [];
}

export function getCategories(registry: CommandRegistry): CommandCategory[] {
  return Array.from(registry.byCategory.keys());
}

// ============================================================================
// Fuzzy Matching
// ============================================================================

export interface CommandMatch {
  command: CommandDef;
  score: number;
  matches: Array<[number, number]>;
}

export function fuzzyScore(
  pattern: string,
  text: string,
): { score: number; matches: Array<[number, number]> } {
  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact match at start - highest score
  if (textLower.startsWith(patternLower)) {
    return { score: 100, matches: [[0, pattern.length]] };
  }

  // Exact match anywhere
  const exactIdx = textLower.indexOf(patternLower);
  if (exactIdx >= 0) {
    return { score: 80 - exactIdx, matches: [[exactIdx, exactIdx + pattern.length]] };
  }

  // Character-by-character fuzzy match
  let patternIdx = 0;
  let score = 0;
  let consecutiveBonus = 0;
  let lastMatchIdx = -2;
  const matches: Array<[number, number]> = [];
  let matchStart = -1;

  for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIdx]) {
      // Match found
      if (matchStart === -1) matchStart = i;

      score += 10;

      // Bonus for consecutive matches
      if (i === lastMatchIdx + 1) {
        consecutiveBonus += 5;
        score += consecutiveBonus;
      } else {
        // End previous match range
        if (matchStart !== -1 && matchStart !== i) {
          matches.push([matchStart, lastMatchIdx + 1]);
          matchStart = i;
        }
        consecutiveBonus = 0;
      }

      // Bonus for matching at word boundaries
      if (
        i === 0 || textLower[i - 1] === " " || textLower[i - 1] === "-" || textLower[i - 1] === ":"
      ) {
        score += 15;
      }

      lastMatchIdx = i;
      patternIdx++;
    }
  }

  // End final match range
  if (matchStart !== -1 && patternIdx > 0) {
    matches.push([matchStart, lastMatchIdx + 1]);
  }

  // All pattern characters must match
  if (patternIdx < patternLower.length) {
    return { score: 0, matches: [] };
  }

  // Bonus for shorter text (more relevant match)
  score += Math.max(0, 20 - text.length);

  return { score, matches };
}

export function searchCommands(
  registry: CommandRegistry,
  query: string,
  limit = 10,
): CommandMatch[] {
  if (!query.trim()) {
    // Return all commands sorted by category
    return registry.commands.slice(0, limit).map((cmd) => ({
      command: cmd,
      score: 50,
      matches: [],
    }));
  }

  const results: CommandMatch[] = [];

  for (const cmd of registry.commands) {
    // Score against name
    const nameMatch = fuzzyScore(query, cmd.name);
    let bestScore = nameMatch.score;
    let bestMatches = nameMatch.matches;

    // Score against id
    const idMatch = fuzzyScore(query, cmd.id);
    if (idMatch.score > bestScore) {
      bestScore = idMatch.score;
      bestMatches = idMatch.matches;
    }

    // Score against aliases
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        const aliasMatch = fuzzyScore(query, alias);
        if (aliasMatch.score > bestScore) {
          bestScore = aliasMatch.score;
          bestMatches = aliasMatch.matches;
        }
      }
    }

    if (bestScore > 0) {
      results.push({
        command: cmd,
        score: bestScore,
        matches: bestMatches,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

export function getCompletions(
  registry: CommandRegistry,
  partial: string,
  limit = 5,
): string[] {
  const matches = searchCommands(registry, partial, limit);
  return matches.map((m) => m.command.id);
}

// ============================================================================
// Command History
// ============================================================================

export interface CommandHistory {
  entries: string[];
  maxSize: number;
  position: number;
}

export function createHistory(maxSize = 100): CommandHistory {
  return {
    entries: [],
    maxSize,
    position: -1,
  };
}

export function addToHistory(history: CommandHistory, command: string): CommandHistory {
  // Don't add empty or duplicate of last
  if (!command.trim()) return history;
  if (history.entries[0] === command) return { ...history, position: -1 };

  const entries = [command, ...history.entries.slice(0, history.maxSize - 1)];
  return { ...history, entries, position: -1 };
}

export function historyUp(
  history: CommandHistory,
): { history: CommandHistory; command: string | null } {
  if (history.entries.length === 0) {
    return { history, command: null };
  }

  const newPosition = Math.min(history.position + 1, history.entries.length - 1);
  return {
    history: { ...history, position: newPosition },
    command: history.entries[newPosition] ?? null,
  };
}

export function historyDown(
  history: CommandHistory,
): { history: CommandHistory; command: string | null } {
  if (history.position <= 0) {
    return {
      history: { ...history, position: -1 },
      command: null,
    };
  }

  const newPosition = history.position - 1;
  return {
    history: { ...history, position: newPosition },
    command: history.entries[newPosition] ?? null,
  };
}

export function resetHistoryPosition(history: CommandHistory): CommandHistory {
  return { ...history, position: -1 };
}
