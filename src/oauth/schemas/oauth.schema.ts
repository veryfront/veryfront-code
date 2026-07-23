import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  isJsonCompatible,
  isOAuthScopeToken,
  isSecureHttpUrl,
  OAUTH_MAX_TOKEN_LENGTH,
  OAUTH_MAX_TOKEN_METADATA_LENGTH,
} from "../validation.ts";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 512;
const MAX_URL_LENGTH = 4_096;
const MAX_ENV_NAME_LENGTH = 128;
const MAX_PARAMETER_ENTRIES = 128;
const MAX_PARAMETER_KEY_LENGTH = 256;
const MAX_PARAMETER_VALUE_LENGTH = 4_096;
const MAX_SCOPE_ENTRIES = 256;
const MAX_SCOPE_LENGTH = 1_024;
const MAX_STATE_LENGTH = 4_096;
const MAX_USER_ID_LENGTH = 4_096;
const MAX_STATE_METADATA_BYTES = 65_536;
const MAX_AUTHORIZATION_CODE_LENGTH = 16_384;
const MAX_ERROR_LENGTH = 2_048;

function hasBoundedEntries(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).length <= MAX_PARAMETER_ENTRIES;
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasBoundedJsonSize(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined &&
      new TextEncoder().encode(serialized).byteLength <= MAX_STATE_METADATA_BYTES;
  } catch {
    return false;
  }
}

export const getOAuthProviderConfigSchema = defineSchema((v) =>
  v.object({
    providerId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    displayName: v.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    authorizationUrl: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS authorization URL or an HTTP loopback URL",
    ),
    tokenUrl: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS token URL or an HTTP loopback URL",
    ),
    userInfoUrl: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS user info URL or an HTTP loopback URL",
    ).optional(),
    revocationUrl: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS revocation URL or an HTTP loopback URL",
    ).optional(),
    clientIdEnvVar: v.string().min(1).max(MAX_ENV_NAME_LENGTH).regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Expected an environment variable name",
    ),
    clientSecretEnvVar: v.string().min(1).max(MAX_ENV_NAME_LENGTH).regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Expected an environment variable name",
    ),
    additionalAuthParams: v.record(
      v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH),
      v.string().max(MAX_PARAMETER_VALUE_LENGTH),
    ).refine(hasBoundedEntries, "Too many OAuth authorization parameters").optional(),
    additionalTokenParams: v.record(
      v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH),
      v.string().max(MAX_PARAMETER_VALUE_LENGTH),
    ).refine(hasBoundedEntries, "Too many OAuth token parameters").optional(),
    useBasicAuth: v.boolean().optional(),
    tokenRequestFormat: v.enum(["form", "json"] as const).optional(),
    tokenResponseMapping: v
      .object({
        accessToken: v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH).optional(),
        refreshToken: v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH).optional(),
        expiresIn: v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH).optional(),
        tokenType: v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH).optional(),
        scope: v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH).optional(),
      })
      .partial()
      .strict()
      .optional(),
  }).strict()
);

export const getOAuthServiceConfigSchema = defineSchema((v) =>
  getOAuthProviderConfigSchema().extend({
    serviceId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    defaultScopes: v.array(
      v.string().min(1).max(MAX_SCOPE_LENGTH).refine(
        isOAuthScopeToken,
        "Expected an OAuth scope token",
      ),
    ).max(MAX_SCOPE_ENTRIES)
      .refine(hasUniqueStrings, "OAuth scopes must be unique"),
    apiBaseUrl: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS API base URL or an HTTP loopback URL",
    ),
  }).strict()
);

export const getOAuthTokensSchema = defineSchema((v) =>
  v.object({
    accessToken: v.string().min(1).max(OAUTH_MAX_TOKEN_LENGTH),
    refreshToken: v.string().min(1).max(OAUTH_MAX_TOKEN_LENGTH).optional(),
    expiresAt: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    tokenType: v.string().min(1).max(OAUTH_MAX_TOKEN_METADATA_LENGTH).optional(),
    scope: v.string().max(OAUTH_MAX_TOKEN_METADATA_LENGTH).optional(),
    idToken: v.string().min(1).max(OAUTH_MAX_TOKEN_LENGTH).optional(),
  }).strict()
);

/** State for CSRF protection and PKCE */
export const getOAuthStateSchema = defineSchema((v) =>
  v.object({
    state: v.string().min(1).max(MAX_STATE_LENGTH),
    codeVerifier: v.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/).optional(),
    redirectUri: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS redirect URI or an HTTP loopback URI",
    ),
    scopes: v.array(
      v.string().min(1).max(MAX_SCOPE_LENGTH).refine(
        isOAuthScopeToken,
        "Expected an OAuth scope token",
      ),
    ).max(MAX_SCOPE_ENTRIES)
      .refine(hasUniqueStrings, "OAuth scopes must be unique"),
    createdAt: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    metadata: v.record(
      v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH),
      v.unknown(),
    ).refine(hasBoundedEntries, "Too many OAuth state metadata entries")
      .refine(isJsonCompatible, "OAuth state metadata must be JSON-compatible")
      .refine(hasBoundedJsonSize, "OAuth state metadata exceeds the size limit")
      .optional(),
  }).strict()
);

