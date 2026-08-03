/** Host-only composition for operator-configured control-plane MCP sources. */
import {
  createOutboundFetchBoundary,
  normalizeTrustedEndpoint,
} from "#veryfront/security/http/outbound-fetch.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createRemoteMCPToolSource,
  createRemoteMCPToolSourceWithTransportCapability,
  type RemoteMCPToolSourceConfig,
} from "../remote-mcp.ts";
import type { RemoteToolSource } from "../types.ts";

// Identity is the authority. The module never exports a function that combines
// caller-selected endpoints or transports with this value.
const REMOTE_MCP_HOST_TRANSPORT_AUTHORITY = {};
const hostFetch = globalThis.fetch;
const ReflectApply = Reflect.apply;

const capturedHostFetch: typeof fetch = (input, init) =>
  ReflectApply(hostFetch, globalThis, [input, init]) as Promise<Response>;

type FirstPartyMcpServerKind = "veryfront-api" | "veryfront-studio";

type OperatorConfiguredMCPToolSourceFactoryOptions = {
  logger?: {
    warn(message: string, metadata: { kind: FirstPartyMcpServerKind }): void;
  };
};

function captureOperatorEndpoint(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    return normalizeTrustedEndpoint(endpoint);
  } catch {
    return undefined;
  }
}

// Snapshot deployment-owned endpoints before project code runs. Importing this
// module later cannot designate a new privileged destination.
const capturedOperatorApiMcpEndpoint = captureOperatorEndpoint(
  `${getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com"}/mcp`,
);
const capturedOperatorStudioMcpEndpoint = captureOperatorEndpoint(
  getHostEnv("VERYFRONT_STUDIO_MCP_URL"),
);

/** Validate the module-private authority without exposing it to public callers. */
export function isRemoteMCPHostTransportAuthority(value: unknown): boolean {
  return value === REMOTE_MCP_HOST_TRANSPORT_AUTHORITY;
}

/**
 * Build the only factory that can mint host-transport MCP sources.
 *
 * The caller may describe runtime endpoints, but host transport is selected
 * only when the first-party kind and normalized endpoint also match the
 * deployment-owned snapshot captured above. All other sources use guarded
 * egress.
 */
export function createOperatorConfiguredMCPToolSourceFactory(
  config: {
    apiMcpUrl: string;
    studioMcpUrl?: string | null;
  },
  options: OperatorConfiguredMCPToolSourceFactoryOptions = {},
): (
  config: RemoteMCPToolSourceConfig,
  trustedKind?: FirstPartyMcpServerKind,
) => RemoteToolSource {
  const boundary = createOutboundFetchBoundary({ fetch: capturedHostFetch });
  const configuredEndpoints = [
    { kind: "veryfront-api" as const, endpoint: config.apiMcpUrl },
    ...(config.studioMcpUrl
      ? [{ kind: "veryfront-studio" as const, endpoint: config.studioMcpUrl }]
      : []),
  ];
  const trustedTransports: Array<{
    kind: FirstPartyMcpServerKind;
    configuredEndpoint: string;
    normalizedEndpoint: string;
    requestFetch: typeof fetch;
  }> = [];

  for (let index = 0; index < configuredEndpoints.length; index++) {
    const configured = configuredEndpoints[index]!;
    let normalizedEndpoint: string;
    try {
      normalizedEndpoint = normalizeTrustedEndpoint(configured.endpoint);
    } catch {
      options.logger?.warn("Ignored invalid control-plane MCP endpoint configuration", {
        kind: configured.kind,
      });
      continue;
    }
    const operatorEndpoint = configured.kind === "veryfront-api"
      ? capturedOperatorApiMcpEndpoint
      : capturedOperatorStudioMcpEndpoint;
    if (normalizedEndpoint !== operatorEndpoint) {
      options.logger?.warn("Ignored unconfigured control-plane MCP endpoint", {
        kind: configured.kind,
      });
      continue;
    }
    trustedTransports[trustedTransports.length] = {
      kind: configured.kind,
      configuredEndpoint: configured.endpoint,
      normalizedEndpoint,
      requestFetch: boundary.createTrustedEndpointFetch(normalizedEndpoint),
    };
  }

  return (sourceConfig, trustedKind) => {
    let trustedTransport: (typeof trustedTransports)[number] | undefined;
    if (typeof sourceConfig.endpoint === "string") {
      for (let index = 0; index < trustedTransports.length; index++) {
        const candidate = trustedTransports[index]!;
        if (
          trustedKind === candidate.kind &&
          (sourceConfig.endpoint === candidate.configuredEndpoint ||
            sourceConfig.endpoint === candidate.normalizedEndpoint)
        ) {
          trustedTransport = candidate;
          break;
        }
      }
    }

    return trustedTransport === undefined
      ? createRemoteMCPToolSource(sourceConfig)
      : createRemoteMCPToolSourceWithTransportCapability(
        { ...sourceConfig, endpoint: trustedTransport.normalizedEndpoint },
        trustedTransport.requestFetch,
        REMOTE_MCP_HOST_TRANSPORT_AUTHORITY,
      );
  };
}
