import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  MAX_OAUTH_API_RESPONSE_BYTES,
  MAX_OAUTH_AUTHORIZATION_CODE_LENGTH,
  MAX_OAUTH_ERROR_DESCRIPTION_LENGTH,
  MAX_OAUTH_ERROR_LENGTH,
  MAX_OAUTH_REQUEST_TIMEOUT_MS,
  MAX_OAUTH_SCOPE_WIRE_LENGTH,
  MAX_OAUTH_SERVICE_ID_LENGTH,
  MAX_OAUTH_TOKEN_RESPONSE_BYTES,
  MAX_OAUTH_TOKEN_TYPE_LENGTH,
  MAX_OAUTH_TOKEN_VALUE_LENGTH,
} from "../limits.ts";
import { isOAuthRedirectUrl, isSecureOAuthEndpointUrl } from "../url-validation.ts";
import { isValidOAuthScopeSet } from "../scope-utils.ts";
import {
  getOAuthParameterRecordIssues,
  getOAuthStaticHeaderIssues,
  getOAuthTokenResponseMappingIssues,
  getReservedOAuthUrlParameterIssues,
  isValidOAuthDisplayName,
  isValidOAuthEnvironmentVariableName,
  isValidOAuthProviderId,
  type OAuthConfigIssue,
  RESERVED_API_HEADERS,
  RESERVED_AUTHORIZATION_PARAMETERS,
  RESERVED_TOKEN_PARAMETERS,
  RESERVED_TOKEN_REQUEST_HEADERS,
} from "../config-validation.ts";

