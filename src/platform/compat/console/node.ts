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
let initPromise: Promise<PicoColors> | null = null;

/**
 * Lazily loads picocolors module. Uses a cached promise to avoid
 * multiple concurrent imports.
 */
async function loadPicoColors(): Promise<PicoColors> {
  if (pc) return pc;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const picocolorsModule = ["npm:", "picocolors"].join("");
    const mod = await import(picocolorsModule);
    pc = mod.default as PicoColors;
    return pc;
  })();

  return initPromise;
}

const lazyColor = (fn: keyof PicoColors) => (s: string) => pc?.[fn]?.(s) ?? s;

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

export const red = lazyColor("red");
export const green = lazyColor("green");
export const yellow = lazyColor("yellow");
export const blue = lazyColor("blue");
export const cyan = lazyColor("cyan");
export const magenta = lazyColor("magenta");
export const white = lazyColor("white");
export const gray = lazyColor("gray");
export const bold = lazyColor("bold");
export const dim = lazyColor("dim");
export const italic = lazyColor("italic");
export const underline = lazyColor("underline");
export const strikethrough = lazyColor("strikethrough");
export const reset = lazyColor("reset");

/**
 * Initialize colors by loading the picocolors module.
 * Call this early in your application to ensure colors work correctly.
 */
export async function initColors(): Promise<void> {
  await loadPicoColors();
}
