import { defineError } from "#veryfront/errors";

const apply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;

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

export interface LocalIntegrationDiagnosticIdentity {
  readonly connectorName: string;
  readonly toolId: string;
}

function safeIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return "unknown";
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const allowed = code >= 48 && code <= 57 || code >= 65 && code <= 90 ||
      code >= 97 && code <= 122 || code === 45 || code === 46 || code === 47 || code === 95;
    if (!allowed) return "unknown";
  }
  return value;
}

function providerDetail(
  identity: LocalIntegrationDiagnosticIdentity,
  outcome: string,
  status?: number,
): string {
  const connectorName = safeIdentifier(identity.connectorName);
  const toolId = safeIdentifier(identity.toolId);
  const statusDetail = status === undefined ? "" : ` with HTTP status ${status}`;
  return `Local integration "${connectorName}" tool "${toolId}" ${outcome}${statusDetail}`;
}

export function localIntegrationRequestFailed(
  identity?: LocalIntegrationDiagnosticIdentity,
  status?: number,
): never {
  if (!identity) throw LOCAL_INTEGRATION_REQUEST_FAILED.create();
  throw LOCAL_INTEGRATION_REQUEST_FAILED.create({
    detail: providerDetail(identity, "request failed", status),
  });
}

export function localIntegrationResponseInvalid(
  identity?: LocalIntegrationDiagnosticIdentity,
  status?: number,
): never {
  if (!identity) throw LOCAL_INTEGRATION_RESPONSE_INVALID.create();
  throw LOCAL_INTEGRATION_RESPONSE_INVALID.create({
    detail: providerDetail(identity, "returned an invalid response", status),
  });
}

export function localIntegrationConfigurationError(detail: string): never {
  throw LOCAL_INTEGRATION_CONFIG_INVALID.create({ detail });
}
