export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
export const DEFAULT_RETRY_MAX_DELAY_MS = 5000;
export const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;

export const API_RETRY_MAX_ATTEMPTS = 3;
export const API_RETRY_INITIAL_DELAY_MS = 1000;
export const API_RETRY_MAX_DELAY_MS = 10000;

/**
 * Historical filesystem retry constant.
 *
 * @deprecated This name does not distinguish GitHub's legacy total-attempt
 * semantics from Veryfront API retries-after-initial semantics. Its value is
 * retained for source compatibility; use the backend-specific defaults or
 * `FS_RETRY_MAX_TOTAL_ATTEMPTS`.
 */
export const FS_RETRY_MAX_ATTEMPTS = 3;
/** Default Veryfront API retries after the initial request. */
export const VERYFRONT_API_DEFAULT_MAX_RETRIES = 3;
/** Default Veryfront API filesystem retries after the initial request. */
export const VERYFRONT_FS_DEFAULT_MAX_RETRIES = VERYFRONT_API_DEFAULT_MAX_RETRIES;
/** Default GitHub filesystem total-attempt budget. */
export const GITHUB_FS_DEFAULT_MAX_ATTEMPTS = 3;
/** Maximum permitted outbound attempts for one Veryfront API request. */
export const VERYFRONT_API_MAX_TOTAL_ATTEMPTS = 10;
/** Maximum permitted outbound attempts for one filesystem API request. */
export const FS_RETRY_MAX_TOTAL_ATTEMPTS = VERYFRONT_API_MAX_TOTAL_ATTEMPTS;
export const FS_RETRY_INITIAL_DELAY_MS = 1000;
export const FS_RETRY_MAX_DELAY_MS = 10000;

export const WS_RECONNECT_MAX_ATTEMPTS = 5;
export const WS_RECONNECT_INITIAL_DELAY_MS = 1000;
export const WS_RECONNECT_MAX_DELAY_MS = 30000;
