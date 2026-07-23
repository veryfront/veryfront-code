/** Shared payload and resource limits for the Studio runtime. */
export const MAX_STUDIO_URL_LENGTH = 2_048;
/** Maximum JavaScript string length for Studio project, page, and Yjs identifiers. */
export const MAX_STUDIO_CONFIG_ID_LENGTH = 256;
/** Maximum JavaScript string length for a project-relative Studio page path. */
export const MAX_STUDIO_CONFIG_PATH_LENGTH = 4_096;
/** Maximum JavaScript string length for a request-scoped Studio CSP nonce. */
export const MAX_STUDIO_CONFIG_NONCE_LENGTH = 4_096;
/** Maximum Studio protocol identifier length outside injected bridge config. */
export const MAX_STUDIO_MESSAGE_ID_LENGTH = 512;
/** Maximum JavaScript string length for a correlated Studio screenshot request ID. */
export const MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH = 256;
export const MAX_STUDIO_SCREENSHOT_SECTIONS = 20;
export const MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET = 10_000_000;
export const MAX_STUDIO_SCREENSHOT_DATA_LENGTH = 32 * 1024 * 1024;
export const MAX_STUDIO_NAVIGATOR_DEPTH = 64;
export const MAX_STUDIO_NAVIGATOR_NODES = 2_000;
/** Maximum number of route parameters in a Studio page-transition message. */
export const MAX_STUDIO_ROUTE_PARAM_ENTRIES = 100;
/** Maximum route-parameter key length in a Studio page-transition message. */
export const MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH = 256;
/** Maximum route-parameter value length in a Studio page-transition message. */
export const MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH = 2_048;

// Message accounting uses two bytes per string character. Keep metadata
// headroom while allowing one complete bounded screenshot payload.
export const MAX_STUDIO_SCREENSHOT_MESSAGE_BYTES = MAX_STUDIO_SCREENSHOT_DATA_LENGTH * 2 +
  1024 * 1024;

// A navigator node contains nested position objects and a children array, so
// transport depth grows by roughly two for each tree level. Node accounting
// also includes every bounded primitive in the payload.
export const MAX_STUDIO_TREE_MESSAGE_DEPTH = MAX_STUDIO_NAVIGATOR_DEPTH * 2 + 12;
export const MAX_STUDIO_TREE_MESSAGE_NODES = MAX_STUDIO_NAVIGATOR_NODES * 20;
export const MAX_STUDIO_TREE_MESSAGE_BYTES = 32 * 1024 * 1024;
