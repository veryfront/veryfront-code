/**
 * Portable subset of `@std/fmt/colors` for Veryfront's runtime adapters.
 *
 * This module intentionally exposes the style functions listed below plus the
 * color state API. It is not a replacement for the standard library's RGB and
 * ANSI utility surface.
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

type ColorFn = (value: string) => string;

interface ColorCode {
  open: string;
  close: string;
  closePattern: RegExp;
}

interface ColorModule {
  red: ColorFn;
  green: ColorFn;
  yellow: ColorFn;
  blue: ColorFn;
  magenta: ColorFn;
  cyan: ColorFn;
  white: ColorFn;
  gray: ColorFn;
  black: ColorFn;
  brightRed: ColorFn;
  brightGreen: ColorFn;
  brightYellow: ColorFn;
  brightBlue: ColorFn;
  brightMagenta: ColorFn;
  brightCyan: ColorFn;
  brightWhite: ColorFn;
  bgRed: ColorFn;
  bgGreen: ColorFn;
  bgYellow: ColorFn;
  bgBlue: ColorFn;
  bgMagenta: ColorFn;
  bgCyan: ColorFn;
  bgWhite: ColorFn;
  bgBlack: ColorFn;
  bold: ColorFn;
  dim: ColorFn;
  italic: ColorFn;
  underline: ColorFn;
  inverse: ColorFn;
  hidden: ColorFn;
  strikethrough: ColorFn;
  reset: ColorFn;
  setColorEnabled(value: boolean): void;
  getColorEnabled(): boolean;
}

const nodeNoColor = typeof process !== "undefined" &&
  Object.hasOwn(process.env, "NO_COLOR");
let nodeColorEnabled = !nodeNoColor;

function createCode(open: number, close: number): ColorCode {
  return {
    open: `\x1b[${open}m`,
    close: `\x1b[${close}m`,
    closePattern: new RegExp(`\\x1b\\[${close}m`, "g"),
  };
}

function createColor(open: number, close: number): ColorFn {
  const code = createCode(open, close);
  return (value: string): string =>
    nodeColorEnabled
      ? `${code.open}${value.replace(code.closePattern, code.open)}${code.close}`
      : value;
}

const nodeColors: ColorModule = {
  red: createColor(31, 39),
  green: createColor(32, 39),
  yellow: createColor(33, 39),
  blue: createColor(34, 39),
  magenta: createColor(35, 39),
  cyan: createColor(36, 39),
  white: createColor(37, 39),
  gray: createColor(90, 39),
  black: createColor(30, 39),
  brightRed: createColor(91, 39),
  brightGreen: createColor(92, 39),
  brightYellow: createColor(93, 39),
  brightBlue: createColor(94, 39),
  brightMagenta: createColor(95, 39),
  brightCyan: createColor(96, 39),
  brightWhite: createColor(97, 39),
  bgRed: createColor(41, 49),
  bgGreen: createColor(42, 49),
  bgYellow: createColor(43, 49),
  bgBlue: createColor(44, 49),
  bgMagenta: createColor(45, 49),
  bgCyan: createColor(46, 49),
  bgWhite: createColor(47, 49),
  bgBlack: createColor(40, 49),
  bold: createColor(1, 22),
  dim: createColor(2, 22),
  italic: createColor(3, 23),
  underline: createColor(4, 24),
  inverse: createColor(7, 27),
  hidden: createColor(8, 28),
  strikethrough: createColor(9, 29),
  reset: createColor(0, 0),
  setColorEnabled(value: boolean): void {
    if (!nodeNoColor) nodeColorEnabled = value;
  },
  getColorEnabled(): boolean {
    return nodeColorEnabled;
  },
};

const colors: ColorModule = isDeno
  ? ((await import("#std/fmt/colors.ts")) as ColorModule)
  : nodeColors;

export const {
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  black,
  brightRed,
  brightGreen,
  brightYellow,
  brightBlue,
  brightMagenta,
  brightCyan,
  brightWhite,
  bgRed,
  bgGreen,
  bgYellow,
  bgBlue,
  bgMagenta,
  bgCyan,
  bgWhite,
  bgBlack,
  bold,
  dim,
  italic,
  underline,
  inverse,
  hidden,
  strikethrough,
  reset,
  setColorEnabled,
  getColorEnabled,
} = colors;
