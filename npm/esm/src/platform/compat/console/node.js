let pc = null;
async function ensurePc() {
    if (pc)
        return pc;
    const picocolorsModule = ["npm:", "picocolors"].join("");
    const mod = await import(picocolorsModule);
    pc = mod.default;
    return pc;
}
function lazyColor(fn) {
    return (s) => pc?.[fn]?.(s) ?? s;
}
export const colors = {
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
export const red = colors.red;
export const green = colors.green;
export const yellow = colors.yellow;
export const blue = colors.blue;
export const cyan = colors.cyan;
export const magenta = colors.magenta;
export const white = colors.white;
export const gray = colors.gray;
export const bold = colors.bold;
export const dim = colors.dim;
export const italic = colors.italic;
export const underline = colors.underline;
export const strikethrough = colors.strikethrough;
export const reset = colors.reset;
export async function initColors() {
    await ensurePc();
}
