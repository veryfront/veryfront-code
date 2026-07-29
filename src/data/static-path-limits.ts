/** Maximum number of Pages Router paths materialized by one production build. */
export const MAX_BUILD_STATIC_PATHS = 10_000;

/** Maximum JavaScript string length of one materialized production route path. */
export const MAX_BUILD_STATIC_PATH_CHARACTERS = 2_048;

/** Maximum number of segments accepted for one catch-all route parameter. */
export const MAX_BUILD_STATIC_CATCH_ALL_SEGMENTS = 1_024;

/** Aggregate UTF-8 budget for all materialized Pages Router paths. */
export const MAX_BUILD_STATIC_PATH_UTF8_BYTES = 16 * 1_024 * 1_024;
