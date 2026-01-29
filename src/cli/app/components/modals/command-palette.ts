/**
 * Command Palette Modal Component
 *
 * A fuzzy search interface for commands, similar to VS Code's command palette.
 * Triggered by ':' key in NORMAL mode.
 */

import { box } from "../../../ui/box.ts";
import { brand, dim, muted } from "../../../ui/colors.ts";
import { truncate, visibleLength } from "../../../ui/layout.ts";
import type { CommandDef, CommandPaletteState } from "../../core/types.ts";
import { type CommandRegistry, createRegistry, searchCommands } from "../../core/commands.ts";

// ============================================================================
// State Management
// ============================================================================

export type CommandPaletteUpdater = (state: CommandPaletteState) => CommandPaletteState;

/** Default command registry */
let defaultRegistry: CommandRegistry | null = null;

function getDefaultRegistry(): CommandRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createRegistry();
  }
  return defaultRegistry;
}

/**
 * Open command palette
 */
export function openCommandPalette(registry?: CommandRegistry): CommandPaletteUpdater {
  const reg = registry ?? getDefaultRegistry();
  const results = searchCommands(reg, "");

  return () => ({
    open: true,
    query: "",
    selectedIndex: 0,
    filteredCommands: results.map((r) => r.command),
  });
}

/**
 * Close command palette
 */
export function closeCommandPalette(): CommandPaletteUpdater {
  return () => ({
    open: false,
    query: "",
    selectedIndex: 0,
    filteredCommands: [],
  });
}

/**
 * Update query and filter commands
 */
export function updateQuery(query: string, registry?: CommandRegistry): CommandPaletteUpdater {
  const reg = registry ?? getDefaultRegistry();
  const results = searchCommands(reg, query);

  return (state) => ({
    ...state,
    query,
    selectedIndex: 0,
    filteredCommands: results.map((r) => r.command),
  });
}

/**
 * Move selection up
 */
export function moveSelectionUp(): CommandPaletteUpdater {
  return (state) => {
    if (state.filteredCommands.length === 0) return state;
    const newIndex = state.selectedIndex > 0
      ? state.selectedIndex - 1
      : state.filteredCommands.length - 1;
    return { ...state, selectedIndex: newIndex };
  };
}

/**
 * Move selection down
 */
export function moveSelectionDown(): CommandPaletteUpdater {
  return (state) => {
    if (state.filteredCommands.length === 0) return state;
    const newIndex = state.selectedIndex < state.filteredCommands.length - 1
      ? state.selectedIndex + 1
      : 0;
    return { ...state, selectedIndex: newIndex };
  };
}

/**
 * Get currently selected command
 */
export function getSelectedCommand(state: CommandPaletteState): CommandDef | null {
  return state.filteredCommands[state.selectedIndex] ?? null;
}

// ============================================================================
// Rendering
// ============================================================================

/** Max visible items in palette */
const MAX_VISIBLE_ITEMS = 10;

/**
 * Render command palette
 */
export function renderCommandPalette(
  state: CommandPaletteState,
  width = 60,
): string {
  if (!state.open) return "";

  const lines: string[] = [];

  // Input line
  const inputPrefix = ": ";
  const cursor = brand("_");
  const inputLine = `${inputPrefix}${state.query}${cursor}`;
  lines.push(inputLine);

  // Divider
  lines.push(dim("─".repeat(width - 4)));

  // Commands
  if (state.filteredCommands.length === 0) {
    lines.push(dim("  No matching commands"));
  } else {
    const start = Math.max(0, state.selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2));
    const end = Math.min(start + MAX_VISIBLE_ITEMS, state.filteredCommands.length);
    const visible = state.filteredCommands.slice(start, end);

    for (let i = 0; i < visible.length; i++) {
      const cmd = visible[i]!;
      const actualIndex = start + i;
      const isSelected = actualIndex === state.selectedIndex;

      const indicator = isSelected ? brand("›") : " ";
      const name = isSelected ? cmd.name : dim(cmd.name);
      const description = truncate(cmd.description, width - 30);
      const shortcut = cmd.shortcut ? dim(`[${cmd.shortcut}]`) : "";

      const line = `${indicator} ${name}${shortcut ? " " + shortcut : ""}`;
      const paddedLine = line.padEnd(25);

      lines.push(`${paddedLine}${dim(description)}`);
    }

    // Scroll indicators
    if (start > 0) {
      lines.unshift(dim("  ↑ more"));
    }
    if (end < state.filteredCommands.length) {
      lines.push(dim("  ↓ more"));
    }
  }

  // Divider
  lines.push(dim("─".repeat(width - 4)));

  // Help line
  lines.push(muted("↑↓ select  Enter run  Tab complete  Esc close"));

  const content = lines.join("\n");

  return box(content, {
    style: "rounded",
    width,
    padding: 1,
  });
}

