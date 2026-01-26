/**
 * Cross-runtime console styling
 *
 * Provides terminal colors that work in Deno, Node.js, and Bun.
 * Falls back to no-op functions in environments without terminal support.
 */
import type { ColorFunction, ConsoleStyler } from "./types.js";
export type { ColorFunction, ConsoleStyler } from "./types.js";
declare const colorsPromise: Promise<ConsoleStyler>;
export declare const red: ColorFunction;
export declare const green: ColorFunction;
export declare const yellow: ColorFunction;
export declare const blue: ColorFunction;
export declare const cyan: ColorFunction;
export declare const magenta: ColorFunction;
export declare const white: ColorFunction;
export declare const gray: ColorFunction;
export declare const bold: ColorFunction;
export declare const dim: ColorFunction;
export declare const italic: ColorFunction;
export declare const underline: ColorFunction;
export declare const strikethrough: ColorFunction;
export declare const reset: ColorFunction;
export declare const colors: {
    red: ColorFunction;
    green: ColorFunction;
    yellow: ColorFunction;
    blue: ColorFunction;
    cyan: ColorFunction;
    magenta: ColorFunction;
    white: ColorFunction;
    gray: ColorFunction;
    bold: ColorFunction;
    dim: ColorFunction;
    italic: ColorFunction;
    underline: ColorFunction;
    strikethrough: ColorFunction;
    reset: ColorFunction;
};
export { colorsPromise };
//# sourceMappingURL=index.d.ts.map