function isTrimmedNonBlank(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

const HTTPS_URL_MESSAGE = "Must be an absolute HTTPS URL without credentials or a fragment";
const REDIRECT_URL_MESSAGE = "Must use HTTPS or HTTP on an explicit loopback host";

function addConfigIssues(
  issues: OAuthConfigIssue[],
  field: string,
  addIssue: (issue: { message: string; path: (string | number)[] }) => void,
): void {
  for (const issue of issues) {
    addIssue({
      message: issue.message,
      path: issue.key === undefined ? [field] : [field, issue.key],
    });
  }
}

export const getOAuthProviderConfigSchema = defineSchema((v) =>
  v.object({
    providerId: v.string().refine(isValidOAuthProviderId, "Invalid OAuth provider id"),
    displayName: v.string().refine(isValidOAuthDisplayName, "Invalid OAuth display name"),
    authorizationUrl: v.string().url().refine(isSecureOAuthEndpointUrl, HTTPS_URL_MESSAGE),
    tokenUrl: v.string().url().refine(isSecureOAuthEndpointUrl, HTTPS_URL_MESSAGE),
    userInfoUrl: v.string().url().refine(isSecureOAuthEndpointUrl, HTTPS_URL_MESSAGE).optional(),
    revocationUrl: v.string().url().refine(isSecureOAuthEndpointUrl, HTTPS_URL_MESSAGE).optional(),
    clientIdEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    clientSecretEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    additionalAuthParams: v.record(v.string(), v.string()).optional(),
    additionalTokenParams: v.record(v.string(), v.string()).optional(),
    useBasicAuth: v.boolean().optional(),
    pkceMode: v.enum(["required", "supported", "unsupported"]).optional(),
    runtimeSupport: v.enum(["generic", "provider-adapter-required"]).optional(),
    tokenRequestFormat: v.enum(["form", "json"]).optional(),
    tokenRequestHeaders: v.record(v.string(), v.string()).optional(),
    apiHeaders: v.record(v.string(), v.string()).optional(),
    scopeSeparator: v.enum([" ", ","]).optional(),
    requestTimeoutMs: v.number().int().positive().max(MAX_OAUTH_REQUEST_TIMEOUT_MS).optional(),
    maxTokenResponseBytes: v.number().int().positive().max(MAX_OAUTH_TOKEN_RESPONSE_BYTES)
      .optional(),
    maxApiResponseBytes: v.number().int().positive().max(MAX_OAUTH_API_RESPONSE_BYTES).optional(),
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
  }).superRefine((config, context) => {
    const addIssue = context.addIssue.bind(context);
    addConfigIssues(
      getOAuthParameterRecordIssues(
        config.additionalAuthParams,
        RESERVED_AUTHORIZATION_PARAMETERS,
      ),
      "additionalAuthParams",
      addIssue,
    );
    addConfigIssues(
      getOAuthParameterRecordIssues(config.additionalTokenParams, RESERVED_TOKEN_PARAMETERS),
      "additionalTokenParams",
      addIssue,
    );
    addConfigIssues(
      getOAuthStaticHeaderIssues(
        config.tokenRequestHeaders,
        RESERVED_TOKEN_REQUEST_HEADERS,
      ),
      "tokenRequestHeaders",
      addIssue,
    );
    addConfigIssues(
      getOAuthStaticHeaderIssues(config.apiHeaders, RESERVED_API_HEADERS),
      "apiHeaders",
      addIssue,
    );
    addConfigIssues(
      getReservedOAuthUrlParameterIssues(
        config.authorizationUrl,
        RESERVED_AUTHORIZATION_PARAMETERS,
      ),
      "authorizationUrl",
      addIssue,
    );
    addConfigIssues(
      getReservedOAuthUrlParameterIssues(config.tokenUrl, RESERVED_TOKEN_PARAMETERS),
      "tokenUrl",
      addIssue,
    );
    addConfigIssues(
      getOAuthTokenResponseMappingIssues(config.tokenResponseMapping),
      "tokenResponseMapping",
      addIssue,
    );
  })
);

export const getOAuthServiceConfigSchema = defineSchema((v) =>
  getOAuthProviderConfigSchema().extend({
    serviceId: v.string().min(1).max(MAX_OAUTH_SERVICE_ID_LENGTH).regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    ),
    defaultScopes: v.array(v.string()).refine(
      (scopes) => isValidOAuthScopeSet(scopes),
      "Must contain valid bounded OAuth scope tokens",
    ),
    apiBaseUrl: v.string().url().refine(isSecureOAuthEndpointUrl, HTTPS_URL_MESSAGE),
  }).superRefine((config, context) => {
    const separator = config.scopeSeparator === "," ? "," : " ";
    if (!isValidOAuthScopeSet(config.defaultScopes, separator)) {
      context.addIssue({
        message: "Scopes must be valid for the configured separator",
        path: ["defaultScopes"],
      });
    }
  })
);

