// deno-lint-ignore-file no-explicit-any
/**
 * Extended ANSI escape codes for TUI rendering
 *
 * Builds on existing ansi.ts colors with cursor control, screen manipulation,
 * and advanced formatting for the TUI system.
 *
 * @note Type assertions used for cross-runtime compatibility with Node.js/Bun.
 */

// Type declarations for Node.js compatibility
declare const process: any;

// Re-export base colors from existing implementation
export {
  blue,
  bold,
  colors,
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
} from "@veryfront/compat/console";

// ============================================================================
// Escape Code Constants
// ============================================================================

const ESC = "\x1b";
const CSI = `${ESC}[`;

// ============================================================================
// Cursor Control
// ============================================================================

/** Hide the cursor */
export const cursorHide = `${CSI}?25l`;

/** Show the cursor */
export const cursorShow = `${CSI}?25h`;

/** Move cursor to position (1-indexed) */
export function cursorTo(x: number, y: number): string {
  return `${CSI}${y};${x}H`;
}

/** Move cursor to column (1-indexed) */
export function cursorToColumn(x: number): string {
  return `${CSI}${x}G`;
}

/** Move cursor up by n lines */
export function cursorUp(n = 1): string {
  return `${CSI}${n}A`;
}

/** Move cursor down by n lines */
export function cursorDown(n = 1): string {
  return `${CSI}${n}B`;
}

/** Move cursor forward by n columns */
export function cursorForward(n = 1): string {
  return `${CSI}${n}C`;
}

/** Move cursor backward by n columns */
export function cursorBack(n = 1): string {
  return `${CSI}${n}D`;
}

/** Save cursor position */
export const cursorSave = `${CSI}s`;

/** Restore cursor position */
export const cursorRestore = `${CSI}u`;

/** Move cursor to home position (top-left) */
export const cursorHome = `${CSI}H`;

// ============================================================================
// Screen Control
// ============================================================================

/** Clear entire screen */
export const clearScreen = `${CSI}2J`;

/** Clear screen from cursor down */
export const clearScreenDown = `${CSI}J`;

/** Clear screen from cursor up */
export const clearScreenUp = `${CSI}1J`;

/** Clear entire line */
export const clearLine = `${CSI}2K`;

/** Clear line from cursor right */
export const clearLineRight = `${CSI}K`;

/** Clear line from cursor left */
export const clearLineLeft = `${CSI}1K`;

/** Scroll up by n lines */
export function scrollUp(n = 1): string {
  return `${CSI}${n}S`;
}

/** Scroll down by n lines */
export function scrollDown(n = 1): string {
  return `${CSI}${n}T`;
}

// ============================================================================
// Alternate Screen Buffer
// ============================================================================

/** Enter alternate screen buffer (like vim/less) */
export const enterAltScreen = `${CSI}?1049h`;

/** Exit alternate screen buffer */
export const exitAltScreen = `${CSI}?1049l`;

// ============================================================================
// Text Formatting (Extended)
// ============================================================================

/** Invert foreground and background colors */
export function inverse(text: string): string {
  return `${CSI}7m${text}${CSI}27m`;
}

/** Blink text (may not be supported in all terminals) */
export function blink(text: string): string {
  return `${CSI}5m${text}${CSI}25m`;
}

/** Hidden/invisible text */
export function hidden(text: string): string {
  return `${CSI}8m${text}${CSI}28m`;
}

// ============================================================================
// 256-Color Support
// ============================================================================

/** Set foreground color using 256-color palette */
export function fg256(colorCode: number): (text: string) => string {
  return (text: string) => `${CSI}38;5;${colorCode}m${text}${CSI}39m`;
}

/** Set background color using 256-color palette */
export function bg256(colorCode: number): (text: string) => string {
  return (text: string) => `${CSI}48;5;${colorCode}m${text}${CSI}49m`;
}

// ============================================================================
// True Color (24-bit) Support
// ============================================================================

/** Set foreground color using RGB values */
export function fgRgb(r: number, g: number, b: number): (text: string) => string {
  return (text: string) => `${CSI}38;2;${r};${g};${b}m${text}${CSI}39m`;
}

/** Set background color using RGB values */
export function bgRgb(r: number, g: number, b: number): (text: string) => string {
  return (text: string) => `${CSI}48;2;${r};${g};${b}m${text}${CSI}49m`;
}

/** Set foreground color using hex string (e.g., "#ff0000" or "ff0000") */
export function fgHex(hex: string): (text: string) => string {
  const { r, g, b } = hexToRgb(hex);
  return fgRgb(r, g, b);
}

