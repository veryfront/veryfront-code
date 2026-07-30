import { MAX_CACHE_KEY_CHARACTERS } from "#veryfront/utils/constants/limits.ts";

/**
 * Resource bounds for public data identities and retained static-data graphs.
 *
 * These limits are deliberately independent of request-server limits: data
 * APIs are callable directly from JavaScript and must remain bounded even when
 * no HTTP validation layer ran first.
 */

export const MAX_DATA_SCOPE_VERSION_CHARACTERS = 1_024;
export const MAX_DATA_MODULE_PATH_CHARACTERS = 4_096;
export const MAX_DATA_PROJECT_DIR_CHARACTERS = 4_096;
export const MAX_DATA_URL_CHARACTERS = 64 * 1_024;
export const MAX_DATA_QUERY_CHARACTERS = 64 * 1_024;
export const MAX_DATA_INVALIDATION_PATTERN_CHARACTERS = 4_096;
export const MAX_DATA_PATHNAME_CHARACTERS = 4_096;
export const MAX_DATA_CACHE_KEY_CHARACTERS = MAX_CACHE_KEY_CHARACTERS;

export const MAX_DATA_PARAM_PROPERTIES = 256;
export const MAX_DATA_PARAM_KEY_CHARACTERS = 1_024;
export const MAX_DATA_PARAM_VALUE_CHARACTERS = 4_096;
export const MAX_DATA_PARAM_ARRAY_SEGMENTS = 1_024;
export const MAX_DATA_SERIALIZED_PARAMS_CHARACTERS = 64 * 1_024;

/** Maximum nesting admitted into one retained static-data result. */
export const MAX_DATA_CACHE_SNAPSHOT_DEPTH = 64;
/** Maximum primitive/reference visits admitted into one retained result. */
export const MAX_DATA_CACHE_SNAPSHOT_NODES = 100_000;
/** Maximum deterministic retained-size charge for one result graph. */
export const MAX_DATA_CACHE_SNAPSHOT_BYTES = 10 * 1_024 * 1_024;
