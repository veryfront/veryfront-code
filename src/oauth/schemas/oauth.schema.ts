/**
 * OAuth schemas
 *
 * Schemas for OAuth provider configuration, tokens, and state management.
 */

import { z } from "zod";

/**
 * OAuth provider configuration
 */
export const OAuthProviderConfigSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userInfoUrl: z.string().url().optional(),
  revocationUrl: z.string().url().optional(),
  clientIdEnvVar: z.string(),
  clientSecretEnvVar: z.string(),
  additionalAuthParams: z.record(z.string()).optional(),
  additionalTokenParams: z.record(z.string()).optional(),
  useBasicAuth: z.boolean().optional(),
  tokenResponseMapping: z
    .object({
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      expiresIn: z.string().optional(),
      tokenType: z.string().optional(),
      scope: z.string().optional(),
    })
    .partial()
    .optional(),
});

/**
 * OAuth service configuration (extends provider config)
 */
export const OAuthServiceConfigSchema = OAuthProviderConfigSchema.extend({
  serviceId: z.string(),
  defaultScopes: z.array(z.string()),
  apiBaseUrl: z.string().url(),
});

/**
 * OAuth tokens
 */
export const OAuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().int().optional(),
  tokenType: z.string().optional(),
  scope: z.string().optional(),
  idToken: z.string().optional(),
});

/**
 * OAuth state (for CSRF protection and PKCE)
 */
export const OAuthStateSchema = z.object({
  state: z.string(),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()),
  createdAt: z.number().int(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Token exchange result
 */
export const TokenExchangeResultSchema = z.object({
  success: z.boolean(),
  tokens: OAuthTokensSchema.optional(),
  error: z.string().optional(),
  errorDescription: z.string().optional(),
});

/**
 * Authorization URL options
 */
export const AuthorizationUrlOptionsSchema = z.object({
  scopes: z.array(z.string()).optional(),
  state: z.string().optional(),
  usePkce: z.boolean().optional(),
  additionalParams: z.record(z.string()).optional(),
  redirectUri: z.string().optional(),
});

/**
 * Token exchange options
 */
export const TokenExchangeOptionsSchema = z.object({
  code: z.string(),
  redirectUri: z.string().url(),
  codeVerifier: z.string().optional(),
});

// Inferred types
export type OAuthProviderConfig = z.infer<typeof OAuthProviderConfigSchema>;
export type OAuthServiceConfig = z.infer<typeof OAuthServiceConfigSchema>;
export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
export type OAuthState = z.infer<typeof OAuthStateSchema>;
export type TokenExchangeResult = z.infer<typeof TokenExchangeResultSchema>;
export type AuthorizationUrlOptions = z.infer<typeof AuthorizationUrlOptionsSchema>;
export type TokenExchangeOptions = z.infer<typeof TokenExchangeOptionsSchema>;
