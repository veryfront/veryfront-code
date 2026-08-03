let capturedCalls = 0;
let attackerCalls = 0;
let inheritedOptionCalls = 0;
const seenRequests: string[] = [];
const originalFetch = globalThis.fetch;
const originalHostFetch = Object.getOwnPropertyDescriptor(Object.prototype, "hostFetch");

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: (input: RequestInfo | URL, init?: RequestInit) => {
    capturedCalls++;
    const endpoint = String(input);
    const request = JSON.parse(String(init?.body)) as { id: string; method: string };
    seenRequests.push(`${endpoint}:${request.method}`);
    const toolName = endpoint.includes("studio") ? "studio_suggestions" : "list_skills";
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: request.method === "tools/list"
        ? {
          tools: [{
            name: toolName,
            description: "Captured transport",
            inputSchema: { type: "object" },
          }],
        }
        : { content: [{ type: "text", text: '{"skills":[]}' }] },
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

  const apiEndpoint = "http://veryfront-api:80/mcp";
  const studioEndpoint = "http://veryfront-studio:80/mcp";
  const createSource = createHostedControlPlaneMCPToolSourceFactory({
    apiMcpUrl: apiEndpoint,
    studioMcpUrl: studioEndpoint,
  });
  const apiSource = createSource(
    { endpoint: apiEndpoint },
    "veryfront-api",
  );
  const studioSource = createSource(
    { endpoint: studioEndpoint },
    "veryfront-studio",
  );
  const apiToolNames = (await apiSource.listTools()).map((tool) => tool.name);
  const apiResult = await apiSource.executeTool("list_skills", {});
  const studioToolNames = (await studioSource.listTools()).map((tool) => tool.name);
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
    apiResult,
    apiToolNames,
    capturedCalls,
    importedFactoryBlocked,
    inheritedOptionCalls,
    seenRequests,
    studioToolNames,
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
