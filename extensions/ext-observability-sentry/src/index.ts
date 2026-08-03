import type { ExtensionFactory } from "veryfront/extensions";

export {
  createDenoSentryApplicationErrorReporter,
  createDenoSentryApplicationErrorReporter as createSentryApplicationErrorReporter,
} from "./deno.ts";
export type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "#veryfront/observability/application-error-contract.ts";
export type { SentryConfig } from "./config.ts";

const extSentry: ExtensionFactory = () => ({
  name: "ext-observability-sentry",
  version: "0.1.0",
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
  setup() {},
});

export default extSentry;
