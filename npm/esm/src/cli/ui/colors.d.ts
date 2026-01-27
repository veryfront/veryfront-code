import { RESET } from "./ansi.js";
export type ColorLevel = "truecolor" | "256" | "16" | "none";
export declare function getColorLevel(): ColorLevel;
export declare function shouldUseColor(): boolean;
export declare function resetColorCache(): void;
export declare function color(text: string, hex: string): string;
export declare function bgColor(text: string, hex: string): string;
export declare const brand: (text: string) => string;
export declare const brandBg: (text: string) => string;
export declare const success: (text: string) => string;
export declare const error: (text: string) => string;
export declare const warning: (text: string) => string;
export declare const muted: (text: string) => string;
export declare const bold: (text: string) => string;
export declare const dim: (text: string) => string;
export declare const italic: (text: string) => string;
export declare const underline: (text: string) => string;
export declare const brandBold: (text: string) => string;
export declare const successBold: (text: string) => string;
export declare const errorBold: (text: string) => string;
export { RESET as reset };
export declare function animatedMatrix(frame: number): string;
/**
 * Apply shimmer effect to text - creates a wave of brightness moving across
 * @param text The text to shimmer
 * @param frame Current animation frame (increments over time)
 * @param waveWidth Width of the bright wave (default: 3 characters)
 * @returns Text with shimmer effect applied
 */
export declare function shimmer(text: string, frame: number, waveWidth?: number): string;
//# sourceMappingURL=colors.d.ts.map