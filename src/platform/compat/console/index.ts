/**
 * Cross-runtime console styling
 *
 * Provides terminal colors that work in Deno, Node.js, and Bun.
 * Selects its implementation synchronously so first and later calls behave the same.
 * Falls back to no-op functions in environments without terminal support.
 */

import { colors as ansiColors } from "./ansi.ts";
import { selectConsoleStyler } from "./support.ts";
import type { ConsoleStyler } from "./types.ts";

export type { ColorFunction, ConsoleStyler } from "./types.ts";

export const colors: ConsoleStyler = selectConsoleStyler(ansiColors);

export const {
  red,
  green,
  yellow,
  blue,
  cyan,
  magenta,
  white,
  gray,
  bold,
  dim,
  italic,
  underline,
  strikethrough,
  reset,
} = colors;

/** Compatibility promise for callers that previously awaited color initialization. */
export const colorsPromise: Promise<ConsoleStyler> = Promise.resolve(colors);
