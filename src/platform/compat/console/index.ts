
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
    if (isDeno) {
      const mod = await import("./deno.ts");
      _colors = mod.colors;
    } else {
      const mod = await import("./node.ts");
      _colors = mod.colors;
    }
  } catch {
    _colors = fallbackColors;
  }

  return _colors;
}

const colorsPromise = loadColors();

function getColors(): ConsoleStyler {
  return _colors ?? fallbackColors;
}

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
