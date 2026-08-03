import { createHostedControlPlaneMCPToolSourceFactory } from "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts";
import {
  type AgentServiceMcpServerConfig,
  resolveAgentServiceRemoteMcpConfig,
} from "#veryfront/agent/service/mcp-server-config.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";

let transportCalls = 0;
let error = "";
const prototype = Object.prototype as { kind?: string };

Object.defineProperty(prototype, "kind", {
  configurable: true,
  value: "veryfront-api",
});

try {
  await __runWithOutboundFetchTransportForTests(
    {
      fetch: () => {
        transportCalls++;
        return Promise.resolve(Response.json({}));
      },
    },
    async () => {
      const endpoint = "http://veryfront-api:80/mcp";
      const createSource = createHostedControlPlaneMCPToolSourceFactory({
        apiMcpUrl: endpoint,
      });
      const resolved = resolveAgentServiceRemoteMcpConfig({
        server: { endpoint } as AgentServiceMcpServerConfig,
        authToken: "host-token",
        apiMcpUrl: endpoint,
      });
      if (!resolved.config) {
        throw new Error("Expected generic MCP config");
      }
      const source = createSource(resolved.config, resolved.trustedKind);

      try {
        await source.listTools();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    },
  );
} finally {
  delete prototype.kind;
}

console.log(JSON.stringify({
  blocked: error.startsWith("Outbound network egress blocked"),
  transportCalls,
}));
