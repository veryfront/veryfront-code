import type { ExtensionFactory } from "veryfront/extensions";
import {
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
} from "veryfront/extensions/observability";
import {
  createDenoSentryApplicationErrorReporterInitializer,
  type SentryApplicationErrorInitializerOptions,
} from "./deno.ts";
import { snapshotSentryInitializerOptions } from "./config.ts";

export {
  createDenoSentryApplicationErrorReporter,
  createDenoSentryApplicationErrorReporterInitializer,
} from "./deno.ts";
export type { SentryApplicationErrorInitializerOptions, SentryConfig } from "./deno.ts";

function resolveExtensionConfig(config: unknown): SentryApplicationErrorInitializerOptions {
  if (config === undefined) return {};
  return snapshotSentryInitializerOptions(config as SentryApplicationErrorInitializerOptions);
}

const extSentry: ExtensionFactory = (config) => {
  const initializer = createDenoSentryApplicationErrorReporterInitializer(
    resolveExtensionConfig(config),
  );
  return {
    name: "ext-observability-sentry",
    version: "0.1.0",
    contracts: {
      provides: [ApplicationErrorReporterInitializerName],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "APP_ENVIRONMENT",
          "NODE_ENV",
          "OTEL_DEPLOYMENT_ENVIRONMENT",
          "OTEL_SERVICE_NAME",
          "OTEL_SERVICE_VERSION",
          "RELEASE_VERSION",
          "SENTRY_DSN",
          "SENTRY_ENVIRONMENT",
          "SENTRY_RELEASE",
          "SENTRY_SERVICE",
          "SENTRY_SERVICE_NAME",
          "VERYFRONT_ENV",
          "VERYFRONT_ENVIRONMENT",
          "VERYFRONT_VERSION",
          "npm_package_name",
          "npm_package_version",
        ],
      },
    ],
    setup(ctx) {
      ctx.provide<ApplicationErrorReporterInitializer>(
        ApplicationErrorReporterInitializerName,
        initializer,
      );
    },
  };
};

export default extSentry;
