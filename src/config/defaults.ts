export const DEFAULT_PORT = 3000;

export const DEFAULT_TIMEOUT_MS = 5000;

export const SSR_TIMEOUT_MS = 10000;

export const SANDBOX_TIMEOUT_MS = 5000;

/** Timeout for user data fetching functions (getServerData, getStaticData) */
export const DATA_FETCH_TIMEOUT_MS = 10000;

export const DEFAULT_CACHE_MAX_SIZE = 100;

export const defaultConfig = {
  server: {
    port: DEFAULT_PORT,
    hostname: "0.0.0.0",
  },

  timeouts: {
    default: DEFAULT_TIMEOUT_MS,
    api: 30000,
    ssr: SSR_TIMEOUT_MS,
    hmr: 30000,
    sandbox: SANDBOX_TIMEOUT_MS,
  },

  cache: {
    jit: {
      maxSize: DEFAULT_CACHE_MAX_SIZE,
      tempDirPrefix: "vf-bundle-",
    },
  },

  metrics: {
    ssrBoundaries: [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000],
  },
} as const;

export const DEFAULT_PREFETCH_DELAY_MS = 100;

export const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;

export const DURATION_HISTOGRAM_BOUNDARIES_MS = [
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

export const SIZE_HISTOGRAM_BOUNDARIES_KB = [
  1,
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1000,
  2500,
  5000,
  10000,
];

export const DEFAULT_REDIS_SCAN_COUNT = 100;

export const DEFAULT_REDIS_BATCH_DELETE_SIZE = 1000;

export const PAGE_TRANSITION_DELAY_MS = 150;

export type DefaultConfig = typeof defaultConfig;
