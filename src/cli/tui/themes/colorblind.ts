/**
 * Colorblind-Friendly Theme
 *
 * Uses shapes, patterns, and high-contrast colors that work
 * for most types of color blindness (deuteranopia, protanopia, tritanopia).
 */

import type { ColorPalette, SymbolSet, SyntaxColors, Theme } from "./types.ts";
import { BORDER_CHARS, DEFAULT_SYMBOLS } from "./types.ts";

// ============================================================================
// Colorblind-Optimized Symbols
// ============================================================================

const colorblindSymbols: SymbolSet = {
  ...DEFAULT_SYMBOLS,
  // Use shapes + text for status indicators
  success: "[+]",
  error: "[X]",
  warning: "[!]",
  info: "[i]",
  question: "[?]",
  // Distinct shapes for checkboxes
  checkboxOn: "[*]",
  checkboxOff: "[ ]",
  radioOn: "(*)",
  radioOff: "( )",
  // High contrast progress
  progressFilled: "#",
  progressEmpty: ".",
};

// ============================================================================
// Color Palette
// ============================================================================

// Uses blue/orange which is distinguishable by most colorblind types
const colors: ColorPalette = {
  primary: "cyan", // Blue family - safe
  secondary: "blue",
  accent: "yellow", // Orange/yellow - safe

  success: "cyan", // Blue instead of green
  warning: "yellow", // Yellow for warning
  error: "magenta", // Magenta instead of red (more visible)
  info: "blue",

  text: {
    primary: "white",
    secondary: "gray",
    muted: "gray",
  },

  background: {
    primary: "black",
    secondary: "black",
    highlight: "yellow",
  },

  border: {
    active: "cyan",
    inactive: "gray",
  },

  selection: {
    fg: "black",
    bg: "yellow",
  },
};

// ============================================================================
// Syntax Colors
// ============================================================================

// Avoid red/green, use blue/orange/purple distinctions
const syntax: SyntaxColors = {
  keyword: "magenta",
  string: "cyan", // Blue instead of green
  number: "yellow",
  comment: "gray",
  function: "blue",
  variable: "white",
  type: "yellow",
  operator: "white",
  added: "cyan", // Blue instead of green
  removed: "magenta", // Magenta instead of red
  modified: "yellow",
};

// ============================================================================
// Theme Export
// ============================================================================

export const colorblindTheme: Theme = {
  name: "colorblind",
  description: "High-contrast theme optimized for colorblind users",
  colors,
  syntax,
  symbols: colorblindSymbols,
  borderStyle: "single", // Single line borders for clearer distinction
  borders: BORDER_CHARS.single,
  isLight: false,
  colorblindFriendly: true,
};
