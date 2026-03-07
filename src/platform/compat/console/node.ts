import type { ConsoleStyler } from "./types.ts";

type PicoColors = {
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  blue: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
  white: (s: string) => string;
  gray: (s: string) => string;
  bold: (s: string) => string;
  dim: (s: string) => string;
  italic: (s: string) => string;
  underline: (s: string) => string;
  strikethrough: (s: string) => string;
  reset: (s: string) => string;
};

// NOTE: pc is null because lazy initialization was removed as dead code.
// Colors on Node.js currently fall through to identity (no-op).
// The console/index.ts fallback colors and ANSI module handle the actual coloring.
const pc: PicoColors | null = null;

function lazyColor(fn: keyof PicoColors): (s: string) => string {
  return (s: string) => pc?.[fn]?.(s) ?? s;
}

export const colors: ConsoleStyler = {
  red: lazyColor("red"),
  green: lazyColor("green"),
  yellow: lazyColor("yellow"),
  blue: lazyColor("blue"),
  cyan: lazyColor("cyan"),
  magenta: lazyColor("magenta"),
  white: lazyColor("white"),
  gray: lazyColor("gray"),
  bold: lazyColor("bold"),
  dim: lazyColor("dim"),
  italic: lazyColor("italic"),
  underline: lazyColor("underline"),
  strikethrough: lazyColor("strikethrough"),
  reset: lazyColor("reset"),
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
