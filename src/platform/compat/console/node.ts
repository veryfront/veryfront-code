import { colors as ansiColors } from "./ansi.ts";
import { selectConsoleStyler } from "./support.ts";
import type { ConsoleStyler } from "./types.ts";

export const colors: ConsoleStyler = selectConsoleStyler(ansiColors);

export const {
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
} = colors;
