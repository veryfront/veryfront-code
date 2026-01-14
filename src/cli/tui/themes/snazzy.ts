/**
 * Snazzy Theme
 *
 * Vibrant, modern dark theme inspired by Snazzy/Hyper themes.
 * High contrast with bold colors.
 */

import type { ColorPalette, SyntaxColors, Theme } from "./types.ts";
import { BORDER_CHARS, DEFAULT_SYMBOLS } from "./types.ts";

// ============================================================================
// Color Palette
// ============================================================================

const colors: ColorPalette = {
  primary: "cyan",
  secondary: "magenta",
  accent: "yellow",

  success: "green",
  warning: "yellow",
  error: "red",
  info: "cyan",

  text: {
    primary: "white",
    secondary: "gray",
    muted: "gray",
  },

  background: {
    primary: "black",
    secondary: "black",
    highlight: "magenta",
  },

  border: {
    active: "magenta",
    inactive: "gray",
  },

  selection: {
    fg: "black",
    bg: "magenta",
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
  function: "cyan",
  variable: "white",
  type: "yellow",
  operator: "magenta",
  added: "green",
  removed: "red",
  modified: "yellow",
};

// ============================================================================
// Theme Export
// ============================================================================

export const snazzyTheme: Theme = {
  name: "snazzy",
  description: "Vibrant modern dark theme with bold colors",
  colors,
  syntax,
  symbols: DEFAULT_SYMBOLS,
  borderStyle: "rounded",
  borders: BORDER_CHARS.rounded,
  isLight: false,
  colorblindFriendly: false,
};