/** Set background color using hex string */
export function bgHex(hex: string): (text: string) => string {
  const { r, g, b } = hexToRgb(hex);
  return bgRgb(r, g, b);
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Convert hex color to RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace(/^#/, "");
  const bigint = parseInt(cleanHex, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

/** Strip all ANSI escape codes from a string */
export function stripAnsi(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Get visible length of string (excluding ANSI codes) */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/** Pad string to length, accounting for ANSI codes */
export function padEnd(str: string, length: number, char = " "): string {
  const visible = visibleLength(str);
  if (visible >= length) return str;
  return str + char.repeat(length - visible);
}

/** Pad string to length at start, accounting for ANSI codes */
export function padStart(str: string, length: number, char = " "): string {
  const visible = visibleLength(str);
  if (visible >= length) return str;
  return char.repeat(length - visible) + str;
}

/** Center string within length, accounting for ANSI codes */
export function center(str: string, length: number, char = " "): string {
  const visible = visibleLength(str);
  if (visible >= length) return str;
  const leftPad = Math.floor((length - visible) / 2);
  const rightPad = length - visible - leftPad;
  return char.repeat(leftPad) + str + char.repeat(rightPad);
}

/** Truncate string to max length, adding ellipsis if needed */
export function truncate(str: string, maxLength: number, suffix = "..."): string {
  if (visibleLength(str) <= maxLength) return str;

  // For strings with ANSI, we need to be careful
  const plain = stripAnsi(str);
  if (plain.length <= maxLength) return str;

  const truncated = plain.slice(0, maxLength - suffix.length) + suffix;
  return truncated;
}

// ============================================================================
// Write Helpers
// ============================================================================

/** Write string to stdout */
export function write(str: string): void {
  if (typeof Deno !== "undefined") {
    Deno.stdout.writeSync(new TextEncoder().encode(str));
  } else if (typeof process !== "undefined" && process.stdout) {
    process.stdout.write(str);
  }
}

/** Write string to stdout with newline */
export function writeLine(str: string): void {
  write(str + "\n");
}

/** Flush stdout (no-op in most cases, but here for completeness) */
export function flush(): void {
  // Most terminal I/O is unbuffered, but this is a hook for future use
}

// ============================================================================
// Composite Operations
// ============================================================================

/** Clear screen and move cursor to home */
export function clearAll(): void {
  write(clearScreen + cursorHome);
}

/** Move to position and write text */
export function writeAt(x: number, y: number, text: string): void {
  write(cursorTo(x, y) + text);
}

/** Create a box drawing sequence for a region */
export function drawBox(
  x: number,
  y: number,
  width: number,
  height: number,
  style: "single" | "double" | "rounded" = "rounded",
): string {
  const chars = BOX_CHARS[style];
  let result = "";

  // Top border
  result += cursorTo(x, y);
  result += chars.topLeft + chars.horizontal.repeat(width - 2) + chars.topRight;

  // Side borders
  for (let row = 1; row < height - 1; row++) {
    result += cursorTo(x, y + row);
    result += chars.vertical + " ".repeat(width - 2) + chars.vertical;
  }

  // Bottom border
  result += cursorTo(x, y + height - 1);
  result += chars.bottomLeft + chars.horizontal.repeat(width - 2) + chars.bottomRight;

  return result;
}

// ============================================================================
// Box Drawing Characters
// ============================================================================

export const BOX_CHARS = {
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    teeLeft: "┤",
    teeRight: "├",
    teeTop: "┴",
    teeBottom: "┬",
    cross: "┼",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    teeLeft: "╣",
    teeRight: "╠",
    teeTop: "╩",
    teeBottom: "╦",
    cross: "╬",
  },
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    teeLeft: "┤",
    teeRight: "├",
    teeTop: "┴",
    teeBottom: "┬",
    cross: "┼",
  },
} as const;

// ============================================================================
// Symbols
// ============================================================================

export const SYMBOLS = {
  // Status indicators
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  question: "?",

  // Bullets and pointers
  bullet: "•",
  pointer: "❯",
  arrowRight: "→",
  arrowLeft: "←",
  arrowUp: "↑",
  arrowDown: "↓",

  // Checkboxes
  checkboxOn: "◉",
  checkboxOff: "○",
  checkboxChecked: "☑",
  checkboxUnchecked: "☐",

  // Progress
  progressFilled: "█",
  progressEmpty: "░",
  progressPartial: ["▏", "▎", "▍", "▌", "▋", "▊", "▉"],

  // Spinners
  spinnerDots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  spinnerLine: ["-", "\\", "|", "/"],
  spinnerBounce: ["⠁", "⠂", "⠄", "⠂"],

  // Misc
  ellipsis: "…",
  star: "★",
  heart: "♥",
  lightning: "⚡",
} as const;

// ============================================================================
// ASCII Fallbacks (for terminals without Unicode support)
// ============================================================================

export const ASCII_SYMBOLS = {
  success: "+",
  error: "x",
  warning: "!",
  info: "i",
  question: "?",
  bullet: "*",
  pointer: ">",
  arrowRight: "->",
  arrowLeft: "<-",
  arrowUp: "^",
  arrowDown: "v",
  checkboxOn: "(o)",
  checkboxOff: "( )",
  checkboxChecked: "[x]",
  checkboxUnchecked: "[ ]",
  progressFilled: "#",
  progressEmpty: "-",
  spinnerDots: ["-", "\\", "|", "/"],
  ellipsis: "...",
} as const;
