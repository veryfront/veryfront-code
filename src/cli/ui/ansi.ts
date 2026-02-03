/**
 * ANSI Escape Codes
 *
 * Centralized ANSI terminal control sequences.
 * Single source of truth for all terminal control codes.
 */

export const ESC = "\x1b";
export const CSI = `${ESC}[`;
export const RESET = `${ESC}[0m`;

export const cursor = {
  hide: `${CSI}?25l`,
  show: `${CSI}?25h`,
  moveTo(row: number, col: number): string {
    return `${CSI}${row};${col}H`;
  },
  up(n = 1): string {
    return `${CSI}${n}A`;
  },
  down(n = 1): string {
    return `${CSI}${n}B`;
  },
  right(n = 1): string {
    return `${CSI}${n}C`;
  },
  left(n = 1): string {
    return `${CSI}${n}D`;
  },
  save: `${CSI}s`,
  restore: `${CSI}u`,
} as const;

export const screen = {
  clear: `${CSI}2J`,
  clearLine: `${CSI}2K`,
  clearLineEnd: `${CSI}K`,
  clearDown: `${CSI}J`,
  clearUp: `${CSI}1J`,
  altOn: `${CSI}?1049h`,
  altOff: `${CSI}?1049l`,
  clearLineReturn: `${CSI}2K\r`,
  // Mouse tracking (SGR mode for better compatibility)
  mouseOn: `${CSI}?1000h${CSI}?1006h`,
  mouseOff: `${CSI}?1006l${CSI}?1000l`,
} as const;

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

export function fgRgb(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

export function bgRgb(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

export function fg256(color: number): string {
  return `${CSI}38;5;${color}m`;
}

export function bg256(color: number): string {
  return `${CSI}48;5;${color}m`;
}

export function fg16(color: number): string {
  return `${CSI}${30 + color}m`;
}

export function bg16(color: number): string {
  return `${CSI}${40 + color}m`;
}

// deno-lint-ignore no-control-regex
export const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function getSpinnerFrame(index: number): string {
  return SPINNER_FRAMES[index % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
}
