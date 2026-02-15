export interface CORSConfig {
  origin?: string | string[] | ((origin: string) => boolean | string);
  credentials?: boolean;
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  methods?: string[];
  maxAge?: number;
}

export type CSPDirectives = Partial<Record<string, string | string[]>>;

export interface BasicAuthConfig {
  username: string;
  password: string;
  realm?: string;
}

export interface BearerAuthConfig {
  token: string;
}

export interface AuthConfig {
  basic?: BasicAuthConfig;
  bearer?: BearerAuthConfig;
}

export type { CsrfConfig } from "../../csrf/helpers.ts";

export type { SecurityConfig } from "#veryfront/types";
