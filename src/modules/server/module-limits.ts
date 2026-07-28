import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

/** Maximum UTF-8 bytes admitted for one module source. */
export const MAX_SERVABLE_MODULE_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;

/** Maximum UTF-8 bytes retained after any module transformation stage. */
export const MAX_SERVABLE_MODULE_OUTPUT_BYTES = 16 * 1024 * 1024;
