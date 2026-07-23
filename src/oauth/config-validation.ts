import {
  MAX_OAUTH_CONFIG_PARAMETER_COUNT,
  MAX_OAUTH_CONFIG_PARAMETER_NAME_LENGTH,
  MAX_OAUTH_CONFIG_PARAMETER_VALUE_LENGTH,
  MAX_OAUTH_DISPLAY_NAME_LENGTH,
  MAX_OAUTH_ENV_VAR_NAME_LENGTH,
  MAX_OAUTH_PROVIDER_ID_LENGTH,
  MAX_OAUTH_STATIC_HEADER_COUNT,
  MAX_OAUTH_STATIC_HEADER_NAME_LENGTH,
  MAX_OAUTH_STATIC_HEADER_VALUE_LENGTH,
  MAX_OAUTH_TOKEN_MAPPING_FIELD_LENGTH,
} from "./limits.ts";

/** OAuth fields whose ownership must stay with the transport implementation. */
export const RESERVED_AUTHORIZATION_PARAMETERS: ReadonlySet<string> = new Set([
  "client_id",
  "redirect_uri",
  "response_type",
  "state",
  "scope",
  "code_challenge",
  "code_challenge_method",
]);

export const RESERVED_TOKEN_PARAMETERS: ReadonlySet<string> = new Set([
  "grant_type",
  "code",
  "redirect_uri",
  "code_verifier",
  "refresh_token",
  "client_id",
  "client_secret",
]);

export const RESERVED_TOKEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "authorization",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
]);

export const RESERVED_API_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
]);

export interface OAuthConfigIssue {
  key?: string;
  message: string;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidOAuthProviderId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_OAUTH_PROVIDER_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function isValidOAuthDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_OAUTH_DISPLAY_NAME_LENGTH &&
    value.length > 0 && value.trim() === value;
}

export function isValidOAuthEnvironmentVariableName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_OAUTH_ENV_VAR_NAME_LENGTH &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function getOAuthParameterRecordIssues(
  value: unknown,
  reserved: ReadonlySet<string>,
): OAuthConfigIssue[] {
  if (value === undefined) return [];
  if (!isRecordObject(value)) return [{ message: "Must be an OAuth parameter record" }];
  const entries = Object.entries(value);
  const issues: OAuthConfigIssue[] = [];
  if (entries.length > MAX_OAUTH_CONFIG_PARAMETER_COUNT) {
    issues.push({ message: `Must contain at most ${MAX_OAUTH_CONFIG_PARAMETER_COUNT} entries` });
  }
  for (const [key, parameterValue] of entries) {
    if (!key || key.length > MAX_OAUTH_CONFIG_PARAMETER_NAME_LENGTH) {
      issues.push({ key, message: "Invalid OAuth parameter name" });
    } else if (reserved.has(key.toLowerCase())) {
      issues.push({ key, message: `${key} is reserved by the OAuth transport` });
    }
    if (
      typeof parameterValue !== "string" ||
      parameterValue.length > MAX_OAUTH_CONFIG_PARAMETER_VALUE_LENGTH
    ) {
      issues.push({ key, message: "OAuth parameter value is too large" });
    }
  }
  return issues;
}

export function getOAuthStaticHeaderIssues(
  value: unknown,
  reserved: ReadonlySet<string>,
): OAuthConfigIssue[] {
  if (value === undefined) return [];
  if (!isRecordObject(value)) return [{ message: "Must be an HTTP header record" }];
  const entries = Object.entries(value);
  const issues: OAuthConfigIssue[] = [];
  const names = new Set<string>();
  if (entries.length > MAX_OAUTH_STATIC_HEADER_COUNT) {
    issues.push({ message: `Must contain at most ${MAX_OAUTH_STATIC_HEADER_COUNT} entries` });
  }
  for (const [name, headerValue] of entries) {
    const normalizedName = name.toLowerCase();
    if (!name || name.length > MAX_OAUTH_STATIC_HEADER_NAME_LENGTH) {
      issues.push({ key: name, message: "Invalid HTTP header name" });
      continue;
    }
    if (names.has(normalizedName)) {
      issues.push({ key: name, message: "Duplicate case-insensitive HTTP header name" });
      continue;
    }
    names.add(normalizedName);
    if (reserved.has(normalizedName)) {
      issues.push({ key: name, message: `${name} is reserved by the OAuth transport` });
      continue;
    }
    if (
      typeof headerValue !== "string" ||
      headerValue.length > MAX_OAUTH_STATIC_HEADER_VALUE_LENGTH
    ) {
      issues.push({ key: name, message: "HTTP header value is too large" });
      continue;
    }
    try {
      new Headers({ [name]: headerValue });
    } catch {
      issues.push({ key: name, message: "Invalid HTTP header" });
    }
  }
  return issues;
}

const TOKEN_MAPPING_FIELDS = [
  "accessToken",
  "refreshToken",
  "expiresIn",
  "tokenType",
  "scope",
] as const;

export function getOAuthTokenResponseMappingIssues(
  value: unknown,
): OAuthConfigIssue[] {
  if (value === undefined) return [];
  if (!isRecordObject(value)) return [{ message: "Must be a token response mapping record" }];
  const issues: OAuthConfigIssue[] = [];
  const responseFields = new Set<string>();
  for (const field of TOKEN_MAPPING_FIELDS) {
    const responseField = value[field];
    if (responseField === undefined) continue;
    if (
      typeof responseField !== "string" || !responseField ||
      responseField.trim() !== responseField ||
      responseField.length > MAX_OAUTH_TOKEN_MAPPING_FIELD_LENGTH
    ) {
      issues.push({ key: field, message: "Invalid token response field name" });
      continue;
    }
    if (responseFields.has(responseField)) {
      issues.push({ key: field, message: "Token response field mappings must be unique" });
      continue;
    }
    responseFields.add(responseField);
  }
  return issues;
}

export function getReservedOAuthUrlParameterIssues(
  value: string,
  reserved: ReadonlySet<string>,
): OAuthConfigIssue[] {
  const issues: OAuthConfigIssue[] = [];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // URL shape is owned by the caller's URL validator. This helper only
    // reports reserved query ownership and must remain exception-safe when a
    // schema invokes every refinement for an already-invalid value.
    return issues;
  }
  for (const key of parsed.searchParams.keys()) {
    if (reserved.has(key.toLowerCase())) {
      issues.push({ key, message: `${key} is reserved by the OAuth transport` });
    }
  }
  return issues;
}
