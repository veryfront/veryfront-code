
import { applyCORSHeaders, applyCORSHeadersSync, shouldApplyCORS } from "./headers.ts";
import { validateCORSConfig, validateOrigin, validateOriginSync } from "./validators.ts";

export { handleCORSPreflight, isPreflightRequest } from "./preflight.ts";
export {
  applyCORSHeaders,
  applyCORSHeadersSync,
  shouldApplyCORS,
  validateCORSConfig,
  validateOrigin,
  validateOriginSync,
};
export { cors, corsSimple } from "./middleware.ts";

export type {
  CORSConfig,
  CORSHeaderOptions,
  CORSPreflightOptions,
  CORSValidationResult,
  OriginValidator,
} from "./types.ts";

export {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
  isProductionMode,
} from "./constants.ts";
