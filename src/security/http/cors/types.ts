/** Resolve whether an incoming origin is allowed, optionally returning a replacement origin. */
export type OriginValidator = (origin: string) => boolean | string | Promise<boolean | string>;

/** Cross-origin resource sharing policy. */
export interface CORSConfig {
  /** Allowed origin, origin list, or dynamic validator. */
  origin?: string | string[] | OriginValidator;
  /** Allow browsers to expose credentials to cross-origin requests. */
  credentials?: boolean;
  /** HTTP methods accepted by preflight requests. */
  methods?: string[];
  /** Request headers accepted by preflight requests. */
  allowedHeaders?: string[];
  /** Response headers exposed to browser code. */
  exposedHeaders?: string[];
  /** Browser preflight cache duration in seconds. */
  maxAge?: number;
}

export interface CORSValidationResult {
  allowedOrigin: string | null;
  allowCredentials: boolean;
  error?: string;
}

export interface CORSPreflightOptions {
  request: Request;
  config?: boolean | CORSConfig;
  allowMethods?: string;
  allowHeaders?: string;
}

export interface CORSHeaderOptions {
  request: Request;
  response?: Response;
  headers?: Headers;
  config?: boolean | CORSConfig;
}
