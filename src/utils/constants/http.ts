export { MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_MINUTE } from "./cache.ts";

export const KB_IN_BYTES = 1024;

/** Shared HTTP module fetch timeout ms value. */
export const HTTP_MODULE_FETCH_TIMEOUT_MS = 2500;
export const HTTP_FETCH_TIMEOUT_MS =
  30000; /** Default timeout for HTTP module/bundle fetch operations (30 seconds) */

export const HMR_RECONNECT_DELAY_MS = 1000;
export const HMR_RELOAD_DELAY_MS = 1000;
export const HMR_FILE_WATCHER_DEBOUNCE_MS = 100;
export const HMR_KEEP_ALIVE_INTERVAL_MS = 30000;

export const DASHBOARD_RECONNECT_DELAY_MS = 3000;

export const SERVER_FUNCTION_DEFAULT_TIMEOUT_MS = 30000;

/** Shared prefetch max size bytes value. */
export const PREFETCH_MAX_SIZE_BYTES = 200 * KB_IN_BYTES;
/** Shared prefetch default timeout ms value. */
export const PREFETCH_DEFAULT_TIMEOUT_MS = 10000;
/** Shared prefetch default delay ms value. */
export const PREFETCH_DEFAULT_DELAY_MS = 200;

/** Shared HTTP ok value. */
export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_NO_CONTENT = 204;
/** Shared HTTP redirect found value. */
export const HTTP_REDIRECT_FOUND = 302;
export const HTTP_NOT_MODIFIED = 304;

/** Shared HTTP bad request value. */
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
/** Shared HTTP not found value. */
export const HTTP_NOT_FOUND = 404;
export const HTTP_METHOD_NOT_ALLOWED = 405;
export const HTTP_GONE = 410;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
export const HTTP_URI_TOO_LONG = 414;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE = 431;

export const HTTP_INTERNAL_SERVER_ERROR = 500;
/** Shared HTTP server error value. */
export const HTTP_SERVER_ERROR = HTTP_INTERNAL_SERVER_ERROR; // Alias for convenience
/** Shared HTTP not implemented value. */
export const HTTP_NOT_IMPLEMENTED = 501;
export const HTTP_BAD_GATEWAY = 502;
/** Shared HTTP unavailable value. */
export const HTTP_UNAVAILABLE = 503;
export const HTTP_GATEWAY_TIMEOUT = 504;
/** Shared HTTP network connect timeout value. */
export const HTTP_NETWORK_CONNECT_TIMEOUT = 599;

/** Shared HTTP status success min value. */
export const HTTP_STATUS_SUCCESS_MIN = 200;
/** Shared HTTP status redirect min value. */
export const HTTP_STATUS_REDIRECT_MIN = 300;
/** Shared HTTP status client error min value. */
export const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
/** Shared HTTP status server error min value. */
export const HTTP_STATUS_SERVER_ERROR_MIN = 500;

/** Shared HTTP content types value. */
export const HTTP_CONTENT_TYPES = {
  JS: "application/javascript; charset=utf-8",
  JSON: "application/json; charset=utf-8",
  HTML: "text/html; charset=utf-8",
  CSS: "text/css; charset=utf-8",
  TEXT: "text/plain; charset=utf-8",
} as const;

/** Shared HTTP content type image png value. */
export const HTTP_CONTENT_TYPE_IMAGE_PNG = "image/png";
/** Shared HTTP content type image jpeg value. */
export const HTTP_CONTENT_TYPE_IMAGE_JPEG = "image/jpeg";
/** Shared HTTP content type image webp value. */
export const HTTP_CONTENT_TYPE_IMAGE_WEBP = "image/webp";
export const HTTP_CONTENT_TYPE_IMAGE_AVIF = "image/avif";
/** Shared HTTP content type image svg value. */
export const HTTP_CONTENT_TYPE_IMAGE_SVG = "image/svg+xml";
/** Shared HTTP content type image gif value. */
export const HTTP_CONTENT_TYPE_IMAGE_GIF = "image/gif";
/** Shared HTTP content type image ico value. */
export const HTTP_CONTENT_TYPE_IMAGE_ICO = "image/x-icon";
