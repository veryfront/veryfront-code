/**
 * RSC-specific constants
 *
 * For URL paths, imports from the centralized server constants.
 */

import { INTERNAL_PATH_PREFIXES } from "../../core/utils/constants/server.ts";

export const RSC_FILE_READ_BUFFER_SIZE = 2048;

/** RSC path prefix - from centralized constants */
export const RSC_PATH_PREFIX = INTERNAL_PATH_PREFIXES.RSC;

/** FS path prefix - from centralized constants */
export const FS_PATH_PREFIX = INTERNAL_PATH_PREFIXES.FS;

export const HYDRATION_DATA_ID = "veryfront-hydration-data";
export const RSC_ROOT_ID = "rsc-root";
