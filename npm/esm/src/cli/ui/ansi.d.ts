/**
 * ANSI Escape Codes
 *
 * Centralized ANSI terminal control sequences.
 * Single source of truth for all terminal control codes.
 */
export declare const ESC = "\u001B";
export declare const CSI = "\u001B[";
export declare const RESET = "\u001B[0m";
export declare const cursor: {
    readonly hide: "\u001B[?25l";
    readonly show: "\u001B[?25h";
    readonly moveTo: (row: number, col: number) => string;
    readonly up: (n?: number) => string;
    readonly down: (n?: number) => string;
    readonly right: (n?: number) => string;
    readonly left: (n?: number) => string;
    readonly save: "\u001B[s";
    readonly restore: "\u001B[u";
};
export declare const screen: {
    readonly clear: "\u001B[2J";
    readonly clearLine: "\u001B[2K";
    readonly clearLineEnd: "\u001B[K";
    readonly clearDown: "\u001B[J";
    readonly clearUp: "\u001B[1J";
    readonly altOn: "\u001B[?1049h";
    readonly altOff: "\u001B[?1049l";
    readonly clearLineReturn: "\u001B[2K\r";
};
export declare const style: {
    readonly bold: "\u001B[1m";
    readonly dim: "\u001B[2m";
    readonly italic: "\u001B[3m";
    readonly underline: "\u001B[4m";
    readonly blink: "\u001B[5m";
    readonly inverse: "\u001B[7m";
    readonly hidden: "\u001B[8m";
    readonly strikethrough: "\u001B[9m";
};
export declare const fgRgb: (r: number, g: number, b: number) => string;
export declare const bgRgb: (r: number, g: number, b: number) => string;
export declare const fg256: (color: number) => string;
export declare const bg256: (color: number) => string;
export declare const fg16: (color: number) => string;
export declare const bg16: (color: number) => string;
export declare const ANSI_REGEX: RegExp;
export declare function stripAnsi(text: string): string;
export declare const SPINNER_FRAMES: readonly ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export declare function getSpinnerFrame(index: number): string;
//# sourceMappingURL=ansi.d.ts.map