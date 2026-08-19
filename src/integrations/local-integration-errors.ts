import {
  LOCAL_INTEGRATION_CONFIG_INVALID,
  LOCAL_INTEGRATION_REQUEST_FAILED,
  LOCAL_INTEGRATION_RESPONSE_INVALID,
} from "#veryfront/errors";

export {
  LOCAL_INTEGRATION_CONFIG_INVALID,
  LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE,
  LOCAL_INTEGRATION_CREDENTIALS_MISSING,
  LOCAL_INTEGRATION_REQUEST_FAILED,
  LOCAL_INTEGRATION_REQUEST_INVALID,
  LOCAL_INTEGRATION_RESPONSE_INVALID,
} from "#veryfront/errors";

const apply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;

export interface LocalIntegrationDiagnosticIdentity {
  readonly connectorName: string;
  readonly toolId: string;
}

/**
 * Reduces a caller-supplied identifier to a bounded, log-safe form.
 *
 * Tool names reach this module from the model, so an unbounded value carrying
 * newlines or control characters must not land verbatim in error metadata that
 * is logged upstream. Anything outside the identifier charset collapses to
 * `"unknown"` rather than being escaped, so no caller string survives.
 */
export function safeLocalIntegrationIdentifier(value: unknown): string {
  return safeIdentifier(value);
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