export const getStoredOAuthStateSchema = defineSchema((v) =>
  v.object({
    userId: v.string().min(1).max(MAX_USER_ID_LENGTH),
    serviceId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    codeVerifier: v.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/).optional(),
    redirectUri: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS redirect URI or an HTTP loopback URI",
    ).optional(),
    scopes: v.array(
      v.string().min(1).max(MAX_SCOPE_LENGTH).refine(
        isOAuthScopeToken,
        "Expected an OAuth scope token",
      ),
    ).max(MAX_SCOPE_ENTRIES).refine(hasUniqueStrings, "OAuth scopes must be unique").optional(),
    createdAt: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    metadata: v.record(
      v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH),
      v.unknown(),
    ).refine(hasBoundedEntries, "Too many OAuth state metadata entries")
      .refine(isJsonCompatible, "OAuth state metadata must be JSON-compatible")
      .refine(hasBoundedJsonSize, "OAuth state metadata exceeds the size limit")
      .optional(),
  }).strict()
);

export const getTokenExchangeResultSchema = defineSchema((v) =>
  v.object({
    success: v.boolean(),
    tokens: getOAuthTokensSchema().optional(),
    error: v.string().min(1).max(128).regex(/^[A-Za-z0-9._~-]+$/).optional(),
    errorDescription: v.string().max(MAX_ERROR_LENGTH).optional(),
  }).strict().superRefine((result, context) => {
    if (result.success && !result.tokens) {
      context.addIssue({
        code: "custom",
        message: "Successful OAuth token exchange requires tokens",
        path: ["tokens"],
      });
    }
    if (result.success && result.error) {
      context.addIssue({
        code: "custom",
        message: "Successful OAuth token exchange must not include an error code",
        path: ["error"],
      });
    }
    if (!result.success && !result.error) {
      context.addIssue({
        code: "custom",
        message: "Failed OAuth token exchange requires an error code",
        path: ["error"],
      });
    }
    if (!result.success && result.tokens) {
      context.addIssue({
        code: "custom",
        message: "Failed OAuth token exchange must not include tokens",
        path: ["tokens"],
      });
    }
  })
);

export const getAuthorizationUrlOptionsSchema = defineSchema((v) =>
  v.object({
    scopes: v.array(
      v.string().min(1).max(MAX_SCOPE_LENGTH).refine(
        isOAuthScopeToken,
        "Expected an OAuth scope token",
      ),
    ).max(MAX_SCOPE_ENTRIES)
      .refine(hasUniqueStrings, "OAuth scopes must be unique").optional(),
    state: v.string().min(1).max(MAX_STATE_LENGTH).optional(),
    usePkce: v.boolean().optional(),
    additionalParams: v.record(
      v.string().min(1).max(MAX_PARAMETER_KEY_LENGTH),
      v.string().max(MAX_PARAMETER_VALUE_LENGTH),
    ).refine(hasBoundedEntries, "Too many OAuth authorization parameters").optional(),
    redirectUri: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS redirect URI or an HTTP loopback URI",
    ).optional(),
  }).strict()
);

export const getTokenExchangeOptionsSchema = defineSchema((v) =>
  v.object({
    code: v.string().min(1).max(MAX_AUTHORIZATION_CODE_LENGTH),
    redirectUri: v.string().max(MAX_URL_LENGTH).url().refine(
      isSecureHttpUrl,
      "Expected an HTTPS redirect URI or an HTTP loopback URI",
    ),
    codeVerifier: v.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/).optional(),
  }).strict()
);

// Inferred types
/** OAuth provider configuration. */
export type OAuthProviderConfig = InferSchema<ReturnType<typeof getOAuthProviderConfigSchema>>;
/** OAuth service configuration. */
export type OAuthServiceConfig = InferSchema<ReturnType<typeof getOAuthServiceConfigSchema>>;
/** OAuth token persistence contract. */
export type OAuthTokens = InferSchema<ReturnType<typeof getOAuthTokensSchema>>;
/** One-time OAuth authorization state. */
export type OAuthState = InferSchema<ReturnType<typeof getOAuthStateSchema>>;
/** Result returned from token exchange. */
export type TokenExchangeResult = InferSchema<ReturnType<typeof getTokenExchangeResultSchema>>;
/** Options accepted by authorization URL. */
export type AuthorizationUrlOptions = InferSchema<
  ReturnType<typeof getAuthorizationUrlOptionsSchema>
>;
/** Options accepted by token exchange. */
export type TokenExchangeOptions = InferSchema<ReturnType<typeof getTokenExchangeOptionsSchema>>;

// Backward-compatible runtime schema aliases.
/** Validates OAuth provider configuration. */
export const OAuthProviderConfigSchema = lazySchema(getOAuthProviderConfigSchema);
/** Validates OAuth service configuration. */
export const OAuthServiceConfigSchema = lazySchema(getOAuthServiceConfigSchema);
/** Validates persisted OAuth tokens. */
export const OAuthTokensSchema = lazySchema(getOAuthTokensSchema);
/** Validates generated OAuth authorization state. */
export const OAuthStateSchema = lazySchema(getOAuthStateSchema);
/** Validates a persisted OAuth state row. */
export const StoredOAuthStateSchema = lazySchema(getStoredOAuthStateSchema);
/** Validates OAuth token-exchange results. */
export const TokenExchangeResultSchema = lazySchema(getTokenExchangeResultSchema);
/** Validates authorization URL options. */
export const AuthorizationUrlOptionsSchema = lazySchema(getAuthorizationUrlOptionsSchema);
/** Validates authorization-code exchange options. */
export const TokenExchangeOptionsSchema = lazySchema(getTokenExchangeOptionsSchema);
