/**
 * Test Configuration Constants
 *
 * Centralized constants for test timeouts, thresholds, and configuration.
 * Use these to ensure consistency across all tests.
 */

/**
 * Standard test timeout values (in milliseconds)
 *
 * Usage:
 * ```typescript
 * import { TEST_TIMEOUTS } from "../_helpers/constants.ts";
 *
 * Deno.test({
 *   name: "should complete within timeout",
 *   fn: async () => { ... },
 *   timeout: TEST_TIMEOUTS.INTEGRATION,
 * });
 * ```
 */
export const TEST_TIMEOUTS = {
  /** Unit tests: 5 seconds (fast, no I/O) */
  UNIT: 5_000,

  /** Integration tests: 30 seconds (involves I/O, multiple components) */
  INTEGRATION: 30_000,

  /** End-to-end tests: 60 seconds (full server/client interaction) */
  E2E: 60_000,

  /** Build/compilation tests: 2 minutes (heavy processing) */
  BUILD: 120_000,

  /** Server startup: 10 seconds (waiting for server to be ready) */
  SERVER_STARTUP: 10_000,

  /** HMR/Hot reload: 15 seconds (file watching and reload) */
  HMR: 15_000,
} as const;

/**
 * Port allocation range for test servers
 */
export const PORT_RANGE = {
  MIN: 9000,
  MAX: 12000,
} as const;

/**
 * Server ready check configuration
 */
export const SERVER_CONFIG = {
  /** Maximum attempts to check if server is ready */
  MAX_READY_ATTEMPTS: 20,

  /** Base delay between ready checks (ms) */
  READY_CHECK_DELAY: 100,

  /** Maximum delay with exponential backoff (ms) */
  MAX_READY_DELAY: 2000,

  /** Timeout for fetch requests during ready checks (ms) */
  FETCH_TIMEOUT: 2000,
} as const;

/**
 * Resource cleanup configuration
 */
export const CLEANUP_CONFIG = {
  /** Timeout for graceful cleanup (ms) */
  GRACEFUL_TIMEOUT: 5000,

  /** Timeout for force cleanup (ms) */
  FORCE_TIMEOUT: 1000,

  /** Delay between cleanup attempts (ms) */
  CLEANUP_RETRY_DELAY: 50,
} as const;

/**
 * Test data size limits
 */
export const DATA_LIMITS = {
  /** Maximum file size for test fixtures (bytes) */
  MAX_FIXTURE_SIZE: 1024 * 1024, // 1MB

  /** Maximum number of test items in bulk operations */
  MAX_BULK_ITEMS: 1000,

  /** Maximum string length for test assertions */
  MAX_STRING_LENGTH: 10_000,
} as const;

/**
 * Performance budgets for tests
 */
export const PERFORMANCE_BUDGETS = {
  /** SSR rendering time budget (ms) */
  SSR_RENDER: 100,

  /** API response time budget (ms) */
  API_RESPONSE: 50,

  /** Cache hit response time budget (ms) */
  CACHE_HIT: 10,

  /** File read operation budget (ms) */
  FILE_READ: 20,

  /** Build time per component budget (ms) */
  BUILD_PER_COMPONENT: 500,
} as const;

/**
 * Test retry configuration for flaky operations
 */
export const RETRY_CONFIG = {
  /** Default number of retries for flaky operations */
  DEFAULT_RETRIES: 3,

  /** Delay between retries (ms) */
  RETRY_DELAY: 100,

  /** Maximum total time for all retries (ms) */
  MAX_RETRY_TIME: 10_000,
} as const;

/**
 * WebSocket test configuration
 */
export const WEBSOCKET_CONFIG = {
  /** Timeout for WebSocket connection (ms) */
  CONNECTION_TIMEOUT: 5000,

  /** Timeout for waiting for messages (ms) */
  MESSAGE_TIMEOUT: 2000,

  /** Number of ping/pong cycles for health check */
  HEALTH_CHECK_CYCLES: 3,
} as const;

/**
 * Environment variable keys used in tests
 */
export const TEST_ENV_VARS = {
  /** Enable debug output in tests */
  DEBUG: "DEBUG_TESTS",

  /** Disable LRU cache intervals in tests */
  DISABLE_LRU: "VF_DISABLE_LRU_INTERVAL",

  /** Force specific runtime adapter */
  FORCE_ADAPTER: "VF_FORCE_ADAPTER",

  /** Enable verbose logging */
  VERBOSE: "VF_TEST_VERBOSE",
} as const;

/**
 * Test isolation markers
 */
export const ISOLATION_MARKERS = {
  /** Temp directory prefix for test isolation */
  TEMP_DIR_PREFIX: "veryfront_test_",

  /** Port allocation prefix for logging */
  PORT_LOG_PREFIX: "[TEST-PORT]",

  /** Context lifecycle prefix for logging */
  CONTEXT_LOG_PREFIX: "[TEST-CONTEXT]",
} as const;
