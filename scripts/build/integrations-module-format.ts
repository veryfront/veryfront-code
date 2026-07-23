export function formatGeneratedModuleEntries(entries: string[]): string {
  return entries.length > 0 ? `${entries.join(",\n")},` : "";
}

const SAFE_CONNECTOR_DIRECTORY_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const CONNECTOR_SOURCE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function formatConnectorName(connectorName: string): string {
  return SAFE_CONNECTOR_DIRECTORY_NAME.test(connectorName)
    ? connectorName
    : "<invalid-connector>";
}

/** Return a sanitized connector identity mismatch. */
export function formatConnectorIdentityMismatch(connectorName: string): string {
  return `${formatConnectorName(connectorName)}: connector name must match its directory name`;
}

/** Return whether parsed connector JSON has valid source-only metadata. */
export function isConnectorSourceRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.internal === undefined || typeof record.internal === "boolean") &&
    (record.version === undefined ||
      (typeof record.version === "string" && CONNECTOR_SOURCE_VERSION.test(record.version)));
}

/** Return a sanitized connector source-metadata validation failure. */
export function formatConnectorSourceMetadataFailure(connectorName: string): string {
  return `${formatConnectorName(connectorName)}: connector.json has invalid source metadata`;
}

/** Return a sanitized connector-source failure without exposing filesystem details. */
export function formatConnectorSourceFailure(
  connectorName: string,
  error: unknown,
): string {
  const safeName = formatConnectorName(connectorName);
  if (error instanceof Deno.errors.NotFound) {
    return `${safeName}: connector.json not found`;
  }
  return `${safeName}: failed to load connector.json`;
}

/** Return a sanitized connector-icon failure without exposing filesystem details. */
export function formatConnectorIconFailure(
  connectorName: string,
  error: unknown,
): string {
  const safeName = formatConnectorName(connectorName);
  return error instanceof Deno.errors.NotFound
    ? `${safeName}: declared icon file not found`
    : `${safeName}: failed to load declared icon`;
}
