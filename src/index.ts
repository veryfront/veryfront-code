/**
 * Veryfront - Main Package
 *
 * This is the core API for building Veryfront applications.
 *
 * ## Subpath Exports (Advanced Use)
 * - `veryfront/server`     → Server APIs (startUniversalServer, createDevServer)
 * - `veryfront/middleware` → Middleware system
 * - `veryfront/components` → All React components (including OptimizedImage)
 * - `veryfront/data`       → Data fetching utilities
 * - `veryfront/config`     → Configuration utilities
 */

// ============================================================================
// React Components (Most Common)
// ============================================================================

export { Link } from "@veryfront/components";
export type { LinkProps } from "@veryfront/components";

export { Head } from "@veryfront/components";

export { MDXProvider, useMDXComponents } from "@veryfront/components";
export type { MDXProviderProps } from "@veryfront/components";

// Optimized Images
export {
  OptimizedBackgroundImage,
  OptimizedImage,
  SimpleOptimizedImage,
} from "@veryfront/components";
export type { OptimizedImageProps } from "@veryfront/components";

// ============================================================================
// Data Fetching
// ============================================================================

export type {
  DataContext,
  InferGetServerDataProps,
  PageWithData,
  StaticPathsResult,
} from "@veryfront/data";

// Data helpers (notFound/redirect for getServerData)
export { notFound, redirect } from "@veryfront/data";

// ============================================================================
// API Routes
// ============================================================================

export type { APIContext, APIHandler, APIResponse, APIRoute } from "@veryfront/routing";

// Response helpers
export {
  badRequest,
  forbidden,
  json,
  notFound as apiNotFound,
  redirect as apiRedirect,
  serverError,
  unauthorized,
} from "@veryfront/routing";

// Input validation (for API routes)
export {
  CommonSchemas,
  createValidatedHandler,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  sanitizeData,
  type ValidatedHandlerConfig,
  type ValidatedHandlerFunction,
  ValidationError,
} from "@veryfront/security";

// ============================================================================
// Configuration
// ============================================================================

export { defineConfig } from "@veryfront/config";
export type { VeryfrontConfig } from "@veryfront/config";

// ============================================================================
// Common Types
// ============================================================================

export type { ComponentProps, MDXFrontmatter, PageContext } from "@veryfront/types";
