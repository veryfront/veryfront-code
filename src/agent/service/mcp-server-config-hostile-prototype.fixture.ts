import {
  type AgentServiceMcpServerConfig,
  resolveAgentServiceRemoteMcpConfig,
} from "./mcp-server-config.ts";

const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
let kindReads = 0;
const server = {
  endpoint: "http://127.0.0.1/generic-mcp",
} as Record<string, unknown>;
Object.defineProperty(server, "kind", {
  configurable: true,
  enumerable: true,
  get() {
    kindReads++;
    return "veryfront-studio";
  },
});

try {
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    value: "veryfront-studio",
  });

  const resolved = resolveAgentServiceRemoteMcpConfig({
    server: server as AgentServiceMcpServerConfig,
    authToken: "host-token",
    apiMcpUrl: "http://127.0.0.1/api-mcp",
    studioMcpUrl: "http://127.0.0.1/studio-mcp",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    getProjectId: () => "project-1",
  });

  console.log(JSON.stringify({
    endpoint: resolved.config?.endpoint ?? null,
    kindReads,
    trustedKind: resolved.trustedKind ?? null,
  }));
} finally {
  delete (Object.prototype as Record<string, unknown>).value;
  if (originalValue) {
    Object.defineProperty(Object.prototype, "value", originalValue);
  }
}
