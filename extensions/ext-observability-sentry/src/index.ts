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
  ],
  setup() {},
});

export default extSentry;
