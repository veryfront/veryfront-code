/**
 * Hard upper bound for a single cold model load.
 *
 * The largest curated model is approximately 6 GB. Two hours permits a
 * sustained download rate below 1 MB/s while still preventing a stalled
 * vendor load from holding callers indefinitely.
 */
export const DEFAULT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

/** Maximum configurable cold-load deadline. */
export const MAX_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
