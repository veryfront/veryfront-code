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

/** OpenID Connect authentication configured through environment-backed credentials. */
export interface OidcAuthConfig {
  issuerEnvVar: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  sessionSecretEnvVar: string;
  scopes: readonly string[];
  claims?: {
    email?: string;
    name?: string;
    groups?: string;
    roles?: string;
  };
  signingAlgorithms?: ReadonlyArray<
    | "RS256"
    | "RS384"
    | "RS512"
    | "PS256"
    | "PS384"
    | "PS512"
    | "ES256"
    | "ES384"
    | "ES512"
  >;
  trustedEndpointOrigins?: readonly string[];
  sessionTtlSeconds?: number;
  discoveryCacheTtlSeconds?: number;
  cookieName?: string;
}

/** Identity headers accepted from explicitly trusted reverse-proxy peers. */
export interface TrustedProxyAuthConfig {
  trustedPeers: readonly string[];
  headers: {
    subject: string;
    email?: string;
    name?: string;
    groups?: string;
    roles?: string;
  };
}

/** Application authentication. Runtime validation requires exactly one configured mode. */
export interface AuthConfig {
  basic?: BasicAuthConfig;
  bearer?: BearerAuthConfig;
  oidc?: OidcAuthConfig;
  trustedProxy?: TrustedProxyAuthConfig;
}

export type { CsrfConfig } from "../../csrf/helpers.ts";

export type { SecurityConfig } from "#veryfront/types";
