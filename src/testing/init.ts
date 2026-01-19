/**
 * Test environment initialization.
 *
 * This module sets up the testing environment by disabling features
 * that can cause resource leaks in tests, like LRU cache cleanup intervals.
 *
 * IMPORTANT: Import this module before any other veryfront imports in test files
 * to ensure the flags are set before module-level caches are initialized.
 *
 * @module
 */

// Disable LRU interval to prevent module-level LRU caches from starting
// cleanup intervals that leak timers and cause test failures.
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

// Mark test runtime for environment-sensitive code paths.
(globalThis as Record<string, unknown>).__vfTestEnv = true;

// Mask host env vars that should not affect test outcomes.
(globalThis as Record<string, unknown>).__vfTestEnvMask = {
  prefixes: [
    "VERYFRONT_",
    "OTEL_",
    "OAUTH_",
    "GITHUB_",
    "OPENAI_",
    "ANTHROPIC_",
    "GOOGLE_",
  ],
  keys: ["PROXY_MODE"],
};

/**
 * Marker that test initialization has run.
 * Can be checked by other modules to verify proper init order.
 */
export const TEST_ENV_INITIALIZED = true;
