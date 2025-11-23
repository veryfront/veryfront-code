/**
 * Metrics and observability constants
 *
 * These constants define histogram boundaries, time buckets,
 * and other metrics-related configuration values.
 */

/**
 * SSR render time histogram boundaries (in milliseconds)
 * Used to bucket SSR rendering times for performance analysis
 *
 * Buckets: 5ms, 10ms, 25ms, 50ms, 75ms, 100ms, 250ms, 500ms, 750ms,
 *          1s, 2.5s, 5s, 7.5s, 10s
 */
export const SSR_RENDER_TIME_BOUNDARIES_MS = [
  5,
  10,
  25,
  50,
  75,
  100,
  250,
  500,
  750,
  1000,
  2500,
  5000,
  7500,
  10000,
];

/**
 * HTTP request duration histogram boundaries (in milliseconds)
 * Similar buckets for general HTTP request timing
 */
export const HTTP_REQUEST_DURATION_BOUNDARIES_MS = SSR_RENDER_TIME_BOUNDARIES_MS;

/**
 * RSC stream duration boundaries (in milliseconds)
 */
export const RSC_STREAM_DURATION_BOUNDARIES_MS = [
  10,
  25,
  50,
  100,
  200,
  500,
  1000,
  2000,
  5000,
];

/**
 * Default metrics collection interval (60 seconds)
 * How often to collect and export metrics
 */
export const DEFAULT_METRICS_COLLECTION_INTERVAL_MS = 60000;

/**
 * Default rate limiter settings
 */
export const DEFAULT_RATE_LIMIT_REQUESTS = 100;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

/**
 * Cache statistics sample size for metrics
 */
export const CACHE_METRICS_SAMPLE_SIZE = 100;
