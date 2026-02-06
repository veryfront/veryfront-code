/**
 * UI-specific constants for terminal rendering
 * @module cli/ui/constants
 */

export { DEFAULT_DEV_PORT, DEFAULT_PROXY_PORT, SHUTDOWN_TIMEOUT_MS } from "../shared/constants.ts";

export const SPINNER_INTERVAL_MS = 80;
export const RENDER_INTERVAL_MS = 100;
export const TYPEWRITER_CHAR_DELAY_MS = 30;
export const TYPEWRITER_WORD_DELAY_MS = 100;

export const DEFAULT_PADDING_X = 2;
export const DEFAULT_PADDING_Y = 1;
export const DEFAULT_PROGRESS_BAR_WIDTH = 20;
export const DEFAULT_TERMINAL_WIDTH = 80;
export const DEFAULT_TERMINAL_HEIGHT = 24;

export const DURATION_SECONDS_THRESHOLD_MS = 1000;
export const DURATION_MINUTES_THRESHOLD_MS = 60000;
