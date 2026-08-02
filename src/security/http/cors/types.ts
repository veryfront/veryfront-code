export type SyncOriginValidator = (origin: string) => boolean | string;
export type OriginValidator = (
  origin: string,
) => boolean | string | Promise<boolean | string>;

/** CORS policy accepted by asynchronous middleware and preflight APIs. */
export interface CORSConfig {
  origin?: string | string[] | OriginValidator;
  credentials?: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
}

/** CORS policy accepted by synchronous response-building APIs. */
export interface SyncCORSConfig extends Omit<CORSConfig, "origin"> {
  origin?: string | string[] | SyncOriginValidator;
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

/** Header options accepted by synchronous CORS response helpers. */
export interface SyncCORSHeaderOptions {
  request: Request;
  response?: Response;
  headers?: Headers;
  config?: boolean | SyncCORSConfig;
}
