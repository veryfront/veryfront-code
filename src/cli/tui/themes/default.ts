/**
 * Default Theme
 *
 * A balanced dark theme with cyan accents, inspired by Claude Code.
 */

import type { ColorPalette, SyntaxColors, Theme } from "./types.ts";
import { BORDER_CHARS, DEFAULT_SYMBOLS } from "./types.ts";

// ============================================================================
// Color Palette
// ============================================================================

const colors: ColorPalette = {
  primary: "cyan",
  secondary: "blue",
  accent: "magenta",

  success: "green",
  warning: "yellow",
  error: "red",
  info: "blue",

  text: {
    primary: "white",
    secondary: "gray",
    muted: "gray",
  },

  background: {
    primary: "black",
    secondary: "black",
    highlight: "cyan",
  },

  border: {
    active: "cyan",
    inactive: "gray",
  },

  selection: {
    fg: "black",
    bg: "cyan",
  },
};

// ============================================================================
// Syntax Colors
// ============================================================================

const syntax: SyntaxColors = {
  keyword: "magenta",
  string: "green",
  number: "yellow",
  comment: "gray",
  function: "blue",
  variable: "cyan",
  type: "yellow",
  operator: "white",
  added: "green",
  removed: "red",
  modified: "yellow",
};

// ============================================================================
// Theme Export
// ============================================================================

export const defaultTheme: Theme = {
  name: "default",
  description: "Balanced dark theme with cyan accents",
  colors,
  syntax,
  symbols: DEFAULT_SYMBOLS,
  borderStyle: "rounded",
  borders: BORDER_CHARS.rounded,
  isLight: false,
  colorblindFriendly: false,
};
