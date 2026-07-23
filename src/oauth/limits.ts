/** Maximum OAuth authorization-code length accepted at the HTTP boundary. */
export const MAX_OAUTH_AUTHORIZATION_CODE_LENGTH = 4_096;

/**
 * Cross-runtime upper bound for outbound OAuth request timeouts.
 *
 * Ten minutes is intentionally far above the normal 30-second default while
 * remaining operationally bounded and portable across Deno and Node.
 */
export const MAX_OAUTH_REQUEST_TIMEOUT_MS = 10 * 60_000;

/** Maximum token-endpoint response body accepted by a provider config. */
export const MAX_OAUTH_TOKEN_RESPONSE_BYTES = 1_048_576;

/** Maximum provider API response body accepted by a service config. */
export const MAX_OAUTH_API_RESPONSE_BYTES = 10 * 1_048_576;

/** Maximum opaque token-store revision length accepted across the boundary. */
export const MAX_OAUTH_TOKEN_REVISION_LENGTH = 256;

/** Bounds each configured OAuth scope token and the complete scope set. */
export const MAX_OAUTH_SCOPE_TOKEN_LENGTH = 256;
export const MAX_OAUTH_SCOPE_COUNT = 100;
export const MAX_OAUTH_SCOPE_WIRE_LENGTH = 4_096;

/** Bounds public identifiers used in persistent-store keys. */
export const MAX_OAUTH_PROVIDER_ID_LENGTH = 128;
export const MAX_OAUTH_SERVICE_ID_LENGTH = 128;
export const MAX_OAUTH_USER_ID_LENGTH = 1_024;
export const MAX_OAUTH_PROJECT_ID_LENGTH = 256;

/** Bounds configuration-controlled names and wire values. */
export const MAX_OAUTH_DISPLAY_NAME_LENGTH = 256;
export const MAX_OAUTH_ENV_VAR_NAME_LENGTH = 128;
export const MAX_OAUTH_CREDENTIAL_LENGTH = 16_384;
export const MAX_OAUTH_CONFIG_PARAMETER_COUNT = 100;
export const MAX_OAUTH_CONFIG_PARAMETER_NAME_LENGTH = 128;
export const MAX_OAUTH_CONFIG_PARAMETER_VALUE_LENGTH = 4_096;
export const MAX_OAUTH_STATIC_HEADER_COUNT = 64;
export const MAX_OAUTH_STATIC_HEADER_NAME_LENGTH = 128;
export const MAX_OAUTH_STATIC_HEADER_VALUE_LENGTH = 8_192;
export const MAX_OAUTH_TOKEN_MAPPING_FIELD_LENGTH = 128;
export const MAX_OAUTH_URL_LENGTH = 8_192;
export const MAX_OAUTH_TOKEN_VALUE_LENGTH = 65_536;
export const MAX_OAUTH_TOKEN_TYPE_LENGTH = 256;

/** Bounds machine-readable exchange errors and optional operator-safe detail. */
export const MAX_OAUTH_ERROR_LENGTH = 128;
export const MAX_OAUTH_ERROR_DESCRIPTION_LENGTH = 4_096;
