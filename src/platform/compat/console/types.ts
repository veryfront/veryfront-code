/**
 * Console styling interface for cross-runtime terminal colors
 *
 * Compatible with both Deno's std/fmt/colors.ts and npm's picocolors
 */

export type ColorFunction = (text: string) => string;

export interface ConsoleStyler {
  // Basic colors
  red: ColorFunction;
  green: ColorFunction;
  yellow: ColorFunction;
  blue: ColorFunction;
  cyan: ColorFunction;
  magenta: ColorFunction;
  white: ColorFunction;
  gray: ColorFunction;

  // Text modifiers
  bold: ColorFunction;
  dim: ColorFunction;
  italic: ColorFunction;
  underline: ColorFunction;
  strikethrough: ColorFunction;

  // Utility
  reset: ColorFunction;
}
