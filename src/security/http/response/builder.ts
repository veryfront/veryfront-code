/**
 * ResponseBuilder - Fluent API for constructing HTTP responses
 */

import type { ResponseBuilderConfig, SecurityConfig } from "./types.ts";
import * as fluentMethods from "./fluent-methods.ts";
import type { FluentMethodsContext } from "./fluent-methods.ts";
import * as responseMethods from "./response-methods.ts";
import type { ResponseMethodsContext } from "./response-methods.ts";
import * as staticHelpers from "./static-helpers.ts";
import { generateNonce } from "./security-handler.ts";

/** Fluent response builder combining fluent methods and response methods */
export class ResponseBuilder implements FluentMethodsContext, ResponseMethodsContext {
  public headers: Headers;
  public status: number;
  public securityConfig: SecurityConfig | null;
  public isDev: boolean;
  public nonce: string;
  public cspUserHeader: string | null;
  public adapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter | undefined;
  public isVeryfrontDomain: boolean;

  constructor(config?: ResponseBuilderConfig) {
    this.headers = new Headers();
    this.status = 200;
    this.securityConfig = config?.securityConfig ?? null;
    this.isDev = config?.isDev ?? false;
    this.nonce = config?.nonce ?? generateNonce();
    this.cspUserHeader = config?.cspUserHeader ?? null;
    this.adapter = config?.adapter;
    this.isVeryfrontDomain = config?.isVeryfrontDomain ?? false;
  }

  withCORS = fluentMethods.withCORS;
  withCORSAsync = fluentMethods.withCORSAsync;
  withSecurity = fluentMethods.withSecurity;
  withCache = fluentMethods.withCache;
  withETag = fluentMethods.withETag;
  withHeaders = fluentMethods.withHeaders;
  withStatus = fluentMethods.withStatus;
  withAllow = fluentMethods.withAllow;
  withClientHints = fluentMethods.withClientHints;

  json = responseMethods.json;
  text = responseMethods.text;
  html = responseMethods.html;
  javascript = responseMethods.javascript;
  withContentType = responseMethods.withContentType;
  build = responseMethods.build;
  notModified = responseMethods.notModified;

  static error = staticHelpers.error;
  static json = staticHelpers.json;
  static html = staticHelpers.html;
  static preflight = staticHelpers.preflight;
  static stream = staticHelpers.stream;
}

// Initialize the ResponseBuilder class reference in static-helpers
staticHelpers.setResponseBuilderClass(
  ResponseBuilder as unknown as Parameters<typeof staticHelpers.setResponseBuilderClass>[0],
);

/** Factory function for creating preconfigured builders */
export function createResponseBuilder(
  config?: ResponseBuilderConfig,
): ResponseBuilder {
  return new ResponseBuilder(config);
}
