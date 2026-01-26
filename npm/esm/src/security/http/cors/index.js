import { applyCORSHeaders, applyCORSHeadersSync, shouldApplyCORS } from "./headers.js";
import { validateCORSConfig, validateOrigin, validateOriginSync } from "./validators.js";
export { handleCORSPreflight, isPreflightRequest } from "./preflight.js";
export { cors, corsSimple } from "./middleware.js";
export { applyCORSHeaders, applyCORSHeadersSync, shouldApplyCORS, validateCORSConfig, validateOrigin, validateOriginSync, };
export { DEFAULT_HEADERS, DEFAULT_MAX_AGE, DEFAULT_METHODS, HTTP_FORBIDDEN, HTTP_NO_CONTENT, } from "./constants.js";
