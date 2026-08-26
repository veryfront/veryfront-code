/**
 * Dependency-free ANSI color functions for every supported runtime.
 *
 * @module
 */

type ColorFn = (str: string) => string;

const ArrayPrototypeJoin = Array.prototype.join;
const ReflectApply = Reflect.apply;
const StringPrototypeSplit = String.prototype.split;

/** @internal Builds one ANSI wrapper while preserving an outer nested style. */
export function createColor(open: number, close: number): ColorFn {
  const openSequence = `\x1b[${open}m`;
  const closeSequence = `\x1b[${close}m`;
  return (str: string) => {
    const parts = ReflectApply(StringPrototypeSplit, str, [closeSequence]);
    return openSequence + ReflectApply(ArrayPrototypeJoin, parts, [openSequence]) + closeSequence;
  };
}

const colors = {
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
} satisfies Record<string, ColorFn>;

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
} = colors;
