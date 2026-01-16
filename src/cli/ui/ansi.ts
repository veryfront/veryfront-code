/**
 * ANSI Escape Codes
 *
 * Centralized ANSI terminal control sequences.
 * Single source of truth for all terminal control codes.
 */

// === Base sequences ===

/** Escape character */
export const ESC = "\x1b";

/** Control Sequence Introducer */
export const CSI = `${ESC}[`;

/** Reset all attributes */
export const RESET = `${ESC}[0m`;

// === Cursor control ===

export const cursor = {
  /** Hide cursor */
  hide: `${CSI}?25l`,
  /** Show cursor */
  show: `${CSI}?25h`,
  /** Move cursor to row, column (1-indexed) */
  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  /** Move cursor up N lines */
  up: (n = 1) => `${CSI}${n}A`,
  /** Move cursor down N lines */
  down: (n = 1) => `${CSI}${n}B`,
  /** Move cursor right N columns */
  right: (n = 1) => `${CSI}${n}C`,
  /** Move cursor left N columns */
  left: (n = 1) => `${CSI}${n}D`,
  /** Save cursor position */
  save: `${CSI}s`,
  /** Restore cursor position */
  restore: `${CSI}u`,
} as const;

// === Screen control ===

export const screen = {
  /** Clear entire screen */
  clear: `${CSI}2J`,
  /** Clear current line */
  clearLine: `${CSI}2K`,
  /** Clear from cursor to end of line */
  clearLineEnd: `${CSI}K`,
  /** Clear from cursor to end of screen */
  clearDown: `${CSI}J`,
  /** Clear from cursor to start of screen */
  clearUp: `${CSI}1J`,
  /** Enter alternate screen buffer */
  altOn: `${CSI}?1049h`,
  /** Exit alternate screen buffer */
  altOff: `${CSI}?1049l`,
  /** Clear line and return to start */
  clearLineReturn: `${CSI}2K\r`,
} as const;

// === Text styles ===

export const style = {
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  blink: `${CSI}5m`,
  inverse: `${CSI}7m`,
  hidden: `${CSI}8m`,
  strikethrough: `${CSI}9m`,
} as const;

// === Color codes ===

/** Create RGB foreground color code */
export const fgRgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;

/** Create RGB background color code */
export const bgRgb = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;

/** Create 256-color foreground code */
export const fg256 = (color: number) => `${CSI}38;5;${color}m`;

/** Create 256-color background code */
export const bg256 = (color: number) => `${CSI}48;5;${color}m`;

/** Create 16-color foreground code (30-37, 90-97) */
export const fg16 = (color: number) => `${CSI}${30 + color}m`;

/** Create 16-color background code (40-47, 100-107) */
export const bg16 = (color: number) => `${CSI}${40 + color}m`;

// === Common regex patterns ===

/**
 * Regex to match ANSI escape sequences
 * Use with .replace(ANSI_REGEX, '') to strip colors
 */
// deno-lint-ignore no-control-regex
export const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

// === Spinner frames ===

/** Braille dot spinner frames */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Get spinner frame at index (wraps around) */
export function getSpinnerFrame(index: number): string {
  return SPINNER_FRAMES[index % SPINNER_FRAMES.length] ?? "⠋";
}
