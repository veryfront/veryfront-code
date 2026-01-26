/**
 * Cross-runtime console styling
 *
 * Provides terminal colors that work in Deno, Node.js, and Bun.
 * Falls back to no-op functions in environments without terminal support.
 */
import { isDeno } from "../runtime.js";
const noOp = (text) => text;
const fallbackColors = {
    red: noOp,
    green: noOp,
    yellow: noOp,
    blue: noOp,
    cyan: noOp,
    magenta: noOp,
    white: noOp,
    gray: noOp,
    bold: noOp,
    dim: noOp,
    italic: noOp,
    underline: noOp,
    strikethrough: noOp,
    reset: noOp,
};
let _colors = null;
async function loadColors() {
    if (_colors)
        return _colors;
    try {
        const mod = isDeno ? await import("./deno.js") : await import("./node.js");
        _colors = mod.colors;
    }
    catch {
        _colors = fallbackColors;
    }
    return _colors;
}
const colorsPromise = loadColors();
function getColors() {
    return _colors ?? fallbackColors;
}
function makeColor(fn) {
    return (text) => fn(getColors())(text);
}
export const red = makeColor((c) => c.red);
export const green = makeColor((c) => c.green);
export const yellow = makeColor((c) => c.yellow);
export const blue = makeColor((c) => c.blue);
export const cyan = makeColor((c) => c.cyan);
export const magenta = makeColor((c) => c.magenta);
export const white = makeColor((c) => c.white);
export const gray = makeColor((c) => c.gray);
export const bold = makeColor((c) => c.bold);
export const dim = makeColor((c) => c.dim);
export const italic = makeColor((c) => c.italic);
export const underline = makeColor((c) => c.underline);
export const strikethrough = makeColor((c) => c.strikethrough);
export const reset = makeColor((c) => c.reset);
export const colors = {
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
};
export { colorsPromise };
