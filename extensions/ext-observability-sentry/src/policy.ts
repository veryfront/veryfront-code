import type {
  ApplicationErrorContext,
} from "#veryfront/observability/application-error-contract.ts";

export const DEFAULT_FINGERPRINT = "{{ default }}";

const DB_ERROR_FINGERPRINT = "veryfront-db-error";
const DB_CONNECTION_ERROR_CODES = [
  "server_login_retry",
  "query_wait_timeout",
  "CONNECTION_CLOSED",
] as const;
const CLIENT_DB_CONNECTION_ERROR_CODES = ["CONNECTION_CLOSED"] as const;
const FAILED_QUERY_PREFIX = "Failed query: ";
const FAILED_QUERY_HEAD_MAX_LENGTH = 200;

const SENTRY_TOKEN_PATTERN = /\bsntrys_[A-Za-z0-9_+/=-]+\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^@\s/]+(@[^/\s]+)/gi;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|api_key|auth|authorization|dsn|password|secret|token)=)[^&#\s]+/gi;
const SENSITIVE_ATTRIBUTE_KEY_PATTERN =
  /(?:^|[_\-.])(?:api[_\-.]?key|auth|authorization|cookie|credentials?|dsn|jwt|password|secret|session|signature|token)(?:$|[_\-.])/i;

export type SentryPolicyScope = {
  setContext(name: string, context: Record<string, unknown>): void;
  setFingerprint(fingerprint: string[]): void;
  setTag(key: string, value: string): void;
};

export type SentryPolicySdk = {
  captureException(error: unknown): string;
  flush(timeoutMs?: number): Promise<boolean>;
  withScope(callback: (scope: SentryPolicyScope) => void): void;
};

export type SentryPolicyEvent = {
  breadcrumbs?: unknown;
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: {
        frames?: Array<{
          abs_path?: string;
          filename?: string;
        }>;
      };
    }>;
  };
  fingerprint?: string[];
  logentry?: {
    message?: string;
  };
  message?: string;
  request?: unknown;
  tags?: Record<string, unknown>;
  type?: undefined;
  user?: unknown;
};

export function captureWithSentryPolicy(
  sdk: SentryPolicySdk,
  serviceName: string,
  error: unknown,
  context: ApplicationErrorContext,
): string | undefined {
  try {
    let eventId: string | undefined;
    sdk.withScope((scope) => {
      applySentryScopePolicy(scope, serviceName, context);
      eventId = sdk.captureException(error);
    });
    return eventId;
  } catch {
    return undefined;
  }
}

export async function flushWithSentryPolicy(
  sdk: Pick<SentryPolicySdk, "flush">,
  timeoutMs?: number,
): Promise<boolean> {
  try {
    return await sdk.flush(timeoutMs);
  } catch {
    return false;
  }
}

export function applySentryScopePolicy(
  scope: SentryPolicyScope,
  serviceName: string,
  context: ApplicationErrorContext,
): void {
  scope.setFingerprint([serviceName, DEFAULT_FINGERPRINT]);
  scope.setTag("service.name", serviceName);
  if (context.processRole) scope.setTag("process_role", context.processRole);
  scope.setTag("veryfront.boundary", context.boundary);
  if (context.method) scope.setTag("http.request.method", context.method);
  if (context.requestId) scope.setTag("veryfront.request_id", context.requestId);
  if (context.traceId) {
    scope.setTag("grafana.trace_id", context.traceId);
    scope.setContext("grafana_trace", {
      trace_id: context.traceId,
      ...(context.spanId ? { span_id: context.spanId } : {}),
    });
  }
  if (context.attributes && Object.keys(context.attributes).length > 0) {
    scope.setContext(
      "veryfront_application_error",
      sanitizeApplicationErrorAttributes(context.attributes),
    );
  }
}

export function prepareSentryEvent<TEvent extends SentryPolicyEvent>(
  event: TEvent,
  serviceName: string,
): TEvent & SentryPolicyEvent {
  event.tags = {
    ...event.tags,
    "service.name": serviceName,
  };
  const dbConnectionErrorCode = detectDbConnectionErrorCode(event);
  event.fingerprint = dbConnectionErrorCode
    ? [DB_ERROR_FINGERPRINT, dbConnectionErrorCode]
    : [serviceName, ...(event.fingerprint ?? [DEFAULT_FINGERPRINT])];

  delete event.breadcrumbs;
  delete event.request;
  delete event.user;

  if (event.message) event.message = redactSensitiveText(event.message);
  if (event.logentry?.message) {
    event.logentry.message = redactSensitiveText(event.logentry.message);
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) {
      value.value = normalizeFailedQueryValue(redactSensitiveText(value.value));
    }
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = sanitizeStackFramePath(frame.filename);
      if (frame.abs_path) frame.abs_path = sanitizeStackFramePath(frame.abs_path);
    }
  }

  return event;
}

function detectDbConnectionErrorCode(event: SentryPolicyEvent): string | undefined {
  for (const exceptionValue of event.exception?.values ?? []) {
    const message = exceptionValue.value ?? "";
    const candidates = exceptionValue.type === "PostgresError"
      ? DB_CONNECTION_ERROR_CODES
      : exceptionValue.type === "Error"
      ? CLIENT_DB_CONNECTION_ERROR_CODES
      : [];
    const code = candidates.find((candidate) => message.includes(candidate));
    if (code) return code;
  }
  return undefined;
}

export function normalizeFailedQueryValue(value: string): string {
  if (!value.startsWith(FAILED_QUERY_PREFIX.trimEnd())) return value;
  const remainder = value.slice(FAILED_QUERY_PREFIX.trimEnd().length);
  if (!/^\s*\n/.test(remainder)) return value;
  const head = remainder
    .slice(0, FAILED_QUERY_HEAD_MAX_LENGTH)
    .replace(/\s+/g, " ")
    .trim();
  const truncated = remainder.trimEnd().length > FAILED_QUERY_HEAD_MAX_LENGTH;
  return `${FAILED_QUERY_PREFIX}${head}${truncated ? "…" : ""}`;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(SENTRY_TOKEN_PATTERN, "[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]$2")
    .replace(SENSITIVE_QUERY_PATTERN, "$1[REDACTED]");
}

export function sanitizeApplicationErrorAttributes(
  attributes: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string") {
      sanitized[key] = value;
      continue;
    }
    sanitized[key] = isSensitiveAttributeKey(key) ? "[REDACTED]" : redactSensitiveText(value);
  }
  return sanitized;
}

function isSensitiveAttributeKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return SENSITIVE_ATTRIBUTE_KEY_PATTERN.test(normalized);
}

export function sanitizeStackFramePath(value: string): string {
  const redacted = redactSensitiveText(value);
  const path = redacted.startsWith("file://") ? redacted.slice("file://".length) : redacted;
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) return redacted;

  const normalized = path.replaceAll("\\", "/");
  const sourcePath = normalized.match(/(?:^|\/)((?:src|extensions|cli|dist)\/.+)$/)?.[1];
  if (sourcePath) return sourcePath;

  const basename = normalized.split("/").filter(Boolean).at(-1);
  return basename ? `[REDACTED]/${basename}` : "[REDACTED]";
}
