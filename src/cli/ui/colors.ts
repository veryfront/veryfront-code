/**
 * Veryfront CLI Colors
 * Brand: #00A3F4 (blue), #FFFFFF (white), #000000 (black)
 */

const ESC = "\x1b";

// True color (24-bit) support
const rgb = (r: number, g: number, b: number) => (text: string) =>
  `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[0m`;

const bgRgb = (r: number, g: number, b: number) => (text: string) =>
  `${ESC}[48;2;${r};${g};${b}m${text}${ESC}[0m`;

// Brand colors
export const brand = rgb(0, 163, 244);      // #00A3F4
export const brandBg = bgRgb(0, 163, 244);

// Semantic colors
export const success = rgb(34, 197, 94);    // Green
export const error = rgb(239, 68, 68);      // Red
export const warning = rgb(234, 179, 8);    // Yellow
export const muted = rgb(113, 113, 122);    // Gray

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
