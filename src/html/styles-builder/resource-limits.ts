/** Shared resource limits for CSS generation and cache serialization. */

export const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;
export const MAX_GENERATED_CSS_BYTES = 16 * 1024 * 1024;
export const MAX_CSS_CANDIDATES = 50_000;
export const MAX_CSS_CANDIDATE_BYTES = 1024;
export const MAX_TOTAL_CSS_CANDIDATE_BYTES = 4 * 1024 * 1024;
export const MAX_STYLE_SOURCE_FILES = 10_000;
export const MAX_STYLE_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_STYLE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_STYLE_SOURCE_PATH_BYTES = 4 * 1024;
export const MAX_CSS_IMPORTS = 10_000;
export const MAX_CSS_IMPORT_SPECIFIER_BYTES = 4 * 1024;

// Local caches retain JavaScript strings, which can occupy roughly two bytes per
// code unit. These ceilings leave room for one maximum-size valid entry while
// preventing entry-count limits from retaining gigabytes of generated CSS.
export const MAX_LOCAL_HASH_CSS_CACHE_BYTES = 56 * 1024 * 1024;
export const MAX_LOCAL_CSS_INPUTS_CACHE_BYTES = 16 * 1024 * 1024;
export const MAX_LOCAL_PROJECT_CSS_CACHE_BYTES = 40 * 1024 * 1024;
export const MAX_LOCAL_PREPARED_CSS_CACHE_BYTES = 40 * 1024 * 1024;

const UTF8_ENCODER = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}
