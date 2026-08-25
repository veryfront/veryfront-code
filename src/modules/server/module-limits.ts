import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

/**
 * Maximum UTF-8 bytes admitted for one served module source.
 *
 * Matches MAX_CROSS_PROJECT_SOURCE_BYTES so a module costs the same bound
 * whether it arrives from the local project or a cross-project registry.
 */
export const MAX_SERVABLE_MODULE_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;
