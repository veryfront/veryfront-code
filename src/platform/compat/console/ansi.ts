/**
 * Pure ANSI escape code colors for npm/Node.js builds
 *
 * This file provides a zero-dependency color implementation using ANSI codes.
 * It's used in npm builds where std/fmt/colors.ts isn't available.
 */

import type { ColorFunction, ConsoleStyler } from "./types.ts";

const ansi = (open: number, close: number): ColorFunction => (text: string) =>
  `\x1b[${open}m${text}\x1b[${close}m`;

export const red: ColorFunction = ansi(31, 39);
export const green: ColorFunction = ansi(32, 39);
export const yellow: ColorFunction = ansi(33, 39);
export const blue: ColorFunction = ansi(34, 39);
export const magenta: ColorFunction = ansi(35, 39);
export const cyan: ColorFunction = ansi(36, 39);
export const white: ColorFunction = ansi(37, 39);
export const gray: ColorFunction = ansi(90, 39);
export const bold: ColorFunction = ansi(1, 22);
export const dim: ColorFunction = ansi(2, 22);
export const italic: ColorFunction = ansi(3, 23);
export const underline: ColorFunction = ansi(4, 24);
export const strikethrough: ColorFunction = ansi(9, 29);
export const reset: ColorFunction = (text: string) => `\x1b[0m${text}`;

export const colors: ConsoleStyler = {
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
};
