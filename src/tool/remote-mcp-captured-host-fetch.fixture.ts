let capturedCalls = 0;
let attackerCalls = 0;
let inheritedOptionCalls = 0;
const originalFetch = globalThis.fetch;
const originalHostFetch = Object.getOwnPropertyDescriptor(Object.prototype, "hostFetch");

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedCalls++;
    const request = JSON.parse(String(init?.body)) as { id: string };
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{
          name: "captured_transport",
          description: "Captured transport",
          inputSchema: { type: "object" },
        }],
      },
    }));
  },
});

try {
  const { createHostedControlPlaneMCPToolSourceFactory } = await import(
    "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts"
  );
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (_input: RequestInfo | URL, _init?: RequestInit) => {
      attackerCalls++;
      return Promise.resolve(Response.json({}));
    },
  });
  Object.defineProperty(Object.prototype, "hostFetch", {
    configurable: true,
    value: (_input: RequestInfo | URL, init?: RequestInit) => {
      inheritedOptionCalls++;
      const request = JSON.parse(String(init?.body)) as { id: string };
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: [{
            name: "inherited_transport",
            description: "Inherited transport",
            inputSchema: { type: "object" },
          }],
        },
      }));
    },
  });

  const endpoint = "http://veryfront-api:80/mcp";
  const source = createHostedControlPlaneMCPToolSourceFactory({ apiMcpUrl: endpoint })(
    { endpoint },
    "veryfront-api",
  );
  const toolNames = (await source.listTools()).map((tool) => tool.name);
  const unconfiguredEndpoint = "http://attacker-mcp:80/mcp";
  const importedFactorySource = createHostedControlPlaneMCPToolSourceFactory({
    apiMcpUrl: unconfiguredEndpoint,
  })(
    { endpoint: unconfiguredEndpoint },
    "veryfront-api",
  );
  let importedFactoryBlocked = false;
  try {
    await importedFactorySource.listTools();
  } catch (error) {
    importedFactoryBlocked = error instanceof Error &&
      error.message.startsWith("Outbound network egress blocked");
  }
  console.log(JSON.stringify({
    attackerCalls,
    capturedCalls,
    importedFactoryBlocked,
    inheritedOptionCalls,
    toolNames,
  }));
} finally {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  if (originalHostFetch) {
    Object.defineProperty(Object.prototype, "hostFetch", originalHostFetch);
  } else {
    delete (Object.prototype as { hostFetch?: unknown }).hostFetch;
  }
}
