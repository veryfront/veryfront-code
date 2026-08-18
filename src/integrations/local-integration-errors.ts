import { defineError } from "#veryfront/errors";

export const LOCAL_INTEGRATION_CONFIG_INVALID = defineError({
  slug: "local-integration-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid local integration configuration",
  suggestion: "Use exact catalog tool IDs and supported local credential and endpoint contracts",
});

export const LOCAL_INTEGRATION_CREDENTIALS_MISSING = defineError({
  slug: "local-integration-credentials-missing",
  category: "CONFIG",
  status: 400,
  title: "Local integration credentials are missing",
  suggestion: "Set the named environment variables or configure a credential provider",
});

export const LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE = defineError({
  slug: "local-integration-credential-unavailable",
  category: "RUNTIME",
  status: 503,
  title: "Local integration credential is unavailable",
  suggestion: "Check the local credential provider and retry",
});

export const LOCAL_INTEGRATION_REQUEST_INVALID = defineError({
  slug: "local-integration-request-invalid",
  category: "BOUNDARY",
  status: 400,
  title: "Local integration request is invalid",
  suggestion: "Pass only the documented tool arguments with their declared JSON types",
});

export const LOCAL_INTEGRATION_REQUEST_FAILED = defineError({
  slug: "local-integration-request-failed",
  category: "RUNTIME",
  status: 502,
  title: "Local integration request failed",
  suggestion: "Check the provider status and local integration configuration, then retry",
});

export const LOCAL_INTEGRATION_RESPONSE_INVALID = defineError({
  slug: "local-integration-response-invalid",
  category: "RUNTIME",
  status: 502,
  title: "Local integration response is invalid",
  suggestion: "Check the provider response contract and retry",
});

export function localIntegrationConfigurationError(detail: string): never {
  throw LOCAL_INTEGRATION_CONFIG_INVALID.create({ detail });
}
