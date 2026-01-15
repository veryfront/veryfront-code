/**
 * Veryfront CLI Colors
 * Brand: #00A3F4 (blue), #FFFFFF (white), #000000 (black)
 *
 * Features:
 * - TrueColor (24-bit) support with graceful fallback
 * - Respects NO_COLOR environment variable
 * - Auto-detects terminal color capability
 * - Runtime-agnostic: works on Deno, Node.js, and Bun
 */

import { env as getEnvObject, isStdoutTTY } from "@veryfront/platform/compat/process.ts";

const ESC = "\x1b";

/**
 * Color capability levels
 */
export type ColorLevel = "truecolor" | "256" | "16" | "none";

/**
 * Detect terminal color capability
 */
export function getColorLevel(): ColorLevel {
  // Check NO_COLOR first (https://no-color.org/)
  const envObj = getEnvObject();
  if (envObj.NO_COLOR !== undefined) return "none";
  if (envObj.FORCE_COLOR === "0") return "none";

  // Check TERM for dumb terminal
  const term = envObj.TERM || "";
  if (term === "dumb") return "none";

  // FORCE_COLOR=1 or higher enables colors even in non-TTY
  const forceColor = parseInt(envObj.FORCE_COLOR || "", 10);
  if (forceColor >= 1) {
    if (forceColor >= 3) return "truecolor";
    if (forceColor >= 2) return "256";
    return "16";
  }

  // Check if not a TTY
  if (!isStdoutTTY()) return "none";

  // Check for TrueColor support
  const colorTerm = envObj.COLORTERM || "";
  if (colorTerm === "truecolor" || colorTerm === "24bit") return "truecolor";

  // Check TERM for 256-color support
  if (term.includes("256color") || term.includes("256")) return "256";

  // Check for common terminals that support TrueColor
  const termProgram = envObj.TERM_PROGRAM || "";
  if (
    termProgram === "iTerm.app" ||
    termProgram === "Apple_Terminal" ||
    termProgram === "Hyper" ||
    termProgram === "vscode"
  ) {
    return "truecolor";
  }

  // Default to 16 colors for basic terminals
  if (term) return "16";

  return "none";
}

/**
 * Check if colors should be used
 */
export function shouldUseColor(): boolean {
  return getColorLevel() !== "none";
}

let cachedColorLevel: ColorLevel | null = null;

/**
 * Get cached color level (for performance)
 */
function getCachedColorLevel(): ColorLevel {
  if (cachedColorLevel === null) {
    cachedColorLevel = getColorLevel();
  }
  return cachedColorLevel;
}

/**
 * Reset the cached color level (useful for testing)
 */
export function resetColorCache(): void {
  cachedColorLevel = null;
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

/**
 * Find nearest ANSI 256 color
 */
function rgbTo256(r: number, g: number, b: number): number {
  // Check grayscale ramp first (232-255)
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round((r - 8) / 247 * 24) + 232;
  }

  // Use 6x6x6 color cube (16-231)
  const toIndex = (v: number) => Math.round(v / 255 * 5);
  return 16 + toIndex(r) * 36 + toIndex(g) * 6 + toIndex(b);
}

/**
 * Find nearest ANSI 16 color
 */
function rgbTo16(r: number, g: number, b: number): number {
  const brightness = (r + g + b) / 3;
  const bright = brightness > 127;

  // Determine which primary colors are present
  const hasRed = r > 127;
  const hasGreen = g > 127;
  const hasBlue = b > 127;

  if (!hasRed && !hasGreen && !hasBlue) {
    return bright ? 7 : 0; // white or black
  }

  let color = 0;
  if (hasRed) color += 1;
  if (hasGreen) color += 2;
  if (hasBlue) color += 4;

  return bright ? color + 8 : color;
}

/**
 * Smart color function that respects terminal capability
 * Automatically downgrades from TrueColor → 256 → 16 → none
 */
export function color(text: string, hex: string): string {
  const level = getCachedColorLevel();
  if (level === "none") return text;

  const { r, g, b } = hexToRgb(hex);

  switch (level) {
    case "truecolor":
      return `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[0m`;
    case "256":
      return `${ESC}[38;5;${rgbTo256(r, g, b)}m${text}${ESC}[0m`;
    case "16":
      return `${ESC}[${30 + rgbTo16(r, g, b)}m${text}${ESC}[0m`;
    default:
      return text;
  }
}

/**
 * Smart background color function
 */
export function bgColor(text: string, hex: string): string {
  const level = getCachedColorLevel();
  if (level === "none") return text;

  const { r, g, b } = hexToRgb(hex);

  switch (level) {
    case "truecolor":
      return `${ESC}[48;2;${r};${g};${b}m${text}${ESC}[0m`;
    case "256":
      return `${ESC}[48;5;${rgbTo256(r, g, b)}m${text}${ESC}[0m`;
    case "16":
      return `${ESC}[${40 + rgbTo16(r, g, b)}m${text}${ESC}[0m`;
    default:
      return text;
  }
}

// True color (24-bit) support - direct functions (for backwards compatibility)
const rgb = (r: number, g: number, b: number) => (text: string) => {
  const level = getCachedColorLevel();
  if (level === "none") return text;
  if (level === "truecolor") return `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[0m`;
  if (level === "256") return `${ESC}[38;5;${rgbTo256(r, g, b)}m${text}${ESC}[0m`;
  return `${ESC}[${30 + rgbTo16(r, g, b)}m${text}${ESC}[0m`;
};

const bgRgb = (r: number, g: number, b: number) => (text: string) => {
  const level = getCachedColorLevel();
  if (level === "none") return text;
  if (level === "truecolor") return `${ESC}[48;2;${r};${g};${b}m${text}${ESC}[0m`;
  if (level === "256") return `${ESC}[48;5;${rgbTo256(r, g, b)}m${text}${ESC}[0m`;
  return `${ESC}[${40 + rgbTo16(r, g, b)}m${text}${ESC}[0m`;
};

// Brand colors
export const brand = rgb(0, 163, 244); // #00A3F4
export const brandBg = bgRgb(0, 163, 244);

// Semantic colors
export const success = rgb(34, 197, 94); // Green
export const error = rgb(239, 68, 68); // Red
export const warning = rgb(234, 179, 8); // Yellow
export const muted = rgb(113, 113, 122); // Gray

// Text styles
export const bold = (text: string) => `${ESC}[1m${text}${ESC}[0m`;
export const dim = (text: string) => `${ESC}[2m${text}${ESC}[0m`;
export const italic = (text: string) => `${ESC}[3m${text}${ESC}[0m`;
export const underline = (text: string) => `${ESC}[4m${text}${ESC}[0m`;

// Compound styles
export const brandBold = (text: string) => bold(brand(text));
export const successBold = (text: string) => bold(success(text));
export const errorBold = (text: string) => bold(error(text));

// Reset
export const reset = `${ESC}[0m`;

// Matrix dot states for animation
const MATRIX_STATES = [
  ["●", "○", "○"],
  ["○", "●", "○"],
  ["○", "○", "●"],
  ["○", "●", "○"],
];

/**
 * Create animated matrix (3 dots)
 * Returns colored dots based on frame
 */
export function animatedMatrix(frame: number): string {
  const stateIndex = frame % MATRIX_STATES.length;
  const state = MATRIX_STATES[stateIndex] ?? ["●", "○", "○"];

  return state.map((dot) => {
    if (dot === "●") {
      return brand(dot);
    } else {
      return muted(dot);
    }
  }).join("");
}
