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
    moveTo: (row, col) => `${CSI}${row};${col}H`,
    up: (n = 1) => `${CSI}${n}A`,
    down: (n = 1) => `${CSI}${n}B`,
    right: (n = 1) => `${CSI}${n}C`,
    left: (n = 1) => `${CSI}${n}D`,
    save: `${CSI}s`,
    restore: `${CSI}u`,
};
export const screen = {
    clear: `${CSI}2J`,
    clearLine: `${CSI}2K`,
    clearLineEnd: `${CSI}K`,
    clearDown: `${CSI}J`,
    clearUp: `${CSI}1J`,
    altOn: `${CSI}?1049h`,
    altOff: `${CSI}?1049l`,
    clearLineReturn: `${CSI}2K\r`,
};
export const style = {
    bold: `${CSI}1m`,
    dim: `${CSI}2m`,
    italic: `${CSI}3m`,
    underline: `${CSI}4m`,
    blink: `${CSI}5m`,
    inverse: `${CSI}7m`,
    hidden: `${CSI}8m`,
    strikethrough: `${CSI}9m`,
};
export const fgRgb = (r, g, b) => `${CSI}38;2;${r};${g};${b}m`;
export const bgRgb = (r, g, b) => `${CSI}48;2;${r};${g};${b}m`;
export const fg256 = (color) => `${CSI}38;5;${color}m`;
export const bg256 = (color) => `${CSI}48;5;${color}m`;
export const fg16 = (color) => `${CSI}${30 + color}m`;
export const bg16 = (color) => `${CSI}${40 + color}m`;
// deno-lint-ignore no-control-regex
export const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
export function stripAnsi(text) {
    return text.replace(ANSI_REGEX, "");
}
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function getSpinnerFrame(index) {
    return SPINNER_FRAMES[index % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
}
