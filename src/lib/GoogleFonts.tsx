/**
 * Re-export GoogleFonts from veryfront/fonts for backward compatibility.
 *
 * This file exists to support legacy imports like `import { GoogleFonts } from "@/lib/GoogleFonts"`.
 * All functionality is provided by the veryfront/fonts package.
 */

export { GoogleFonts, GoogleFonts as default } from "veryfront/fonts";
export type { GoogleFontsProps } from "veryfront/fonts";
