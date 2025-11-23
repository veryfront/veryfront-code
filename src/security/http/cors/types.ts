/**
 * CORS Types
 * Unified type definitions for CORS handling across the application
 *
 * @module core/cors/types
 */

/**
 * CORS origin validation function
 * @param origin - The origin from the request header
 * @returns True if the origin is allowed, false otherwise
 */
export type OriginValidator = (origin: string) => boolean | string | Promise<boolean | string>;

/**
 * CORS Configuration Interface
 * Comprehensive configuration for CORS handling
 */
export interface CORSConfig {
  /**
   * Allowed origins for CORS requests
   * - string: Single origin or '*' for wildcard (not recommended with credentials)
   * - string[]: Array of allowed origins
   * - function: Custom validation function for dynamic origin checking
   *
   * @default undefined (no CORS headers - secure by default)
   */
  origin?: string | string[] | OriginValidator;

  /**
   * Whether to allow credentials (cookies, authorization headers)
   * Note: Cannot be used with wildcard origin (*) for security
   * @default false
   */
  credentials?: boolean;

  /**
   * Allowed HTTP methods for CORS requests
   * @default ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  methods?: string[];

  /**
   * Allowed request headers
   * If not specified, reflects Access-Control-Request-Headers from preflight
   * @default ['Content-Type', 'Authorization']
   */
  allowedHeaders?: string[];

  /**
   * Headers exposed to the client in the response
   * @default []
   */
  exposedHeaders?: string[];

  /**
   * Max age for preflight cache in seconds
   * How long the browser can cache preflight response
   * @default 86400 (24 hours)
   */
  maxAge?: number;
}

/**
 * CORS validation result
 * Internal type for origin validation results
 */
export interface CORSValidationResult {
  /** The allowed origin to return in headers */
  allowedOrigin: string | null;
  /** Whether credentials should be allowed */
  allowCredentials: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * CORS preflight options
 * Options for handling preflight requests
 */
export interface CORSPreflightOptions {
  /** The incoming request */
  request: Request;
  /** CORS configuration */
  config?: boolean | CORSConfig;
  /** Custom allowed methods (auto-detected if not provided) */
  allowMethods?: string;
  /** Custom allowed headers (auto-detected if not provided) */
  allowHeaders?: string;
}

/**
 * CORS header application options
 */
export interface CORSHeaderOptions {
  /** The incoming request */
  request: Request;
  /** Existing response to add headers to */
  response?: Response;
  /** Headers object to modify */
  headers?: Headers;
  /** CORS configuration */
  config?: boolean | CORSConfig;
}
