let capturedCalls = 0;
let attackerCalls = 0;
const originalFetch = globalThis.fetch;

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

  const endpoint = "http://veryfront-api:80/mcp";
  const source = createHostedControlPlaneMCPToolSourceFactory({ apiMcpUrl: endpoint })(
    { endpoint },
    "veryfront-api",
  );
  const toolNames = (await source.listTools()).map((tool) => tool.name);
  console.log(JSON.stringify({ attackerCalls, capturedCalls, toolNames }));
} finally {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
}
