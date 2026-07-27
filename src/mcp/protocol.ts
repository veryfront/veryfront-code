/**
 * MCP protocol versions implemented by this runtime.
 *
 * Keep version negotiation and HTTP header validation on this single source of
 * truth so the transport cannot accept a version the dispatcher would reject.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2024-11-05",
] as const;

export type MCPSupportedProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

export const MCP_LATEST_PROTOCOL_VERSION: MCPSupportedProtocolVersion =
  MCP_SUPPORTED_PROTOCOL_VERSIONS[0];

export function isSupportedMCPProtocolVersion(
  value: unknown,
): value is MCPSupportedProtocolVersion {
  return typeof value === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}
