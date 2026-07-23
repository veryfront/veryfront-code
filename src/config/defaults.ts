import { DEFAULT_PORT, LOCALHOST } from "#veryfront/platform/compat/constants.ts";
export { DEFAULT_PORT };
/** Default hostname used by the development server. */
export const DEFAULT_DEV_HOST = LOCALHOST.HOSTNAME;
/** Default framework operation timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 5000;
/** Default server-side rendering timeout in milliseconds. */
export const SSR_TIMEOUT_MS = 10000;
/** Default sandbox operation timeout in milliseconds. */
export const SANDBOX_TIMEOUT_MS = 5000;

/** Timeout for user data fetching functions (getServerData, getStaticData) */
export const DATA_FETCH_TIMEOUT_MS = 10000;

/** Default maximum number of entries in the JIT bundle cache. */
export const DEFAULT_CACHE_MAX_SIZE = 100;

/** Default project title used when a project config omits one. */
export const DEFAULT_PROJECT_TITLE = "Veryfront App";
/** Default project description used when a project config omits one. */
export const DEFAULT_PROJECT_DESCRIPTION = "Built with Veryfront";
/** Default maximum number of entries in the page render cache. */
export const DEFAULT_RENDER_CACHE_MAX_ENTRIES = 500;

/** Default duration histogram boundaries in milliseconds. */
export const DURATION_HISTOGRAM_BOUNDARIES_MS: readonly [
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
] = Object.freeze(
  [
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
  ] as const,
);

/** Default payload-size histogram boundaries in kibibytes. */
export const SIZE_HISTOGRAM_BOUNDARIES_KB: readonly [
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
] = Object.freeze(
  [
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
  ] as const,
);

/** Shared immutable defaults used by low-level framework infrastructure. */
export type DefaultConfig = Readonly<{
  server: Readonly<{ port: typeof DEFAULT_PORT; hostname: "0.0.0.0" }>;
  timeouts: Readonly<{
    default: typeof DEFAULT_TIMEOUT_MS;
    api: 30000;
    ssr: typeof SSR_TIMEOUT_MS;
    hmr: 30000;
    sandbox: typeof SANDBOX_TIMEOUT_MS;
  }>;
  cache: Readonly<{
    jit: Readonly<{ maxSize: typeof DEFAULT_CACHE_MAX_SIZE; tempDirPrefix: "vf-bundle-" }>;
  }>;
  metrics: Readonly<{ ssrBoundaries: typeof DURATION_HISTOGRAM_BOUNDARIES_MS }>;
}>;

/** Immutable low-level framework defaults. */
export const defaultConfig: DefaultConfig = Object.freeze(
  {
    server: Object.freeze({
      port: DEFAULT_PORT,
      hostname: "0.0.0.0",
    }),
    timeouts: Object.freeze({
      default: DEFAULT_TIMEOUT_MS,
      api: 30000,
      ssr: SSR_TIMEOUT_MS,
      hmr: 30000,
      sandbox: SANDBOX_TIMEOUT_MS,
    }),
    cache: Object.freeze({
      jit: Object.freeze({
        maxSize: DEFAULT_CACHE_MAX_SIZE,
        tempDirPrefix: "vf-bundle-",
      }),
    }),
    metrics: Object.freeze({
      ssrBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS,
    }),
  } as const,
);

/** Default delay before client-side prefetching in milliseconds. */
export const DEFAULT_PREFETCH_DELAY_MS = 100;
/** Default metrics collection interval in milliseconds. */
export const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;
/** Default number of keys requested by each Redis scan. */
export const DEFAULT_REDIS_SCAN_COUNT = 100;
/** Default number of Redis keys deleted per batch. */
export const DEFAULT_REDIS_BATCH_DELETE_SIZE = 1000;
/** Default client page-transition delay in milliseconds. */
export const PAGE_TRANSITION_DELAY_MS = 150;
