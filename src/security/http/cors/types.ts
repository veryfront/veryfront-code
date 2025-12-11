
export type OriginValidator = (origin: string) => boolean | string | Promise<boolean | string>;

export interface CORSConfig {
  origin?: string | string[] | OriginValidator;

  credentials?: boolean;

  methods?: string[];

  allowedHeaders?: string[];

  exposedHeaders?: string[];

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
