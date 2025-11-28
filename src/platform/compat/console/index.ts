/**
 * Cross-runtime console styling
 *
 * Provides terminal colors that work in Deno, Node.js, and Bun.
 * Falls back to no-op functions in environments without terminal support.
 */

import { isDeno } from "../runtime.ts";
import type { ColorFunction, ConsoleStyler } from "./types.ts";

export type { ColorFunction, ConsoleStyler } from "./types.ts";

// No-op fallback for environments without terminal support
const noOp: ColorFunction = (text: string) => text;

const fallbackColors: ConsoleStyler = {
  red: noOp,
  green: noOp,
  yellow: noOp,
  blue: noOp,
  cyan: noOp,
  magenta: noOp,
  white: noOp,
  gray: noOp,
  bold: noOp,
  dim: noOp,
  italic: noOp,
  underline: noOp,
  strikethrough: noOp,
  reset: noOp,
};

// Dynamically load the appropriate implementation
let _colors: ConsoleStyler | null = null;

async function loadColors(): Promise<ConsoleStyler> {
  if (_colors) return _colors;

  try {
    if (isDeno) {
      const mod = await import("./deno.ts");
      _colors = mod.colors;
    } else {
      const mod = await import("./node.ts");
      _colors = mod.colors;
    }
  } catch {
    // Fallback for environments where neither works
    _colors = fallbackColors;
  }

  return _colors;
}

// Eagerly load colors (works because this is typically imported at module load time)
const colorsPromise = loadColors();

// Synchronous access with fallback (for immediate use)
function getColors(): ConsoleStyler {
  return _colors ?? fallbackColors;
}

// Export individual color functions that lazily resolve
export const red: ColorFunction = (text) => getColors().red(text);
export const green: ColorFunction = (text) => getColors().green(text);
export const yellow: ColorFunction = (text) => getColors().yellow(text);
export const blue: ColorFunction = (text) => getColors().blue(text);
export const cyan: ColorFunction = (text) => getColors().cyan(text);
export const magenta: ColorFunction = (text) => getColors().magenta(text);
export const white: ColorFunction = (text) => getColors().white(text);
export const gray: ColorFunction = (text) => getColors().gray(text);
export const bold: ColorFunction = (text) => getColors().bold(text);
export const dim: ColorFunction = (text) => getColors().dim(text);
export const italic: ColorFunction = (text) => getColors().italic(text);
export const underline: ColorFunction = (text) => getColors().underline(text);
export const strikethrough: ColorFunction = (text) => getColors().strikethrough(text);
export const reset: ColorFunction = (text) => getColors().reset(text);

// Export the colors object for those who prefer it
export const colors = {
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
} satisfies ConsoleStyler;

// Export promise for async initialization if needed
export { colorsPromise };
