/**
 * Cross-runtime console styling
 *
 * Provides terminal colors in Deno. Node.js and Bun use identity styling
 * because the logging layer owns color policy and TTY detection there.
 */

import { isDeno } from "../runtime.ts";
import { colors as denoColors } from "./deno.ts";
import { colors as nodeColors } from "./node.ts";
import type { ColorFunction, ConsoleStyler } from "./types.ts";

export type { ColorFunction, ConsoleStyler } from "./types.ts";

const runtimeColors: ConsoleStyler = isDeno ? denoColors : nodeColors;
const colorsPromise = Promise.resolve(runtimeColors);

function makeColor(getter: (c: ConsoleStyler) => ColorFunction): ColorFunction {
  return (text: string) => getter(runtimeColors)(text);
}

export const red: ColorFunction = makeColor((c) => c.red);
export const green: ColorFunction = makeColor((c) => c.green);
export const yellow: ColorFunction = makeColor((c) => c.yellow);
export const blue: ColorFunction = makeColor((c) => c.blue);
export const cyan: ColorFunction = makeColor((c) => c.cyan);
export const magenta: ColorFunction = makeColor((c) => c.magenta);
export const white: ColorFunction = makeColor((c) => c.white);
export const gray: ColorFunction = makeColor((c) => c.gray);
export const bold: ColorFunction = makeColor((c) => c.bold);
export const dim: ColorFunction = makeColor((c) => c.dim);
export const italic: ColorFunction = makeColor((c) => c.italic);
export const underline: ColorFunction = makeColor((c) => c.underline);
export const strikethrough: ColorFunction = makeColor((c) => c.strikethrough);
export const reset: ColorFunction = makeColor((c) => c.reset);

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

export { colorsPromise };
