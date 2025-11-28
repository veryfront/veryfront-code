/**
 * Node.js console styling implementation using picocolors
 */

import pc from "npm:picocolors";
import type { ConsoleStyler } from "./types.ts";

// picocolors API is slightly different, so we wrap it
export const colors: ConsoleStyler = {
  // Basic colors
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  cyan: pc.cyan,
  magenta: pc.magenta,
  white: pc.white,
  gray: pc.gray,

  // Text modifiers
  bold: pc.bold,
  dim: pc.dim,
  italic: pc.italic,
  underline: pc.underline,
  strikethrough: pc.strikethrough,

  // Utility - picocolors doesn't have reset, so we implement it
  reset: (text: string) => pc.reset(text),
};

// Export individual functions
export const red = pc.red;
export const green = pc.green;
export const yellow = pc.yellow;
export const blue = pc.blue;
export const cyan = pc.cyan;
export const magenta = pc.magenta;
export const white = pc.white;
export const gray = pc.gray;
export const bold = pc.bold;
export const dim = pc.dim;
export const italic = pc.italic;
export const underline = pc.underline;
export const strikethrough = pc.strikethrough;
export const reset = (text: string) => pc.reset(text);
