/********** SSR render time histogram boundaries (ms) **********/
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

export const HTTP_REQUEST_DURATION_BOUNDARIES_MS = SSR_RENDER_TIME_BOUNDARIES_MS;

/********** RSC stream duration boundaries (ms) **********/
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

export const DEFAULT_METRICS_COLLECTION_INTERVAL_MS = 60000;

export const DEFAULT_RATE_LIMIT_REQUESTS = 100;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;

export const CACHE_METRICS_SAMPLE_SIZE = 100;
