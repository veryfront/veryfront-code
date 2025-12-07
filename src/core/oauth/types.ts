/**
 * OAuth Types and Interfaces
 *
 * Common types used across OAuth providers and handlers.
 */

/**
 * OAuth 2.0 provider configuration
 */
export interface OAuthProviderConfig {
  /** Unique identifier for the provider (e.g., "google", "microsoft") */
  providerId: string;

  /** Human-readable name */
  displayName: string;

  /** Authorization endpoint URL */
  authorizationUrl: string;

  /** Token endpoint URL */
  tokenUrl: string;

  /** User info endpoint URL (optional) */
  userInfoUrl?: string;

  /** Revocation endpoint URL (optional) */
  revocationUrl?: string;

  /** Environment variable name for client ID */
  clientIdEnvVar: string;

  /** Environment variable name for client secret */
  clientSecretEnvVar: string;

  /** Additional params to include in authorization URL */
  additionalAuthParams?: Record<string, string>;

  /** Additional params to include in token request */
  additionalTokenParams?: Record<string, string>;

  /** Whether to use basic auth for token requests (default: false, uses body params) */
  useBasicAuth?: boolean;

  /** Token response field mapping (if non-standard) */
  tokenResponseMapping?: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: string;
    tokenType?: string;
    scope?: string;
  };
}

/**
 * Service-specific OAuth configuration (extends provider)
 */
export interface OAuthServiceConfig extends OAuthProviderConfig {
  /** Service identifier (e.g., "gmail", "jira") */
  serviceId: string;

  /** Default scopes for this service */
  defaultScopes: string[];

  /** API base URL for the service */
  apiBaseUrl: string;
}

/**
 * OAuth tokens stored after authentication
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  idToken?: string;
}

/**
 * OAuth state for CSRF protection
 */
export interface OAuthState {
  state: string;
  codeVerifier?: string; // For PKCE
  redirectUri: string;
  scopes: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Result of OAuth token exchange
 */
export interface TokenExchangeResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
  errorDescription?: string;
}

/**
 * Options for creating OAuth authorization URL
 */
export interface AuthorizationUrlOptions {
  /** Scopes to request (uses defaultScopes if not provided) */
  scopes?: string[];

  /** Custom state value (generated if not provided) */
  state?: string;

  /** Use PKCE (default: true for public clients) */
  usePkce?: boolean;

  /** Additional query parameters */
  additionalParams?: Record<string, string>;

  /** Custom redirect URI (uses configured default if not provided) */
  redirectUri?: string;
}

/**
 * Options for exchanging authorization code for tokens
 */
export interface TokenExchangeOptions {
  /** Authorization code from callback */
  code: string;

  /** Redirect URI used in authorization request */
  redirectUri: string;

  /** Code verifier for PKCE */
  codeVerifier?: string;
}

/**
 * Token store interface
 */
export interface TokenStore {
  /** Get tokens for a service */
  getTokens(serviceId: string): Promise<OAuthTokens | null>;

  /** Set tokens for a service */
  setTokens(serviceId: string, tokens: OAuthTokens): Promise<void>;

  /** Clear tokens for a service */
  clearTokens(serviceId: string): Promise<void>;

  /** Get OAuth state by state string */
  getState(state: string): Promise<OAuthState | null>;

  /** Set OAuth state */
  setState(state: OAuthState): Promise<void>;

  /** Clear OAuth state */
  clearState(state: string): Promise<void>;
}
