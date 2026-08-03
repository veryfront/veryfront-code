import type { ColorFunction, ConsoleStyler } from "./types.ts";

/**
 * Node styling is intentionally identity-only.
 *
 * Veryfront's logging layer owns color policy and TTY detection. Keeping this
 * compatibility module neutral prevents escape codes from leaking into pipes,
 * JSON logs, and test output.
 */
const identity: ColorFunction = (text: string) => text;

export const colors: ConsoleStyler = {
  red: identity,
  green: identity,
  yellow: identity,
  blue: identity,
  cyan: identity,
  magenta: identity,
  white: identity,
  gray: identity,
  bold: identity,
  dim: identity,
  italic: identity,
  underline: identity,
  strikethrough: identity,
  reset: identity,
};

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
