import * as ansi from "../std/fmt-colors.ts";
import { getDenoRuntime } from "../runtime.ts";
import type { ColorFunction, ConsoleStyler } from "./types.ts";

const identity: ColorFunction = (text) => text;
const color = (style: ColorFunction): ColorFunction =>
  getDenoRuntime()?.noColor === true ? identity : style;

export const red = color(ansi.red);
export const green = color(ansi.green);
export const yellow = color(ansi.yellow);
export const blue = color(ansi.blue);
export const cyan = color(ansi.cyan);
export const magenta = color(ansi.magenta);
export const white = color(ansi.white);
export const gray = color(ansi.gray);
export const bold = color(ansi.bold);
export const dim = color(ansi.dim);
export const italic = color(ansi.italic);
export const underline = color(ansi.underline);
export const strikethrough = color(ansi.strikethrough);
export const reset = color(ansi.reset);

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
