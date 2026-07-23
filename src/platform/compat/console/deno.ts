import { colors as ansiColors } from "./ansi.ts";
import { selectConsoleStyler } from "./support.ts";
import type { ConsoleStyler } from "./types.ts";

export const colors: ConsoleStyler = selectConsoleStyler(ansiColors);

export const {
  blue,
  bold,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  reset,
  strikethrough,
  underline,
  white,
  yellow,
} = colors;
