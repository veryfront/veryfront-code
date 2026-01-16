/**
 * CLI UI Constants
 *
 * Centralized configuration values for CLI components.
 * Eliminates magic numbers scattered across the codebase.
 */

// === Ports ===

/** Default port for dev server */
export const DEFAULT_DEV_PORT = 3000;

/** Default port for proxy server */
export const DEFAULT_PROXY_PORT = 8080;

// === Timing ===

/** Spinner animation interval in milliseconds */
export const SPINNER_INTERVAL_MS = 80;

/** TUI render interval in milliseconds */
export const RENDER_INTERVAL_MS = 100;

/** Shutdown timeout before force exit in milliseconds */
export const SHUTDOWN_TIMEOUT_MS = 3000;

/** Default typewriter character delay in milliseconds */
export const TYPEWRITER_CHAR_DELAY_MS = 30;

/** Default typewriter word delay in milliseconds */
export const TYPEWRITER_WORD_DELAY_MS = 100;

// === Layout ===

/** Default horizontal padding inside boxes */
export const DEFAULT_PADDING_X = 2;

/** Default vertical padding inside boxes */
export const DEFAULT_PADDING_Y = 1;

/** Default progress bar width */
export const DEFAULT_PROGRESS_BAR_WIDTH = 20;

/** Default terminal width fallback */
export const DEFAULT_TERMINAL_WIDTH = 80;

/** Default terminal height fallback */
export const DEFAULT_TERMINAL_HEIGHT = 24;

// === Duration formatting thresholds ===

/** Threshold for showing seconds instead of milliseconds */
export const DURATION_SECONDS_THRESHOLD_MS = 1000;

/** Threshold for showing minutes instead of seconds */
export const DURATION_MINUTES_THRESHOLD_MS = 60000;
