import * as Sentry from "@sentry/deno";
import type { ExtensionFactory } from "veryfront/extensions";
import type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
  SentryConfig,
} from "veryfront/observability/sentry";

const DEFAULT_FINGERPRINT = "{{ default }}";
const DISABLED_INTEGRATIONS = new Set([
  "Breadcrumbs",
  "DenoHttp",
  "DenoServe",
  "GlobalHandlers",
]);
const SENTRY_TOKEN_PATTERN = /\bsntrys_[A-Za-z0-9_+/=-]+\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^@\s/]+(@[^/\s]+)/gi;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|api_key|auth|authorization|dsn|password|secret|token)=)[^&#\s]+/gi;

type SentryScope = {
  setContext(name: string, context: Record<string, unknown>): void;
  setFingerprint(fingerprint: string[]): void;
  setTag(key: string, value: string): void;
};

type SentrySdk = {
  captureException(error: unknown): string;
  flush(timeoutMs?: number): Promise<boolean>;
  init(options: Parameters<typeof Sentry.init>[0]): unknown;
  withScope(callback: (scope: SentryScope) => void): void;
};

export function createSentryApplicationErrorReporter(
  config: Required<SentryConfig>,
  sdk: SentrySdk = Sentry,
): ApplicationErrorReporter {
  sdk.init({
    dsn: config.dsn,
    ...(config.environment ? { environment: config.environment } : {}),
    ...(config.release ? { release: config.release } : {}),
    beforeSend: (event) => prepareSentryEvent(event, config.serviceName),
    dataCollection: {
      cookies: false,
      databaseQueryData: false,
      frameContextLines: 0,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      httpBodies: [],
      httpHeaders: { request: false, response: false },
      stackFrameVariables: false,
      urlQueryParams: false,
      userInfo: false,
    },
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter((integration) => !DISABLED_INTEGRATIONS.has(integration.name)),
    skipOpenTelemetrySetup: true,
  });

  return {
    capture(error, context) {
      return captureWithSentry(sdk, config.serviceName, error, context);
    },
    flush: (timeoutMs) => sdk.flush(timeoutMs),
  };
}

function captureWithSentry(
  sdk: SentrySdk,
  serviceName: string,
  error: unknown,
  context: ApplicationErrorContext,
): string | undefined {
  let eventId: string | undefined;
  sdk.withScope((scope) => {
    scope.setFingerprint([serviceName, DEFAULT_FINGERPRINT]);
    scope.setTag("service.name", serviceName);
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
    eventId = sdk.captureException(error);
  });
  return eventId;
}

function prepareSentryEvent(
  event: Sentry.ErrorEvent,
  serviceName: string,
): Sentry.ErrorEvent {
  event.tags = {
    ...event.tags,
    "service.name": serviceName,
  };
  event.fingerprint = [serviceName, ...(event.fingerprint ?? [DEFAULT_FINGERPRINT])];

  delete event.breadcrumbs;
  delete event.request;
  delete event.user;

  if (event.message) event.message = redactSensitiveText(event.message);
  if (event.logentry?.message) {
    event.logentry.message = redactSensitiveText(event.logentry.message);
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactSensitiveText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = sanitizeStackFramePath(frame.filename);
      if (frame.abs_path) frame.abs_path = sanitizeStackFramePath(frame.abs_path);
    }
  }

  return event;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(SENTRY_TOKEN_PATTERN, "[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]$2")
    .replace(SENSITIVE_QUERY_PATTERN, "$1[REDACTED]");
}

function sanitizeStackFramePath(value: string): string {
  const redacted = redactSensitiveText(value);
  const path = redacted.startsWith("file://") ? redacted.slice("file://".length) : redacted;
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) return redacted;

  const normalized = path.replaceAll("\\", "/");
  const sourcePath = normalized.match(/(?:^|\/)((?:src|extensions|cli|dist)\/.+)$/)?.[1];
  if (sourcePath) return sourcePath;

  const basename = normalized.split("/").filter(Boolean).at(-1);
  return basename ? `[REDACTED]/${basename}` : "[REDACTED]";
}

const extSentry: ExtensionFactory = () => ({
  name: "ext-observability-sentry",
  version: "0.1.0",
  capabilities: [
    { type: "net:outbound", hosts: ["*"] },
  ],
  setup() {},
});

export default extSentry;
