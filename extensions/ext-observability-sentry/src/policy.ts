import type {
  ApplicationErrorContext,
} from "#veryfront/observability/application-error-contract.ts";

export const DEFAULT_FINGERPRINT = "{{ default }}";

const DB_ERROR_FINGERPRINT = "veryfront-db-error";
// pgbouncer reports these through the wire protocol, so postgres.js surfaces them as a
// PostgresError whose message ends with "(<code>)".
const PGBOUNCER_CONNECTION_ERROR_CODES = [
  "server_login_retry",
  "query_wait_timeout",
] as const;
// postgres.js `Errors.connection()` builds a plain Error with the message
// `write <CODE> <host>:<port>` for every client-side connection failure.
const POSTGRES_JS_CONNECTION_ERROR_PATTERN =
  /^write (CONNECTION_CLOSED|CONNECTION_DESTROYED|CONNECTION_ENDED|CONNECT_TIMEOUT)(?:\s|$)/;
const FAILED_QUERY_PREFIX = "Failed query: ";
const FAILED_QUERY_PARAMS_DELIMITER = "\nparams:";
const FAILED_QUERY_HEAD_MAX_LENGTH = 200;
const SQL_DOLLAR_QUOTE_START_PATTERN = /^\$(?:[_\p{ID_Start}][_\p{ID_Continue}]*)?\$/u;
// PostgreSQL's lexer accepts any high byte in a dollar-quote tag and imposes no length limit, so
// tags outside ECMAScript `ID_Start` (an emoji tag, for example) are still treated as literals and
// their contents cannot reach the title. The tag must nonetheless look like a tag — free of
// whitespace, quotes and further dollar signs — because without that shape check a `$` inside an
// ordinary identifier such as `col$a` swallows the rest of the query.
const SQL_UNRECOGNIZED_DOLLAR_QUOTE_START_PATTERN = /^\$[^\s'"$]+\$/u;
// A dollar quote cannot open straight after an identifier character: PostgreSQL prefers the longer
// identifier match, so `col$tag$inner$tag$` is one identifier rather than `col` followed by a
// literal. `$` is deliberately absent from this class so that adjacent literals such as
// `$$a$$$$b$$` still parse as two dollar-quoted strings.
const SQL_IDENTIFIER_BEFORE_DOLLAR_PATTERN = /[A-Za-z0-9_]/;
const SQL_NUMERIC_LITERAL_PATTERN =
  /^(?:0[xX]_?[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[oO]_?[0-7](?:_?[0-7])*|0[bB]_?[01](?:_?[01])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)/;
const SQL_IDENTIFIER_CHAR_PATTERN = /[A-Za-z0-9_$]/;

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
    ? [serviceName, DB_ERROR_FINGERPRINT, dbConnectionErrorCode]
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
    if (exceptionValue.type === "PostgresError") {
      const trimmedMessage = message.trimEnd();
      const code = PGBOUNCER_CONNECTION_ERROR_CODES.find((candidate) =>
        trimmedMessage.endsWith(`(${candidate})`)
      );
      if (code) return code;
    }
    if (exceptionValue.type === "Error") {
      const code = POSTGRES_JS_CONNECTION_ERROR_PATTERN.exec(message)?.[1];
      if (code) return code;
    }
  }
  return undefined;
}

function normalizeFailedQueryValue(value: string): string {
  if (!value.startsWith(FAILED_QUERY_PREFIX.trimEnd())) return value;
  const remainder = value.slice(FAILED_QUERY_PREFIX.trimEnd().length);
  const paramsDelimiterIndex = remainder.indexOf(FAILED_QUERY_PARAMS_DELIMITER);
  const query = paramsDelimiterIndex === -1 ? remainder : remainder.slice(0, paramsDelimiterIndex);
  const titleQuery = redactSqlLiteralsForTitle(query)
    .replace(/\s+/g, " ")
    .trim();
  const head = titleQuery
    .slice(0, FAILED_QUERY_HEAD_MAX_LENGTH)
    .trimEnd();
  const truncated = titleQuery.length > FAILED_QUERY_HEAD_MAX_LENGTH;
  return `${FAILED_QUERY_PREFIX}${head}${truncated ? "…" : ""}`;
}

