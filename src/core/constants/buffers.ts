/**
 * Buffer size and memory-related constants
 *
 * These constants define buffer sizes for various I/O operations,
 * memory limits, and chunk sizes for streaming data.
 */

/** Standard buffer sizes (powers of 2 for optimal memory alignment) */
export const BUFFER_SIZE_256_BYTES = 256;
export const BUFFER_SIZE_512_BYTES = 512;
export const BUFFER_SIZE_1_KB = 1024;
export const BUFFER_SIZE_2_KB = 2048;
export const BUFFER_SIZE_4_KB = 4096;
export const BUFFER_SIZE_8_KB = 8192;
export const BUFFER_SIZE_16_KB = 16384;
export const BUFFER_SIZE_32_KB = 32768;
export const BUFFER_SIZE_64_KB = 65536;

/**
 * RSC file reading buffer (2KB)
 * Used to read file headers to detect 'use client' and 'use server' directives
 */
export const RSC_FILE_READ_BUFFER_SIZE_BYTES = BUFFER_SIZE_2_KB;

/**
 * Default maximum body size for input validation (1MB)
 */
export const DEFAULT_MAX_BODY_SIZE_BYTES = 1024 * 1024;

/**
 * Default maximum URL length for input validation (2KB)
 */
export const DEFAULT_MAX_URL_LENGTH_BYTES = BUFFER_SIZE_2_KB;

/**
 * Default maximum HTTP header size (8KB)
 * Standard limit used by many web servers (nginx, Apache)
 */
export const DEFAULT_MAX_HEADER_SIZE_BYTES = BUFFER_SIZE_8_KB;

/**
 * Default maximum file upload size (5MB)
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Prefetch queue maximum size (1MB)
 * Total size of all prefetched resources in memory
 */
export const PREFETCH_QUEUE_MAX_SIZE_BYTES = 1024 * 1024;

/**
 * Maximum chunk size for bundling (4MB)
 */
export const MAX_BUNDLE_CHUNK_SIZE_BYTES = 4096 * 1024;
