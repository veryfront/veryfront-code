/** Host-only transport composition for remote MCP sources. */
import {
  createRemoteMCPToolSourceWithTransportCapability,
  type RemoteMCPToolSourceConfig,
} from "../remote-mcp.ts";
import type { RemoteToolSource } from "../types.ts";

const REMOTE_MCP_HOST_TRANSPORT_AUTHORITY = Object.freeze({});

/** Validate the module-private authority without exposing it to public callers. */
export function isRemoteMCPHostTransportAuthority(value: unknown): boolean {
  return value === REMOTE_MCP_HOST_TRANSPORT_AUTHORITY;
}

/** Create a source using a host-owned transport. This module is project-denied. */
export function createRemoteMCPToolSourceWithFetch(
  config: RemoteMCPToolSourceConfig,
  requestFetch: typeof fetch,
): RemoteToolSource {
  return createRemoteMCPToolSourceWithTransportCapability(
    config,
    requestFetch,
    REMOTE_MCP_HOST_TRANSPORT_AUTHORITY,
  );
}
