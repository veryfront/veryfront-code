/**
 * OAuth Types
 *
 * Shared type definitions for OAuth providers and token management.
 */

/**
 * OAuth provider configuration
 */
export interface OAuthProviderConfig {
  /** Unique provider identifier (e.g., "google", "microsoft", "github") */
  provider: string;

  /** OAuth authorization URL */
  authorizationUrl: string;

  /** OAuth token URL */
  tokenUrl: string;

  /** Required OAuth scopes */
  scopes: string[];

  /** Environment variable name for client ID */
  clientIdEnv: string;

  /** Environment variable name for client secret */
  clientSecretEnv: string;

  /** Additional parameters to add to authorization URL */
  additionalParams?: Record<string, string>;

  /** Token endpoint authentication method */
  tokenAuthMethod?: "post" | "basic";

  /** Whether refresh tokens should be requested */
  requestRefreshToken?: boolean;
}

/**
 * Service-specific OAuth configuration (extends provider config)
 */
export interface ServiceOAuthConfig extends OAuthProviderConfig {
  /** Service name (e.g., "gmail", "slack") */
  service: string;

  /** Callback path (e.g., "/api/auth/gmail/callback") */
  callbackPath: string;

  /** Service-specific scopes (appended to provider scopes) */
  serviceScopes?: string[];
}

/**
 * Token data stored by the token store
 */
export interface TokenData {
  /** OAuth access token */
  accessToken: string;

  /** OAuth refresh token (if available) */
  refreshToken?: string;

  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt?: number;

  /** Additional data from token response (e.g., instance_url for Salesforce) */
  metadata?: Record<string, unknown>;
}

/**
 * Token store interface for storing/retrieving OAuth tokens
 */
export interface TokenStore {
  /** Get tokens for a service */
  getTokens(service: string): Promise<TokenData | null>;

  /** Set tokens for a service */
  setTokens(service: string, tokens: TokenData): Promise<void>;

  /** Delete tokens for a service */
  deleteTokens(service: string): Promise<void>;

  /** Check if tokens exist for a service */
  hasTokens(service: string): Promise<boolean>;
}

/**
 * OAuth token response from token endpoint
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  // Additional fields vary by provider
  [key: string]: unknown;
}

/**
 * OAuth error response
 */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Options for creating OAuth handlers
 */
export interface OAuthHandlerOptions {
  /** Service configuration */
  config: ServiceOAuthConfig;

  /** Token store implementation */
  tokenStore?: TokenStore;

  /** Custom success redirect URL */
  successRedirect?: string;

  /** Custom error redirect URL */
  errorRedirect?: string;

  /** Callback function after successful authentication */
  onSuccess?: (tokens: TokenData, request: Request) => Promise<void>;

  /** Callback function on authentication error */
  onError?: (error: Error, request: Request) => Promise<void>;
}
