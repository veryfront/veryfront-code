import { env as getEnvObject, isStdoutTTY } from "#veryfront/platform/compat/process.ts";
import { ESC, RESET } from "./ansi.ts";

export type ColorLevel = "truecolor" | "256" | "16" | "none";

export function getColorLevel(): ColorLevel {
  const envObj = getEnvObject();

  if (envObj.NO_COLOR !== undefined) return "none";
  if (envObj.FORCE_COLOR === "0") return "none";

  const term = envObj.TERM ?? "";
  if (term === "dumb") return "none";

  const forceColor = parseInt(envObj.FORCE_COLOR ?? "", 10);
  if (forceColor >= 1) {
    if (forceColor >= 3) return "truecolor";
    if (forceColor >= 2) return "256";
    return "16";
  }

  if (!isStdoutTTY()) return "none";

  const colorTerm = envObj.COLORTERM ?? "";
  if (colorTerm === "truecolor" || colorTerm === "24bit") return "truecolor";

  if (term.includes("256color") || term.includes("256")) return "256";

  const termProgram = envObj.TERM_PROGRAM ?? "";
  if (termProgram === "iTerm.app") return "truecolor";
  if (termProgram === "Apple_Terminal") return "truecolor";
  if (termProgram === "Hyper") return "truecolor";
  if (termProgram === "vscode") return "truecolor";

  if (term) return "16";
  return "none";
}

export function shouldUseColor(): boolean {
  return getColorLevel() !== "none";
}

let cachedColorLevel: ColorLevel | null = null;

function getCachedColorLevel(): ColorLevel {
  cachedColorLevel ??= getColorLevel();
  return cachedColorLevel;
}

export function resetColorCache(): void {
  cachedColorLevel = null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbTo256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }

  const toIndex = (v: number) => Math.round((v / 255) * 5);
  return 16 + toIndex(r) * 36 + toIndex(g) * 6 + toIndex(b);
}

function rgbTo16(r: number, g: number, b: number): number {
  const bright = (r + g + b) / 3 > 127;

  const hasRed = r > 127;
  const hasGreen = g > 127;
  const hasBlue = b > 127;

  if (!hasRed && !hasGreen && !hasBlue) return bright ? 7 : 0;

  let color = 0;
  if (hasRed) color += 1;
  if (hasGreen) color += 2;
  if (hasBlue) color += 4;

  return bright ? color + 8 : color;
}

function applyColor(
  text: string,
  r: number,
  g: number,
  b: number,
  isBackground: boolean,
): string {
  const level = getCachedColorLevel();
  if (level === "none") return text;

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

export function color(text: string, hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return applyColor(text, r, g, b, false);
}

export function bgColor(text: string, hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return applyColor(text, r, g, b, true);
}

const rgb = (r: number, g: number, b: number) => (text: string) => applyColor(text, r, g, b, false);
const bgRgb = (r: number, g: number, b: number) => (text: string) =>
  applyColor(text, r, g, b, true);

export const brand = rgb(252, 143, 93);
export const brandBg = bgRgb(252, 143, 93);

export const success = rgb(34, 197, 94);
export const error = rgb(239, 68, 68);
export const warning = rgb(234, 179, 8);
export const muted = rgb(113, 113, 122);

export const bold = (text: string) => `${ESC}[1m${text}${RESET}`;
export const dim = (text: string) => `${ESC}[2m${text}${RESET}`;
export const italic = (text: string) => `${ESC}[3m${text}${RESET}`;
export const underline = (text: string) => `${ESC}[4m${text}${RESET}`;

export const brandBold = (text: string) => bold(brand(text));
export const successBold = (text: string) => bold(success(text));
export const errorBold = (text: string) => bold(error(text));

export { RESET as reset };

const MATRIX_STATES = [
  ["●", "○", "○"],
  ["○", "●", "○"],
  ["○", "○", "●"],
  ["○", "●", "○"],
];

export function animatedMatrix(frame: number): string {
  const state = MATRIX_STATES[frame % MATRIX_STATES.length] ?? ["●", "○", "○"];
  return state.map((dot) => (dot === "●" ? brand(dot) : muted(dot))).join("");
}