/**
 * Render command palette centered on screen
 */
export function renderCommandPaletteCentered(
  state: CommandPaletteState,
  termWidth: number,
  termHeight: number,
): string {
  if (!state.open) return "";

  const paletteWidth = Math.min(60, termWidth - 4);
  const dialogContent = renderCommandPalette(state, paletteWidth);
  const dialogLines = dialogContent.split("\n");
  const _dialogHeight = dialogLines.length;
  const dialogWidth = Math.max(...dialogLines.map(visibleLength));

  // Position near top (like VS Code)
  const topPadding = Math.max(2, Math.floor(termHeight * 0.15));
  const leftPadding = Math.max(0, Math.floor((termWidth - dialogWidth) / 2));

  const output: string[] = [];

  for (let i = 0; i < topPadding; i++) {
    output.push("");
  }

  const padStr = " ".repeat(leftPadding);
  for (const line of dialogLines) {
    output.push(padStr + line);
  }

  return output.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

/** Result from handling key */
export interface PaletteKeyResult {
  handled: boolean;
  close: boolean;
  executeCommand?: CommandDef;
  updater?: CommandPaletteUpdater;
}

/**
 * Handle key press in command palette
 */
export function handleCommandPaletteKey(
  key: string,
  state: CommandPaletteState,
  registry?: CommandRegistry,
): PaletteKeyResult {
  if (!state.open) {
    return { handled: false, close: false };
  }

  // Escape - close
  if (key === "\x1b") {
    return { handled: true, close: true, updater: closeCommandPalette() };
  }

  // Enter - execute selected
  if (key === "\r" || key === "\n") {
    const cmd = getSelectedCommand(state);
    if (cmd) {
      return {
        handled: true,
        close: true,
        executeCommand: cmd,
        updater: closeCommandPalette(),
      };
    }
    return { handled: true, close: false };
  }

  // Tab - complete (fill query with selected command)
  if (key === "\t") {
    const cmd = getSelectedCommand(state);
    if (cmd) {
      return {
        handled: true,
        close: false,
        updater: updateQuery(cmd.id, registry),
      };
    }
    return { handled: true, close: false };
  }

  // Up arrow or Ctrl+P
  if (key === "\x1b[A" || key === "\x10") {
    return { handled: true, close: false, updater: moveSelectionUp() };
  }

  // Down arrow or Ctrl+N
  if (key === "\x1b[B" || key === "\x0e") {
    return { handled: true, close: false, updater: moveSelectionDown() };
  }

  // Backspace
  if (key === "\x7f" || key === "\b") {
    if (state.query.length > 0) {
      const newQuery = state.query.slice(0, -1);
      return { handled: true, close: false, updater: updateQuery(newQuery, registry) };
    }
    return { handled: true, close: false };
  }

  // Ctrl+U - clear input
  if (key === "\x15") {
    return { handled: true, close: false, updater: updateQuery("", registry) };
  }

  // Regular character input
  if (key.length === 1 && key >= " " && key <= "~") {
    const newQuery = state.query + key;
    return { handled: true, close: false, updater: updateQuery(newQuery, registry) };
  }

  return { handled: true, close: false }; // Consume key
}
