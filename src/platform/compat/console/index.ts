/**
 * Cross-runtime console styling
 *
 * Provides terminal colors that work in Deno, Node.js, and Bun.
 * Falls back to no-op functions in environments without terminal support.
 */

import { isDeno } from "../runtime.ts";
import type { ColorFunction, ConsoleStyler } from "./types.ts";

export type { ColorFunction, ConsoleStyler } from "./types.ts";

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

let _colors: ConsoleStyler | null = null;

async function loadColors(): Promise<ConsoleStyler> {
  if (_colors) return _colors;

  try {
    const mod = await (isDeno ? import("./deno.ts") : import("./node.ts"));
    _colors = mod.colors;
  } catch {
    _colors = fallbackColors;
  }

  return _colors;
}

const colorsPromise = loadColors();

function getColors(): ConsoleStyler {
  return _colors ?? fallbackColors;
}

function makeColor(getter: (c: ConsoleStyler) => ColorFunction): ColorFunction {
  return (text: string) => getter(getColors())(text);
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
