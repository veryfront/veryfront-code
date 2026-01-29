// Vim Keybindings Module
// Handles vim-style navigation: hjkl, gg/G, Ctrl+D/U, number prefixes, key chords

import type { KeyChordState } from "./types.ts";

// ============================================================================
// Key Constants
// ============================================================================

export const VIM_KEYS = {
  UP: "k",
  DOWN: "j",
  LEFT: "h",
  RIGHT: "l",
} as const;

export const ARROW_KEYS = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
} as const;

export const CTRL_KEYS = {
  D: "\x04", // Ctrl+D - page down
  U: "\x15", // Ctrl+U - page up
  C: "\x03", // Ctrl+C - quit
  A: "\x01", // Ctrl+A - agent picker
  P: "\x10", // Ctrl+P - search
} as const;

export const CHORD_PREFIX = {
  GO_TO: "g",
} as const;

export const CHORD_TIMEOUT = 500;

// ============================================================================
// Key Chord State Management
// ============================================================================

export function startChord(prefix: string): KeyChordState {
  return {
    pending: prefix,
    startTime: Date.now(),
    count: null,
  };
}

export function setChordCount(state: KeyChordState, count: number): KeyChordState {
  return { ...state, count };
}

export function addDigitToCount(state: KeyChordState, digit: number): KeyChordState {
  const currentCount = state.count ?? 0;
  return { ...state, count: currentCount * 10 + digit };
}

export function clearChord(): KeyChordState {
  return {
    pending: null,
    startTime: null,
    count: null,
  };
}

export function isChordTimedOut(state: KeyChordState): boolean {
  if (!state.pending || !state.startTime) return false;
  return Date.now() - state.startTime > CHORD_TIMEOUT;
}

export function getEffectiveCount(state: KeyChordState): number {
  return state.count ?? 1;
}

// ============================================================================
// Key Parsing
// ============================================================================

export interface ParsedKey {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  isArrow: boolean;
  isDigit: boolean;
  digit: number | null;
}

export function parseKey(raw: string): ParsedKey {
  // Check for Ctrl keys (single byte < 0x20, except some special)
  const charCode = raw.charCodeAt(0);
  if (raw.length === 1 && charCode >= 1 && charCode <= 26) {
    return {
      key: String.fromCharCode(charCode + 96), // Convert to letter
      ctrl: true,
      alt: false,
      shift: false,
      isArrow: false,
      isDigit: false,
      digit: null,
    };
  }

  // Check for arrow keys
  if (raw === ARROW_KEYS.UP) {
    return {
      key: "up",
      ctrl: false,
      alt: false,
      shift: false,
      isArrow: true,
      isDigit: false,
      digit: null,
    };
  }
  if (raw === ARROW_KEYS.DOWN) {
    return {
      key: "down",
      ctrl: false,
      alt: false,
      shift: false,
      isArrow: true,
      isDigit: false,
      digit: null,
    };
  }
  if (raw === ARROW_KEYS.LEFT) {
    return {
      key: "left",
      ctrl: false,
      alt: false,
      shift: false,
      isArrow: true,
      isDigit: false,
      digit: null,
    };
  }
  if (raw === ARROW_KEYS.RIGHT) {
    return {
      key: "right",
      ctrl: false,
      alt: false,
      shift: false,
      isArrow: true,
      isDigit: false,
      digit: null,
    };
  }

  // Check for digit
  const digit = parseInt(raw, 10);
  if (!isNaN(digit) && raw.length === 1 && digit >= 0 && digit <= 9) {
    return {
      key: raw,
      ctrl: false,
      alt: false,
      shift: raw === raw.toUpperCase() && raw !== raw.toLowerCase(),
      isArrow: false,
      isDigit: true,
      digit,
    };
  }

  // Regular key
  return {
    key: raw,
    ctrl: false,
    alt: false,
    shift: raw === raw.toUpperCase() && raw !== raw.toLowerCase(),
    isArrow: false,
    isDigit: false,
    digit: null,
  };
}

// ============================================================================
// Navigation Actions
// ============================================================================

export type Direction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "page-up"
  | "page-down";

export interface NavAction {
  direction: Direction;
  count: number;
}

