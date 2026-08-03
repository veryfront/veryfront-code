/** Host-only composition for operator-configured control-plane MCP endpoints. */
import { createOperatorConfiguredMCPToolSourceFactory } from "#veryfront/tool/internal/remote-mcp-transport.ts";
import type { AgentServiceRemoteMcpSourceFactory } from "../../service/mcp-server-config.ts";

type HostedControlPlaneMCPToolSourceFactoryOptions = {
  logger?: {
    warn(message: string, metadata: { kind: "veryfront-api" | "veryfront-studio" }): void;
  };
};

/** Build the shared root/child source factory from host runtime configuration. */
export function createHostedControlPlaneMCPToolSourceFactory(
  config: {
    apiMcpUrl: string;
    studioMcpUrl?: string | null;
  },
  options: HostedControlPlaneMCPToolSourceFactoryOptions = {},
): AgentServiceRemoteMcpSourceFactory {
  return createOperatorConfiguredMCPToolSourceFactory(config, options);
}
