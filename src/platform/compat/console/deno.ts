/**
 * Deno console styling implementation using std/fmt/colors.ts
 */

import {
  blue,
  bold,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  reset,
  strikethrough,
  underline,
  white,
  yellow,
} from "std/fmt/colors.ts";

import type { ConsoleStyler } from "./types.ts";

export const colors: ConsoleStyler = {
  // Basic colors
  red,
  green,
  yellow,
  blue,
  cyan,
  magenta,
  white,
  gray,

  // Text modifiers
  bold,
  dim,
  italic,
  underline,
  strikethrough,

  // Utility
  reset,
};

// Re-export individual functions for convenience
export {
  blue,
  bold,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  reset,
  strikethrough,
  underline,
  white,
  yellow,
};
