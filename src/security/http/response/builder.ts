/**
 * ResponseBuilder - Main builder class
 * Fluent API for constructing HTTP responses with common patterns
 */

import type { ResponseBuilderConfig, SecurityConfig } from "./types.ts";

// Import fluent methods
import * as fluentMethods from "./fluent-methods.ts";
import type { FluentMethodsContext } from "./fluent-methods.ts";

// Import response methods
import * as responseMethods from "./response-methods.ts";
import type { ResponseMethodsContext } from "./response-methods.ts";

// Import static helpers and set class reference
import * as staticHelpers from "./static-helpers.ts";
import { generateNonce } from "./security-handler.ts";
import { serverLogger as logger } from "@veryfront/utils";

/**
 * ResponseBuilder class for fluent response construction
 * Combines fluent methods and response methods into a cohesive builder API
 */
export class ResponseBuilder implements FluentMethodsContext, ResponseMethodsContext {
  public headers: Headers;
  public status: number;
  public securityConfig: SecurityConfig | null;
  public isDev: boolean;
  public nonce: string;
  public cspUserHeader: string | null;
  public adapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter | undefined;

  constructor(config?: ResponseBuilderConfig) {
    this.headers = new Headers();
    this.status = 200;
    this.securityConfig = config?.securityConfig ?? null;
    this.isDev = config?.isDev ?? false;
    // Accept nonce from config or generate new one
    // This allows handlers to pass a pre-generated nonce for consistency
    this.nonce = config?.nonce ?? generateNonce();
    logger.debug("[NONCE-TRACE] ResponseBuilder nonce", {
      nonce: this.nonce,
      provided: !!config?.nonce,
    });
    this.cspUserHeader = config?.cspUserHeader ?? null;
    this.adapter = config?.adapter;
  }

  // Fluent methods - bind imported functions to this instance
  withCORS = fluentMethods.withCORS;
  withCORSAsync = fluentMethods.withCORSAsync;
  withSecurity = fluentMethods.withSecurity;
  withCache = fluentMethods.withCache;
  withETag = fluentMethods.withETag;
  withHeaders = fluentMethods.withHeaders;
  withStatus = fluentMethods.withStatus;
  withAllow = fluentMethods.withAllow;

  // Response methods - bind imported functions to this instance
  json = responseMethods.json;
  text = responseMethods.text;
  html = responseMethods.html;
  javascript = responseMethods.javascript;
  withContentType = responseMethods.withContentType;
  build = responseMethods.build;
  notModified = responseMethods.notModified;

  // Static helper methods - delegate to static-helpers module
  static error = staticHelpers.error;
  static json = staticHelpers.json;
  static html = staticHelpers.html;
  static preflight = staticHelpers.preflight;
  static stream = staticHelpers.stream;
}

// Initialize the ResponseBuilder class reference in static-helpers
// Using type assertion to handle structural compatibility
staticHelpers.setResponseBuilderClass(ResponseBuilder as any);

/**
 * Factory function for creating preconfigured builders
 */
export function createResponseBuilder(
  config?: ResponseBuilderConfig,
): ResponseBuilder {
  return new ResponseBuilder(config);
}
