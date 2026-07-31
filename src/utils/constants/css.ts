/**
 * Provider-neutral CSS resource admission limits.
 *
 * These values are shared by source discovery, request-time compilation, and
 * build optimization. Keeping them below those layers prevents Server and HTML
 * code from importing Build solely to agree on resource policy.
 */
export const MAX_CSS_FILES = 10_000;
export const MAX_CSS_DIRECTORY_DEPTH = 64;
export const MAX_CSS_DIRECTORY_ENTRIES = 100_000;
export const MAX_CSS_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_CSS_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_CSS_OUTPUT_FILE_BYTES = 32 * 1024 * 1024;
/** Shared compiler/purger ceiling for retained selector candidate evidence. */
export const MAX_CSS_SELECTOR_TOKENS = 100_000;
/** Maximum characters in one class/selector candidate token. */
export const MAX_CSS_SELECTOR_TOKEN_CHARACTERS = 1_024;