function redactSqlLiteralsForTitle(query: string): string {
  let redacted = "";
  let index = 0;

  while (index < query.length) {
    const character = query.charAt(index);

    if (
      (character === "E" || character === "e") &&
      query[index + 1] === "'" &&
      isSqlStringPrefixBoundary(query, index)
    ) {
      index = findQuotedSqlTokenEnd(query, index + 1, "'", { allowBackslashEscapes: true }).end;
      redacted += "?";
      continue;
    }

    if (
      (character === "U" || character === "u") &&
      query[index + 1] === "&" &&
      query[index + 2] === "'" &&
      isSqlStringPrefixBoundary(query, index)
    ) {
      index = findQuotedSqlTokenEnd(query, index + 2, "'").end;
      redacted += "?";
      continue;
    }

    if (character === '"') {
      // Deliberate non-redaction: a double-quoted token is a schema identifier, not data, and
      // keeping it verbatim is what makes titles group by query shape. An unterminated identifier
      // is malformed SQL, so redact it rather than emit the rest of the query untouched.
      const { end, terminated } = findQuotedSqlTokenEnd(query, index, '"');
      redacted += terminated ? query.slice(index, end) : "?";
      index = end;
      continue;
    }

    if (character === "'") {
      index = findQuotedSqlTokenEnd(query, index, "'").end;
      redacted += "?";
      continue;
    }

    if (
      character === "$" &&
      !SQL_IDENTIFIER_BEFORE_DOLLAR_PATTERN.test(query[index - 1] ?? "")
    ) {
      const dollarQuotedEnd = findDollarQuotedSqlTokenEnd(query, index);
      if (dollarQuotedEnd !== undefined) {
        index = dollarQuotedEnd;
        redacted += "?";
        continue;
      }
    }

    if (character === "-" && query[index + 1] === "-") {
      index += 2;
      while (index < query.length && query[index] !== "\n" && query[index] !== "\r") {
        index += 1;
      }
      redacted += "?";
      continue;
    }

    if (character === "/" && query[index + 1] === "*") {
      let depth = 1;
      index += 2;
      while (index < query.length && depth > 0) {
        if (query[index] === "/" && query[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (query[index] === "*" && query[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      redacted += "?";
      continue;
    }

    const canStartNumber = /[0-9]/.test(character) ||
      (character === "." && /[0-9]/.test(query[index + 1] ?? ""));
    const previousCharacter = query[index - 1] ?? "";
    if (canStartNumber && !SQL_IDENTIFIER_CHAR_PATTERN.test(previousCharacter)) {
      const literal = query.slice(index).match(SQL_NUMERIC_LITERAL_PATTERN)?.[0];
      const nextCharacter = literal ? query[index + literal.length] ?? "" : "";
      if (literal && !SQL_IDENTIFIER_CHAR_PATTERN.test(nextCharacter)) {
        redacted += "?";
        index += literal.length;
        continue;
      }
    }

    redacted += character;
    index += 1;
  }

  return redacted;
}

function findDollarQuotedSqlTokenEnd(query: string, start: number): number | undefined {
  const recognizedDelimiter = query.slice(start).match(SQL_DOLLAR_QUOTE_START_PATTERN)?.[0];
  if (recognizedDelimiter) {
    const contentStart = start + recognizedDelimiter.length;
    const closingDelimiter = query.indexOf(recognizedDelimiter, contentStart);
    return closingDelimiter === -1 ? query.length : closingDelimiter + recognizedDelimiter.length;
  }

  if (/[0-9]/.test(query[start + 1] ?? "")) return undefined;
  const delimiter = query.slice(start).match(SQL_UNRECOGNIZED_DOLLAR_QUOTE_START_PATTERN)?.[0];
  if (!delimiter) return undefined;

  const contentStart = start + delimiter.length;
  const closingDelimiter = query.indexOf(delimiter, contentStart);
  return closingDelimiter === -1 ? query.length : closingDelimiter + delimiter.length;
}

function isSqlStringPrefixBoundary(query: string, start: number): boolean {
  return !SQL_IDENTIFIER_CHAR_PATTERN.test(query[start - 1] ?? "");
}

function findQuotedSqlTokenEnd(
  query: string,
  start: number,
  quote: string,
  options: { allowBackslashEscapes?: boolean } = {},
): { end: number; terminated: boolean } {
  let index = start + 1;
  while (index < query.length) {
    if (options.allowBackslashEscapes && query[index] === "\\" && index + 1 < query.length) {
      index += 2;
      continue;
    }
    if (query[index] !== quote) {
      index += 1;
      continue;
    }
    if (query[index + 1] === quote) {
      index += 2;
      continue;
    }
    return { end: index + 1, terminated: true };
  }
  return { end: query.length, terminated: false };
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
