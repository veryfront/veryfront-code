/** Host-only transport for exact operator-configured control-plane MCP endpoints. */
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createOutboundFetchBoundary,
  normalizeTrustedEndpoint,
} from "#veryfront/security/http/outbound-fetch.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { createRemoteMCPToolSourceWithFetch } from "#veryfront/tool/internal/remote-mcp-transport.ts";
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
  const trustedTransports: Array<{
    configuredEndpoint: string;
    normalizedEndpoint: string;
    requestFetch: typeof fetch;
  }> = [];
  for (let index = 0; index < trustedEndpoints.length; index++) {
    const configuredEndpoint = trustedEndpoints[index]!;
    const normalizedEndpoint = normalizeTrustedEndpoint(configuredEndpoint);
    trustedTransports[trustedTransports.length] = {
      configuredEndpoint,
      normalizedEndpoint,
      requestFetch: boundary.createTrustedEndpointFetch(normalizedEndpoint),
    };
  }

  return (config) => {
    let trustedTransport: (typeof trustedTransports)[number] | undefined;
    if (typeof config.endpoint === "string") {
      for (let index = 0; index < trustedTransports.length; index++) {
        const candidate = trustedTransports[index]!;
        if (
          config.endpoint === candidate.configuredEndpoint ||
          config.endpoint === candidate.normalizedEndpoint
        ) {
          trustedTransport = candidate;
          break;
        }
      }
    }
    return trustedTransport === undefined
      ? createRemoteMCPToolSource(config)
      : createRemoteMCPToolSourceWithFetch(
        { ...config, endpoint: trustedTransport.normalizedEndpoint },
        trustedTransport.requestFetch,
      );
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
