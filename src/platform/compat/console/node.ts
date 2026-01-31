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

let pc: PicoColors | null = null;

async function ensurePc(): Promise<PicoColors> {
  if (pc) return pc;

  const mod = await import("npm:picocolors@1.1.1");
  pc = mod.default as PicoColors;

  return pc;
}

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

export async function initColors(): Promise<void> {
  await ensurePc();
}
