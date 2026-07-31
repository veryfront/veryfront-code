import * as Sentry from "@sentry/node";
import type { ApplicationErrorReporter } from "#veryfront/observability/application-error-contract.ts";
import type { SentryConfig } from "./config.ts";
import {
  captureWithSentryPolicy,
  flushWithSentryPolicy,
  prepareSentryEvent,
  type SentryPolicySdk,
} from "./policy.ts";

export type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "#veryfront/observability/application-error-contract.ts";
export type { SentryConfig } from "./config.ts";

type NodeSentrySdk = SentryPolicySdk & {
  init(options: Parameters<typeof Sentry.init>[0]): unknown;
};

export function createNodeSentryApplicationErrorReporter(
  config: Required<SentryConfig>,
  sdk: NodeSentrySdk = Sentry,
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
    defaultIntegrations: false,
    enableLogs: false,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
  });

  return {
    capture(error, context) {
      return captureWithSentryPolicy(sdk, config.serviceName, error, context);
    },
    flush: (timeoutMs) => flushWithSentryPolicy(sdk, timeoutMs),
  };
}
