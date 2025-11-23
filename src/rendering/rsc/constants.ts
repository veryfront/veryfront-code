/**
 * RSC (React Server Components) constants
 */

/**
 * File reading buffer size for RSC payloads (in bytes)
 *
 * Used when reading files to detect 'use client' and 'use server' directives.
 * Set to 2KB to capture directive comments in the first 20 lines of most files
 * while minimizing I/O overhead.
 */
export const RSC_FILE_READ_BUFFER_SIZE = 2048;
