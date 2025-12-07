/**
 * Base OAuth Provider
 *
 * Generic OAuth 2.0 implementation that can be extended for specific providers.
 */

import type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "../types.ts";
import { getEnv } from "../../../platform/compat/process.ts";

/**
 * Generate cryptographically secure random string
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier(): string {
  return generateRandomString(64);
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Base OAuth provider class
 */
export class OAuthProvider {
  protected config: OAuthProviderConfig;

  constructor(config: OAuthProviderConfig) {
    this.config = config;
  }

  /**
   * Get client ID from environment
   */
  getClientId(): string | null {
    return getEnv(this.config.clientIdEnvVar) || null;
  }

  /**
   * Get client secret from environment
   */
  getClientSecret(): string | null {
    return getEnv(this.config.clientSecretEnvVar) || null;
  }

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean {
    return !!(this.getClientId() && this.getClientSecret());
  }

  /**
   * Create authorization URL
   */
  async createAuthorizationUrl(
    options: AuthorizationUrlOptions & { defaultScopes?: string[] } = {},
  ): Promise<{ url: string; state: OAuthState }> {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error(`${this.config.clientIdEnvVar} not configured`);
    }

    const state = options.state || generateRandomString(32);
    const scopes = options.scopes || options.defaultScopes || [];
    const redirectUri = options.redirectUri || "";
    const usePkce = options.usePkce !== false;

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (usePkce) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = await generateCodeChallenge(codeVerifier);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      ...(scopes.length > 0 && { scope: scopes.join(" ") }),
      ...(codeChallenge && {
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }),
      ...this.config.additionalAuthParams,
      ...options.additionalParams,
    });

    const oauthState: OAuthState = {
      state,
      codeVerifier,
      redirectUri,
      scopes,
      createdAt: Date.now(),
    };

    return {
      url: `${this.config.authorizationUrl}?${params.toString()}`,
      state: oauthState,
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "OAuth not configured",
        errorDescription:
          `Missing ${this.config.clientIdEnvVar} or ${this.config.clientSecretEnvVar}`,
      };
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      ...(options.codeVerifier && { code_verifier: options.codeVerifier }),
      ...(!this.config.useBasicAuth && {
        client_id: clientId,
        client_secret: clientSecret,
      }),
      ...this.config.additionalTokenParams,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (this.config.useBasicAuth) {
      const credentials = btoa(`${clientId}:${clientSecret}`);
      headers.Authorization = `Basic ${credentials}`;
    }

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "token_exchange_failed",
          errorDescription: data.error_description || `Status ${response.status}`,
        };
      }

      const mapping = this.config.tokenResponseMapping || {};
      const tokens: OAuthTokens = {
        accessToken: data[mapping.accessToken || "access_token"],
        refreshToken: data[mapping.refreshToken || "refresh_token"],
        tokenType: data[mapping.tokenType || "token_type"],
        scope: data[mapping.scope || "scope"],
        idToken: data.id_token,
      };

      const expiresIn = data[mapping.expiresIn || "expires_in"];
      if (expiresIn) {
        tokens.expiresAt = Date.now() + expiresIn * 1000;
      }

      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Refresh access token
   */
  async refreshTokens(refreshToken: string): Promise<TokenExchangeResult> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "OAuth not configured",
      };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...(!this.config.useBasicAuth && {
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (this.config.useBasicAuth) {
      const credentials = btoa(`${clientId}:${clientSecret}`);
      headers.Authorization = `Basic ${credentials}`;
    }

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "refresh_failed",
          errorDescription: data.error_description,
        };
      }

      const mapping = this.config.tokenResponseMapping || {};
      const tokens: OAuthTokens = {
        accessToken: data[mapping.accessToken || "access_token"],
        refreshToken: data[mapping.refreshToken || "refresh_token"] || refreshToken,
        tokenType: data[mapping.tokenType || "token_type"],
        scope: data[mapping.scope || "scope"],
      };

      const expiresIn = data[mapping.expiresIn || "expires_in"];
      if (expiresIn) {
        tokens.expiresAt = Date.now() + expiresIn * 1000;
      }

      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Revoke tokens
   */
  async revokeToken(token: string): Promise<boolean> {
    if (!this.config.revocationUrl) {
      return false;
    }

    try {
      const response = await fetch(this.config.revocationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }).toString(),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Service-specific OAuth handler
 */
export class OAuthService extends OAuthProvider {
  protected serviceConfig: OAuthServiceConfig;
  protected tokenStore?: TokenStore;

  constructor(config: OAuthServiceConfig, tokenStore?: TokenStore) {
    super(config);
    this.serviceConfig = config;
    this.tokenStore = tokenStore;
  }

  /**
   * Get service ID
   */
  get serviceId(): string {
    return this.serviceConfig.serviceId;
  }

  /**
   * Get API base URL
   */
  get apiBaseUrl(): string {
    return this.serviceConfig.apiBaseUrl;
  }

  /**
   * Create authorization URL with service defaults
   */
  override createAuthorizationUrl(
    options: AuthorizationUrlOptions = {},
  ): Promise<{ url: string; state: OAuthState }> {
    return super.createAuthorizationUrl({
      ...options,
      defaultScopes: this.serviceConfig.defaultScopes,
    });
  }

  /**
   * Get valid access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokenStore) {
      return null;
    }

    const tokens = await this.tokenStore.getTokens(this.serviceId);
    if (!tokens) {
      return null;
    }

    // Check if token is expired (with 5 min buffer)
    if (tokens.expiresAt && Date.now() > tokens.expiresAt - 300000) {
      if (tokens.refreshToken) {
        const result = await this.refreshTokens(tokens.refreshToken);
        if (result.success && result.tokens) {
          await this.tokenStore.setTokens(this.serviceId, result.tokens);
          return result.tokens.accessToken;
        }
      }
      return null;
    }

    return tokens.accessToken;
  }

  /**
   * Make authenticated API request
   */
  async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(`Not authenticated with ${this.serviceConfig.displayName}`);
    }

    const url = endpoint.startsWith("http") ? endpoint : `${this.apiBaseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.serviceConfig.displayName} API error: ${response.status} ${error}`);
    }

    return response.json();
  }
}
