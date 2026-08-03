/** Host-only transport for exact operator-configured control-plane MCP endpoints. */
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { createOutboundFetchBoundary } from "#veryfront/security/http/outbound-fetch.ts";
import {
  createRemoteMCPToolSource,
  createRemoteMCPToolSourceWithFetch,
} from "#veryfront/tool/remote-mcp.ts";
import type { RemoteMCPToolSourceConfig, RemoteToolSource } from "#veryfront/tool";

// Capture the host transport before project execution can replace global fetch.
const capturedHostFetch = globalThis.fetch.bind(globalThis);

function getHostFetch(): typeof fetch {
  return getHostEnv("DENO_TESTING") === "1" ? globalThis.fetch.bind(globalThis) : capturedHostFetch;
}

/**
 * Build a source factory that bypasses tenant egress policy only for the exact
 * API and Studio MCP URLs supplied by host runtime configuration.
 *
 * This module is denied by the project import rewriter. Generic and dynamic
 * endpoints always retain the normal guarded transport.
 */
export function createTrustedControlPlaneMCPToolSourceFactory(
  trustedEndpoints: readonly string[],
): (config: RemoteMCPToolSourceConfig) => RemoteToolSource {
  const boundary = createOutboundFetchBoundary({ fetch: getHostFetch() });
  const trustedFetchByEndpoint = new Map(
    trustedEndpoints.map((endpoint) => {
      const normalizedEndpoint = new URL(endpoint).toString();
      return [
        normalizedEndpoint,
        boundary.createTrustedEndpointFetch(normalizedEndpoint),
      ] as const;
    }),
  );

  return (config) => {
    const normalizedEndpoint = typeof config.endpoint === "string"
      ? new URL(config.endpoint).toString()
      : null;
    const trustedFetch = normalizedEndpoint === null
      ? undefined
      : trustedFetchByEndpoint.get(normalizedEndpoint);
    return trustedFetch === undefined
      ? createRemoteMCPToolSource(config)
      : createRemoteMCPToolSourceWithFetch(config, trustedFetch);
  };
}

/** Build the shared root/child source factory from host runtime configuration. */
export function createHostedControlPlaneMCPToolSourceFactory(config: {
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
}): (config: RemoteMCPToolSourceConfig) => RemoteToolSource {
  return createTrustedControlPlaneMCPToolSourceFactory([
    config.apiMcpUrl,
    ...(config.studioMcpUrl ? [config.studioMcpUrl] : []),
  ]);
}
