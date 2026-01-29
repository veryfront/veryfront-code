// Mode System Module
// Vim-style mode management for the TUI with transitions, indicators, and key dispatch

import type { Mode } from "./types.ts";

// ============================================================================
// Mode Transitions
// ============================================================================

const TRANSITIONS: Record<Mode, Mode[]> = {
  NORMAL: ["COMMAND", "SEARCH", "INSERT"],
  COMMAND: ["NORMAL"],
  SEARCH: ["NORMAL"],
  INSERT: ["NORMAL"],
};

export function canTransition(from: Mode, to: Mode): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(current: Mode, target: Mode): Mode {
  if (canTransition(current, target)) {
    return target;
  }
  return current;
}

export function exitToNormal(): Mode {
  return "NORMAL";
}

export function enterCommand(current: Mode): Mode {
  return transition(current, "COMMAND");
}

export function enterSearch(current: Mode): Mode {
  return transition(current, "SEARCH");
}

export function enterInsert(current: Mode): Mode {
  return transition(current, "INSERT");
}

// ============================================================================
// Mode Detection by Key
// ============================================================================

export const COMMAND_KEY = ":";
export const SEARCH_KEY = "/";
export const SEARCH_CTRL_KEY = "p";
export const ESCAPE_KEY = "\x1b";

export function getModeFromKey(key: string, ctrlPressed: boolean): Mode | null {
  if (key === ESCAPE_KEY) return "NORMAL";
  if (key === COMMAND_KEY) return "COMMAND";
  if (key === SEARCH_KEY) return "SEARCH";
  if (ctrlPressed && key.toLowerCase() === SEARCH_CTRL_KEY) return "SEARCH";
  return null;
}

export function shouldExitMode(key: string, mode: Mode): boolean {
  if (mode === "NORMAL") return false;
  return key === ESCAPE_KEY;
}

// ============================================================================
// Mode Indicators
// ============================================================================

export const MODE_LABELS: Record<Mode, string> = {
  NORMAL: "NORMAL",
  COMMAND: "COMMAND",
  SEARCH: "SEARCH",
  INSERT: "INSERT",
};

export const MODE_COLORS: Record<Mode, string> = {
  NORMAL: "\x1b[32m", // Green
  COMMAND: "\x1b[33m", // Yellow
  SEARCH: "\x1b[36m", // Cyan
  INSERT: "\x1b[35m", // Magenta
};

const RESET = "\x1b[0m";

export function getModeIndicator(mode: Mode): string {
  const color = MODE_COLORS[mode];
  const label = MODE_LABELS[mode];
  return `${color}${label}${RESET}`;
}

export function getModeDisplay(mode: Mode): string {
  switch (mode) {
    case "COMMAND":
      return ":";
    case "SEARCH":
      return "/";
    case "INSERT":
      return ">";
    default:
      return "";
  }
}

// ============================================================================
// State Updaters (Functional Pattern)
// ============================================================================

export interface ModeState {
  mode: Mode;
}

export type ModeUpdater<T extends ModeState> = (state: T) => T;

export function setMode<T extends ModeState>(mode: Mode): ModeUpdater<T> {
  return (state) => ({ ...state, mode });
}

export function transitionMode<T extends ModeState>(target: Mode): ModeUpdater<T> {
  return (state) => ({
    ...state,
    mode: transition(state.mode, target),
  });
}

export function exitMode<T extends ModeState>(): ModeUpdater<T> {
  return (state) => ({ ...state, mode: "NORMAL" });
}

export function handleModeKey<T extends ModeState>(
  key: string,
  ctrlPressed = false,
): ModeUpdater<T> | null {
  const newMode = getModeFromKey(key, ctrlPressed);
  if (newMode === null) return null;
  return transitionMode(newMode);
}
