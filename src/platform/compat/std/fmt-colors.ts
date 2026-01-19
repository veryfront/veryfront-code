/**
 * Portable @std/fmt/colors shim for Node.js and Bun.
 *
 * In Deno: Uses @std/fmt/colors
 * In Node.js/Bun: Provides ANSI escape code implementations
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

// ============================================================================
// Types
// ============================================================================

type ColorFn = (str: string) => string;

// ============================================================================
// Node.js/Bun implementation using ANSI escape codes
// ============================================================================

function createColor(open: number, close: number): ColorFn {
  return (str: string) => `\x1b[${open}m${str}\x1b[${close}m`;
}

const nodeColors = {
  // Foreground colors
  red: createColor(31, 39),
  green: createColor(32, 39),
  yellow: createColor(33, 39),
  blue: createColor(34, 39),
  magenta: createColor(35, 39),
  cyan: createColor(36, 39),
  white: createColor(37, 39),
  gray: createColor(90, 39),
  black: createColor(30, 39),

  // Bright foreground colors
  brightRed: createColor(91, 39),
  brightGreen: createColor(92, 39),
  brightYellow: createColor(93, 39),
  brightBlue: createColor(94, 39),
  brightMagenta: createColor(95, 39),
  brightCyan: createColor(96, 39),
  brightWhite: createColor(97, 39),

  // Background colors
  bgRed: createColor(41, 49),
  bgGreen: createColor(42, 49),
  bgYellow: createColor(43, 49),
  bgBlue: createColor(44, 49),
  bgMagenta: createColor(45, 49),
  bgCyan: createColor(46, 49),
  bgWhite: createColor(47, 49),
  bgBlack: createColor(40, 49),

  // Modifiers
  bold: createColor(1, 22),
  dim: createColor(2, 22),
  italic: createColor(3, 23),
  underline: createColor(4, 24),
  inverse: createColor(7, 27),
  hidden: createColor(8, 28),
  strikethrough: createColor(9, 29),

  // Reset
  reset: (str: string) => `\x1b[0m${str}\x1b[0m`,
};

// ============================================================================
// Exports
// ============================================================================

export let red: ColorFn;
export let green: ColorFn;
export let yellow: ColorFn;
export let blue: ColorFn;
export let magenta: ColorFn;
export let cyan: ColorFn;
export let white: ColorFn;
export let gray: ColorFn;
export let black: ColorFn;
export let brightRed: ColorFn;
export let brightGreen: ColorFn;
export let brightYellow: ColorFn;
export let brightBlue: ColorFn;
export let brightMagenta: ColorFn;
export let brightCyan: ColorFn;
export let brightWhite: ColorFn;
export let bgRed: ColorFn;
export let bgGreen: ColorFn;
export let bgYellow: ColorFn;
export let bgBlue: ColorFn;
export let bgMagenta: ColorFn;
export let bgCyan: ColorFn;
export let bgWhite: ColorFn;
export let bgBlack: ColorFn;
export let bold: ColorFn;
export let dim: ColorFn;
export let italic: ColorFn;
export let underline: ColorFn;
export let inverse: ColorFn;
export let hidden: ColorFn;
export let strikethrough: ColorFn;
export let reset: ColorFn;

if (isDeno) {
  // Deno: Use @std/fmt/colors
  const stdColors = await import("@std/fmt/colors");
  red = stdColors.red;
  green = stdColors.green;
  yellow = stdColors.yellow;
  blue = stdColors.blue;
  magenta = stdColors.magenta;
  cyan = stdColors.cyan;
  white = stdColors.white;
  gray = stdColors.gray;
  black = stdColors.black;
  brightRed = stdColors.brightRed;
  brightGreen = stdColors.brightGreen;
  brightYellow = stdColors.brightYellow;
  brightBlue = stdColors.brightBlue;
  brightMagenta = stdColors.brightMagenta;
  brightCyan = stdColors.brightCyan;
  brightWhite = stdColors.brightWhite;
  bgRed = stdColors.bgRed;
  bgGreen = stdColors.bgGreen;
  bgYellow = stdColors.bgYellow;
  bgBlue = stdColors.bgBlue;
  bgMagenta = stdColors.bgMagenta;
  bgCyan = stdColors.bgCyan;
  bgWhite = stdColors.bgWhite;
  bgBlack = stdColors.bgBlack;
  bold = stdColors.bold;
  dim = stdColors.dim;
  italic = stdColors.italic;
  underline = stdColors.underline;
  inverse = stdColors.inverse;
  hidden = stdColors.hidden;
  strikethrough = stdColors.strikethrough;
  reset = stdColors.reset;
} else {
  // Node.js/Bun: Use our ANSI implementations
  red = nodeColors.red;
  green = nodeColors.green;
  yellow = nodeColors.yellow;
  blue = nodeColors.blue;
  magenta = nodeColors.magenta;
  cyan = nodeColors.cyan;
  white = nodeColors.white;
  gray = nodeColors.gray;
  black = nodeColors.black;
  brightRed = nodeColors.brightRed;
  brightGreen = nodeColors.brightGreen;
  brightYellow = nodeColors.brightYellow;
  brightBlue = nodeColors.brightBlue;
  brightMagenta = nodeColors.brightMagenta;
  brightCyan = nodeColors.brightCyan;
  brightWhite = nodeColors.brightWhite;
  bgRed = nodeColors.bgRed;
  bgGreen = nodeColors.bgGreen;
  bgYellow = nodeColors.bgYellow;
  bgBlue = nodeColors.bgBlue;
  bgMagenta = nodeColors.bgMagenta;
  bgCyan = nodeColors.bgCyan;
  bgWhite = nodeColors.bgWhite;
  bgBlack = nodeColors.bgBlack;
  bold = nodeColors.bold;
  dim = nodeColors.dim;
  italic = nodeColors.italic;
  underline = nodeColors.underline;
  inverse = nodeColors.inverse;
  hidden = nodeColors.hidden;
  strikethrough = nodeColors.strikethrough;
  reset = nodeColors.reset;
}
