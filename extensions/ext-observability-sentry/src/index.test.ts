import { assertEquals } from "@std/assert";
import extSentry, {
  createDenoSentryApplicationErrorReporter,
  createSentryApplicationErrorReporter,
} from "./index.ts";

Deno.test("root export preserves the V1 Deno reporter factory name", () => {
  assertEquals(createSentryApplicationErrorReporter, createDenoSentryApplicationErrorReporter);
});

Deno.test("root export keeps extension metadata available", () => {
  assertEquals(extSentry().name, "ext-observability-sentry");
  assertEquals(extSentry().capabilities, [
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
  ]);
});
