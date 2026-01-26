import { env as getEnvObject, isStdoutTTY } from "../../platform/compat/process.js";
import { ESC, RESET } from "./ansi.js";
export function getColorLevel() {
    const envObj = getEnvObject();
    if (envObj.NO_COLOR !== undefined)
        return "none";
    if (envObj.FORCE_COLOR === "0")
        return "none";
    const term = envObj.TERM ?? "";
    if (term === "dumb")
        return "none";
    const forceColor = parseInt(envObj.FORCE_COLOR ?? "", 10);
    if (forceColor >= 1) {
        if (forceColor >= 3)
            return "truecolor";
        if (forceColor >= 2)
            return "256";
        return "16";
    }
    if (!isStdoutTTY())
        return "none";
    const colorTerm = envObj.COLORTERM ?? "";
    if (colorTerm === "truecolor" || colorTerm === "24bit")
        return "truecolor";
    if (term.includes("256color") || term.includes("256"))
        return "256";
    const termProgram = envObj.TERM_PROGRAM ?? "";
    if (termProgram === "iTerm.app")
        return "truecolor";
    if (termProgram === "Apple_Terminal")
        return "truecolor";
    if (termProgram === "Hyper")
        return "truecolor";
    if (termProgram === "vscode")
        return "truecolor";
    if (term)
        return "16";
    return "none";
}
export function shouldUseColor() {
    return getColorLevel() !== "none";
}
let cachedColorLevel = null;
function getCachedColorLevel() {
    cachedColorLevel ??= getColorLevel();
    return cachedColorLevel;
}
export function resetColorCache() {
    cachedColorLevel = null;
}
function hexToRgb(hex) {
    const cleaned = hex.replace("#", "");
    return {
        r: parseInt(cleaned.slice(0, 2), 16),
        g: parseInt(cleaned.slice(2, 4), 16),
        b: parseInt(cleaned.slice(4, 6), 16),
    };
}
function rgbTo256(r, g, b) {
    if (r === g && g === b) {
        if (r < 8)
            return 16;
        if (r > 248)
            return 231;
        return Math.round(((r - 8) / 247) * 24) + 232;
    }
    const toIndex = (v) => Math.round((v / 255) * 5);
    return 16 + toIndex(r) * 36 + toIndex(g) * 6 + toIndex(b);
}
function rgbTo16(r, g, b) {
    const bright = (r + g + b) / 3 > 127;
    const hasRed = r > 127;
    const hasGreen = g > 127;
    const hasBlue = b > 127;
    if (!hasRed && !hasGreen && !hasBlue)
        return bright ? 7 : 0;
    let color = 0;
    if (hasRed)
        color += 1;
    if (hasGreen)
        color += 2;
    if (hasBlue)
        color += 4;
    return bright ? color + 8 : color;
}
function applyColor(text, r, g, b, isBackground) {
    const level = getCachedColorLevel();
    if (level === "none")
        return text;
    const base = isBackground ? 40 : 30;
    if (level === "truecolor") {
        const code = isBackground ? 48 : 38;
        return `${ESC}[${code};2;${r};${g};${b}m${text}${RESET}`;
    }
    if (level === "256") {
        const code = isBackground ? 48 : 38;
        return `${ESC}[${code};5;${rgbTo256(r, g, b)}m${text}${RESET}`;
    }
    return `${ESC}[${base + rgbTo16(r, g, b)}m${text}${RESET}`;
}
export function color(text, hex) {
    const { r, g, b } = hexToRgb(hex);
    return applyColor(text, r, g, b, false);
}
export function bgColor(text, hex) {
    const { r, g, b } = hexToRgb(hex);
    return applyColor(text, r, g, b, true);
}
const rgb = (r, g, b) => (text) => applyColor(text, r, g, b, false);
const bgRgb = (r, g, b) => (text) => applyColor(text, r, g, b, true);
export const brand = rgb(252, 143, 93);
export const brandBg = bgRgb(252, 143, 93);
export const success = rgb(34, 197, 94);
export const error = rgb(239, 68, 68);
export const warning = rgb(234, 179, 8);
export const muted = rgb(113, 113, 122);
export const bold = (text) => `${ESC}[1m${text}${RESET}`;
export const dim = (text) => `${ESC}[2m${text}${RESET}`;
export const italic = (text) => `${ESC}[3m${text}${RESET}`;
export const underline = (text) => `${ESC}[4m${text}${RESET}`;
export const brandBold = (text) => bold(brand(text));
export const successBold = (text) => bold(success(text));
export const errorBold = (text) => bold(error(text));
export { RESET as reset };
const MATRIX_STATES = [
    ["●", "○", "○"],
    ["○", "●", "○"],
    ["○", "○", "●"],
    ["○", "●", "○"],
];
export function animatedMatrix(frame) {
    const state = MATRIX_STATES[frame % MATRIX_STATES.length] ?? ["●", "○", "○"];
    return state.map((dot) => (dot === "●" ? brand(dot) : muted(dot))).join("");
}