export function getNavAction(parsed: ParsedKey, chord: KeyChordState): NavAction | null {
  const count = getEffectiveCount(chord);

  // Vim keys
  if (parsed.key === VIM_KEYS.UP || parsed.key === "up") {
    return { direction: "up", count };
  }
  if (parsed.key === VIM_KEYS.DOWN || parsed.key === "down") {
    return { direction: "down", count };
  }
  if (parsed.key === VIM_KEYS.LEFT || parsed.key === "left") {
    return { direction: "left", count };
  }
  if (parsed.key === VIM_KEYS.RIGHT || parsed.key === "right") {
    return { direction: "right", count };
  }

  // Ctrl+D / Ctrl+U
  if (parsed.ctrl && parsed.key === "d") {
    return { direction: "page-down", count };
  }
  if (parsed.ctrl && parsed.key === "u") {
    return { direction: "page-up", count };
  }

  // G for bottom (capital G)
  if (parsed.key === "G") {
    return { direction: "bottom", count: 1 };
  }

  return null;
}

export function getChordAction(pending: string, key: string): NavAction | string | null {
  // g + g = go to top
  if (pending === "g" && key === "g") {
    return { direction: "top", count: 1 };
  }

  // g + navigation key = go-to shortcut
  if (pending === "g" && /^[a-z]$/.test(key)) {
    return `go:${key}`; // Return as string action for navigation module
  }

  return null;
}

// ============================================================================
// Key Handler
// ============================================================================

export interface KeyHandleResult {
  navAction: NavAction | null;
  stringAction: string | null;
  chord: KeyChordState;
  consumed: boolean;
}

export function handleVimKey(raw: string, chord: KeyChordState): KeyHandleResult {
  // Check for timeout
  if (isChordTimedOut(chord)) {
    chord = clearChord();
  }

  const parsed = parseKey(raw);

  // If we have a pending chord, check for completion
  if (chord.pending) {
    const chordAction = getChordAction(chord.pending, parsed.key);
    if (chordAction) {
      if (typeof chordAction === "string") {
        return {
          navAction: null,
          stringAction: chordAction,
          chord: clearChord(),
          consumed: true,
        };
      }
      return {
        navAction: chordAction,
        stringAction: null,
        chord: clearChord(),
        consumed: true,
      };
    }
    // Chord not completed, clear it
    chord = clearChord();
  }

  // Handle digit for count prefix
  if (parsed.isDigit && parsed.digit !== null && parsed.digit > 0) {
    return {
      navAction: null,
      stringAction: null,
      chord: addDigitToCount(chord, parsed.digit),
      consumed: true,
    };
  }

  // Handle chord prefix (g)
  if (parsed.key === CHORD_PREFIX.GO_TO && !parsed.ctrl) {
    return {
      navAction: null,
      stringAction: null,
      chord: startChord(parsed.key),
      consumed: true,
    };
  }

  // Handle navigation
  const navAction = getNavAction(parsed, chord);
  if (navAction) {
    return {
      navAction,
      stringAction: null,
      chord: clearChord(),
      consumed: true,
    };
  }

  // Key not consumed by vim handler
  return {
    navAction: null,
    stringAction: null,
    chord: chord.pending ? chord : clearChord(),
    consumed: false,
  };
}

// ============================================================================
// List Navigation Helpers
// ============================================================================

export function applyNavToIndex(
  action: NavAction,
  currentIndex: number,
  totalItems: number,
  pageSize: number = 10,
): number {
  if (totalItems === 0) return 0;

  switch (action.direction) {
    case "up": {
      let newIndex = currentIndex - action.count;
      // Wrap around
      while (newIndex < 0) {
        newIndex += totalItems;
      }
      return newIndex;
    }
    case "down": {
      let newIndex = currentIndex + action.count;
      // Wrap around
      while (newIndex >= totalItems) {
        newIndex -= totalItems;
      }
      return newIndex;
    }
    case "top":
      return 0;
    case "bottom":
      return totalItems - 1;
    case "page-up": {
      const newIndex = currentIndex - pageSize * action.count;
      return Math.max(0, newIndex);
    }
    case "page-down": {
      const newIndex = currentIndex + pageSize * action.count;
      return Math.min(totalItems - 1, newIndex);
    }
    default:
      return currentIndex;
  }
}

export function calculateScrollOffset(
  index: number,
  currentOffset: number,
  visibleCount: number,
  totalItems: number,
): number {
  // Index is above visible area
  if (index < currentOffset) {
    return index;
  }
  // Index is below visible area
  if (index >= currentOffset + visibleCount) {
    return Math.min(index - visibleCount + 1, totalItems - visibleCount);
  }
  // Index is within visible area
  return currentOffset;
}
