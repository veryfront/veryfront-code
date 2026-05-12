import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getOAuthProviderConfigSchema = defineSchema((v) =>
  v.object({
    providerId: v.string(),
    displayName: v.string(),
    authorizationUrl: v.string().url(),
    tokenUrl: v.string().url(),
    userInfoUrl: v.string().url().optional(),
    revocationUrl: v.string().url().optional(),
    clientIdEnvVar: v.string(),
    clientSecretEnvVar: v.string(),
    additionalAuthParams: v.record(v.string(), v.string()).optional(),
    additionalTokenParams: v.record(v.string(), v.string()).optional(),
    useBasicAuth: v.boolean().optional(),
    tokenResponseMapping: v
      .object({
        accessToken: v.string().optional(),
        refreshToken: v.string().optional(),
        expiresIn: v.string().optional(),
        tokenType: v.string().optional(),
        scope: v.string().optional(),
      })
      .partial()
      .optional(),
  })
);

export const getOAuthServiceConfigSchema = defineSchema((v) =>
  getOAuthProviderConfigSchema().extend({
    serviceId: v.string(),
    defaultScopes: v.array(v.string()),
    apiBaseUrl: v.string().url(),
  })
);

export const getOAuthTokensSchema = defineSchema((v) =>
  v.object({
    accessToken: v.string(),
    refreshToken: v.string().optional(),
    expiresAt: v.number().int().optional(),
    tokenType: v.string().optional(),
    scope: v.string().optional(),
    idToken: v.string().optional(),
  })
);

/** State for CSRF protection and PKCE */
export const getOAuthStateSchema = defineSchema((v) =>
  v.object({
    state: v.string(),
    codeVerifier: v.string().optional(),
    redirectUri: v.string().url(),
    scopes: v.array(v.string()),
    createdAt: v.number().int(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getTokenExchangeResultSchema = defineSchema((v) =>
  v.object({
    success: v.boolean(),
    tokens: getOAuthTokensSchema().optional(),
    error: v.string().optional(),
    errorDescription: v.string().optional(),
  })
);

export const getAuthorizationUrlOptionsSchema = defineSchema((v) =>
  v.object({
    scopes: v.array(v.string()).optional(),
    state: v.string().optional(),
    usePkce: v.boolean().optional(),
    additionalParams: v.record(v.string(), v.string()).optional(),
    redirectUri: v.string().optional(),
  })
);

export const getTokenExchangeOptionsSchema = defineSchema((v) =>
  v.object({
    code: v.string(),
    redirectUri: v.string().url(),
    codeVerifier: v.string().optional(),
  })
);

// Inferred types
export type OAuthProviderConfig = InferSchema<ReturnType<typeof getOAuthProviderConfigSchema>>;
export type OAuthServiceConfig = InferSchema<ReturnType<typeof getOAuthServiceConfigSchema>>;
export type OAuthTokens = InferSchema<ReturnType<typeof getOAuthTokensSchema>>;
export type OAuthState = InferSchema<ReturnType<typeof getOAuthStateSchema>>;
export type TokenExchangeResult = InferSchema<ReturnType<typeof getTokenExchangeResultSchema>>;
export type AuthorizationUrlOptions = InferSchema<
  ReturnType<typeof getAuthorizationUrlOptionsSchema>
>;
export type TokenExchangeOptions = InferSchema<ReturnType<typeof getTokenExchangeOptionsSchema>>;

// Backward compat aliases
export const OAuthProviderConfigSchema = getOAuthProviderConfigSchema();
export const OAuthServiceConfigSchema = getOAuthServiceConfigSchema();
export const OAuthTokensSchema = getOAuthTokensSchema();
export const OAuthStateSchema = getOAuthStateSchema();
export const TokenExchangeResultSchema = getTokenExchangeResultSchema();
export const AuthorizationUrlOptionsSchema = getAuthorizationUrlOptionsSchema();
export const TokenExchangeOptionsSchema = getTokenExchangeOptionsSchema();