export const getOAuthTokensSchema = defineSchema((v) =>
  v.object({
    accessToken: v.string().min(1).max(MAX_OAUTH_TOKEN_VALUE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ),
    refreshToken: v.string().max(MAX_OAUTH_TOKEN_VALUE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
    expiresAt: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    tokenType: v.string().max(MAX_OAUTH_TOKEN_TYPE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
    scope: v.string().max(MAX_OAUTH_SCOPE_WIRE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
    idToken: v.string().max(MAX_OAUTH_TOKEN_VALUE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
  })
);

/** State for CSRF protection and PKCE */
export const getOAuthStateSchema = defineSchema((v) =>
  v.object({
    state: v.string().min(1).max(1_024),
    codeVerifier: v.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
    redirectUri: v.string().url().refine(isOAuthRedirectUrl, REDIRECT_URL_MESSAGE),
    scopes: v.array(v.string()).refine(
      (scopes) => isValidOAuthScopeSet(scopes),
      "Must contain valid bounded OAuth scope tokens",
    ),
    createdAt: v.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getTokenExchangeResultSchema = defineSchema((v) =>
  v.object({
    success: v.boolean(),
    tokens: getOAuthTokensSchema().optional(),
    error: v.string().min(1).max(MAX_OAUTH_ERROR_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
    errorDescription: v.string().min(1).max(MAX_OAUTH_ERROR_DESCRIPTION_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ).optional(),
  }).superRefine((result, context) => {
    if (result.success) {
      if (!result.tokens) {
        context.addIssue({
          message: "Successful token exchange requires tokens",
          path: ["tokens"],
        });
      }
      if (result.error !== undefined || result.errorDescription !== undefined) {
        context.addIssue({
          message: "Successful token exchange cannot contain an error",
          path: [result.error !== undefined ? "error" : "errorDescription"],
        });
      }
      return;
    }

    if (result.tokens !== undefined) {
      context.addIssue({
        message: "Failed token exchange cannot contain tokens",
        path: ["tokens"],
      });
    }
    if (result.error === undefined) {
      context.addIssue({ message: "Failed token exchange requires an error", path: ["error"] });
    }
  })
);

export const getAuthorizationUrlOptionsSchema = defineSchema((v) =>
  v.object({
    scopes: v.array(v.string()).refine(
      (scopes) => isValidOAuthScopeSet(scopes),
      "Must contain valid bounded OAuth scope tokens",
    ).optional(),
    state: v.string().min(1).max(1_024).optional(),
    usePkce: v.boolean().optional(),
    additionalParams: v.record(v.string(), v.string()).optional(),
    redirectUri: v.string().url().refine(isOAuthRedirectUrl, REDIRECT_URL_MESSAGE).optional(),
  }).superRefine((options, context) => {
    addConfigIssues(
      getOAuthParameterRecordIssues(
        options.additionalParams,
        RESERVED_AUTHORIZATION_PARAMETERS,
      ),
      "additionalParams",
      context.addIssue.bind(context),
    );
  })
);

export const getTokenExchangeOptionsSchema = defineSchema((v) =>
  v.object({
    code: v.string().min(1).max(MAX_OAUTH_AUTHORIZATION_CODE_LENGTH).refine(
      isTrimmedNonBlank,
      "Must be trimmed and nonblank",
    ),
    redirectUri: v.string().url().refine(isOAuthRedirectUrl, REDIRECT_URL_MESSAGE),
    codeVerifier: v.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
  })
);

// Inferred types
/** Configuration used by oauth provider. */
export type OAuthProviderConfig = InferSchema<ReturnType<typeof getOAuthProviderConfigSchema>>;
/** Configuration used by oauth service. */
export type OAuthServiceConfig = InferSchema<ReturnType<typeof getOAuthServiceConfigSchema>>;
/** Public API contract for oauth tokens. */
export type OAuthTokens = InferSchema<ReturnType<typeof getOAuthTokensSchema>>;
/** State for oauth. */
export type OAuthState = InferSchema<ReturnType<typeof getOAuthStateSchema>>;
/** Result returned from token exchange. */
export type TokenExchangeResult = InferSchema<ReturnType<typeof getTokenExchangeResultSchema>>;
/** Options accepted by authorization URL. */
export type AuthorizationUrlOptions = InferSchema<
  ReturnType<typeof getAuthorizationUrlOptionsSchema>
>;
/** Options accepted by token exchange. */
export type TokenExchangeOptions = InferSchema<ReturnType<typeof getTokenExchangeOptionsSchema>>;

// Backward compat aliases
export const OAuthProviderConfigSchema = lazySchema(getOAuthProviderConfigSchema);
export const OAuthServiceConfigSchema = lazySchema(getOAuthServiceConfigSchema);
export const OAuthTokensSchema = lazySchema(getOAuthTokensSchema);
export const OAuthStateSchema = lazySchema(getOAuthStateSchema);
export const TokenExchangeResultSchema = lazySchema(getTokenExchangeResultSchema);
export const AuthorizationUrlOptionsSchema = lazySchema(getAuthorizationUrlOptionsSchema);
export const TokenExchangeOptionsSchema = lazySchema(getTokenExchangeOptionsSchema);
