import type { CSSOptimizationOptions } from "./types/index.ts";
import { CSS_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
export {
  MAX_CSS_DIRECTORY_DEPTH,
  MAX_CSS_DIRECTORY_ENTRIES,
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";

export const CSS_MANIFEST_FILENAME = "css-manifest.json";
export const MAX_CSS_TOTAL_OUTPUT_BYTES = 128 * 1024 * 1024;
export const MAX_CSS_MANIFEST_BYTES = 256 * 1024 * 1024;
export const MAX_CSS_PURGE_PATTERNS = CSS_OPTIMIZATION.MAX_PURGE_PATTERNS;
export const MAX_CSS_PURGE_SAFELIST_ENTRIES = CSS_OPTIMIZATION.MAX_PURGE_SAFELIST_ENTRIES;

export const DEFAULT_CSS_OPTIONS: Omit<
  Required<CSSOptimizationOptions>,
  "projectDir" | "autoprefixer" | "browsers"
> = {
  enabled: true,
  minify: true,
  purge: false,
  criticalCSS: false,
  inputFiles: [],
  inputDir: "./styles",
  outputDir: "./.veryfront/optimized-css",
  purgeContent: [
    "./app/**/*.{tsx,jsx,ts,js}",
    "./pages/**/*.{tsx,jsx,ts,js}",
  ],
  purgeSafelist: [],
  sourceMap: false,
};
