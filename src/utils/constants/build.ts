/** Default value for build concurrency. */
export const DEFAULT_BUILD_CONCURRENCY = 4;

/** Shared image optimization value. */
export const IMAGE_OPTIMIZATION = {
  DEFAULT_SIZES: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  DEFAULT_QUALITY: 80,
  MAX_DIMENSION: 32_768,
  MAX_OUTPUT_SIZES: 64,
  MAX_ENGINE_IDENTITY_CHARACTERS: 256,
  PUBLIC_PATH: "/_vf/assets/images",
} as const;

/** Shared CSS optimization resource bounds. */
export const CSS_OPTIMIZATION = {
  MAX_FILES: 10_000,
  MAX_BROWSER_QUERIES: 64,
  MAX_BROWSER_QUERY_CHARACTERS: 512,
  MAX_PURGE_PATTERNS: 128,
  MAX_PURGE_SAFELIST_ENTRIES: 1_024,
} as const;
