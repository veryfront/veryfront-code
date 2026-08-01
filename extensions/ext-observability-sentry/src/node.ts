import * as Sentry from "@sentry/node";
import { env as nodeEnvironment } from "node:process";
import {
  resolveSentryConfig,
  type SentryApplicationErrorInitializerOptions,
  type SentryApplicationErrorReporterInitializer,
  type SentryApplicationErrorReporterSession,
  type SentryConfig,
  snapshotSentryInitializerOptions,
} from "./config.ts";
import type { ApplicationErrorReporter } from "#veryfront/observability/application-error-contract.ts";
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

type NodeSentryLifecycleSdk = NodeSentrySdk & {
  close(timeoutMs?: number): Promise<boolean>;
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

function readNodeEnvironment(name: string): string | undefined {
  return nodeEnvironment[name];
}

/** Create an explicitly composed Node Sentry reporter initializer. */
export function createNodeSentryApplicationErrorReporterInitializer(
  options: SentryApplicationErrorInitializerOptions = {},
  sdk: NodeSentryLifecycleSdk = Sentry,
): SentryApplicationErrorReporterInitializer {
  const configuredOptions = snapshotSentryInitializerOptions(options);
  const disposeTimeoutMs = configuredOptions.disposeTimeoutMs;
  const configured = configuredOptions.config;
  const readEnvironment = configuredOptions.readEnvironment ?? readNodeEnvironment;
  return {
    async initialize({ serviceName }): Promise<SentryApplicationErrorReporterSession | undefined> {
      const resolvedConfig = resolveSentryConfig({
        config: configured,
        defaultEnvironment: "production",
        readEnvironment,
        serviceName,
      });
      if (!resolvedConfig) return undefined;

      const reporter = createNodeSentryApplicationErrorReporter(resolvedConfig, sdk);
      let disposal: Promise<void> | undefined;
      return {
        reporter,
        dispose() {
          disposal ??= Promise.resolve()
            .then(() => sdk.close(disposeTimeoutMs))
            .then((closed) => {
              if (closed !== true) {
                throw new Error("Sentry did not close before the application-error deadline");
              }
            });
          return disposal;
        },
      };
    },
  };
}

export type {
  SentryApplicationErrorInitializerOptions,
  SentryApplicationErrorReporterInitializer,
  SentryApplicationErrorReporterSession,
} from "./config.ts";
