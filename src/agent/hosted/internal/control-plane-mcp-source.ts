/** Host-only transport for exact operator-configured control-plane MCP endpoints. */
import {
  createOutboundFetchBoundary,
  normalizeTrustedEndpoint,
} from "#veryfront/security/http/outbound-fetch.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { createRemoteMCPToolSourceWithFetch } from "#veryfront/tool/internal/remote-mcp-transport.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type {
  AgentServiceFirstPartyMcpServerKind,
  AgentServiceRemoteMcpSourceFactory,
} from "../../service/mcp-server-config.ts";

// Capture the host transport before project execution can replace global fetch.
const capturedHostFetch = globalThis.fetch.bind(globalThis);
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;

type TrustedControlPlaneMCPToolSourceFactoryOptions = {
  /** Host-owned test seam. Production composition must omit this field. */
  hostFetch?: typeof fetch;
  logger?: {
    warn(message: string, metadata: { kind: "veryfront-api" | "veryfront-studio" }): void;
  };
};

function readOwnHostFetch(
  options: TrustedControlPlaneMCPToolSourceFactoryOptions,
): typeof fetch | undefined {
  const descriptor = ObjectGetOwnPropertyDescriptor(options, "hostFetch");
  if (!descriptor || !ObjectHasOwn(descriptor, "value")) return undefined;

  const hostFetch = descriptor.value;
  if (hostFetch !== undefined && typeof hostFetch !== "function") {
    throw new TypeError("Control-plane host fetch must be a function");
  }
  return hostFetch as typeof fetch | undefined;
}

/**
 * Build a source factory that bypasses tenant egress policy only for the exact
 * API and Studio MCP URLs supplied by matching first-party server configs.
 *
 * This module is denied by the project import rewriter. Generic and dynamic
 * endpoints always retain the normal guarded transport.
 */
export function createTrustedControlPlaneMCPToolSourceFactory(
  trustedEndpoints: readonly {
    kind: "veryfront-api" | "veryfront-studio";
    endpoint: string;
  }[],
  options: TrustedControlPlaneMCPToolSourceFactoryOptions = {},
): AgentServiceRemoteMcpSourceFactory {
  const boundary = createOutboundFetchBoundary({
    fetch: readOwnHostFetch(options) ?? capturedHostFetch,
  });
  const trustedTransports: Array<{
    kind: "veryfront-api" | "veryfront-studio";
    configuredEndpoint: string;
    normalizedEndpoint: string;
    requestFetch: typeof fetch;
  }> = [];
  for (let index = 0; index < trustedEndpoints.length; index++) {
    const trustedEndpoint = trustedEndpoints[index]!;
    const configuredEndpoint = trustedEndpoint.endpoint;
    let normalizedEndpoint: string;
    try {
      normalizedEndpoint = normalizeTrustedEndpoint(configuredEndpoint);
    } catch {
      // Unsafe operator endpoints retain guarded egress instead of blocking runtime startup.
      options.logger?.warn("Ignored invalid control-plane MCP endpoint configuration", {
        kind: trustedEndpoint.kind,
      });
      continue;
    }
    trustedTransports[trustedTransports.length] = {
      kind: trustedEndpoint.kind,
      configuredEndpoint,
      normalizedEndpoint,
      requestFetch: boundary.createTrustedEndpointFetch(normalizedEndpoint),
    };
  }

  return (
    config: RemoteMCPToolSourceConfig,
    trustedKind?: AgentServiceFirstPartyMcpServerKind,
  ) => {
    let trustedTransport: (typeof trustedTransports)[number] | undefined;
    if (typeof config.endpoint === "string") {
      for (let index = 0; index < trustedTransports.length; index++) {
        const candidate = trustedTransports[index]!;
        if (
          trustedKind === candidate.kind &&
          (config.endpoint === candidate.configuredEndpoint ||
            config.endpoint === candidate.normalizedEndpoint)
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
export function createHostedControlPlaneMCPToolSourceFactory(
  config: {
    apiMcpUrl: string;
    studioMcpUrl?: string | null;
  },
  options: TrustedControlPlaneMCPToolSourceFactoryOptions = {},
): AgentServiceRemoteMcpSourceFactory {
  return createTrustedControlPlaneMCPToolSourceFactory(
    [
      { kind: "veryfront-api", endpoint: config.apiMcpUrl },
      ...(config.studioMcpUrl
        ? [{ kind: "veryfront-studio" as const, endpoint: config.studioMcpUrl }]
        : []),
    ],
    options,
  );
}
