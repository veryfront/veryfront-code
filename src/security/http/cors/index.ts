/**
 * CORS Module
 * Consolidated CORS handling for the Veryfront framework
 *
 * This module provides a unified, secure, and feature-complete CORS implementation
 * that replaces multiple scattered CORS handlers throughout the codebase.
 *
 * Features:
 * - Secure by default (no CORS without explicit configuration)
 * - Complete preflight handling with proper error responses
 * - Origin validation (string, array, function)
 * - Credentials support with security validations
 * - Configurable methods, headers, and cache duration
 * - Comprehensive logging for debugging
 *
 * @module core/cors
 */

import { applyCORSHeaders, applyCORSHeadersSync, shouldApplyCORS } from "./headers.ts";
import { validateCORSConfig, validateOrigin, validateOriginSync } from "./validators.ts";

// Main exports for CORS functionality
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

// Type exports
export type {
  CORSConfig,
  CORSHeaderOptions,
  CORSPreflightOptions,
  CORSValidationResult,
  OriginValidator,
} from "./types.ts";

// Constant exports (excluding DEV_LOCALHOST_ORIGINS to avoid conflict with config/network-defaults)
export {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
  isProductionMode,
} from "./constants.ts";
