import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import {
  createRuntimeMcpSourceCleanup,
  getRuntimeRemoteToolSources,
  type RuntimeRemoteToolConfig,
} from "./mcp-server-tool-sources.ts";
import { runWithExactRuntimeRemoteToolSources } from "./remote-tool-source-context.ts";
import type { AgentConfig } from "../types.ts";

function createOwnedSources(dispose: () => Promise<void>) {
  return getRuntimeRemoteToolSources({
    system: "Use remote tools.",
    mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["get_file"] } }],
  }, {
    getVeryfrontBootstrap: () => ({
      apiBaseUrl: "https://api.example/",
      apiToken: "test-token",
      projectSlug: "test-project",
      hasRequestContext: false,
      usesVeryfrontFs: false,
    }),
    createRemoteToolSource: () => ({
      id: "veryfront-platform-mcp",
      listTools: async () => [],
      executeTool: async () => undefined,
      dispose,
    }),
  })!;
}

Deno.test("MCP cleanup terminates owned sources through policy/platform/project wrappers", async () => {
  let disposed = 0;
  {
    await using _cleanup = createRuntimeMcpSourceCleanup(createOwnedSources(async () => {
      disposed++;
    }));
  }
  assertEquals(disposed, 1);
});

Deno.test("MCP cleanup preserves failures while releasing owned sources", async () => {
  let disposed = 0;
  await assertRejects(
    async () => {
      await using _cleanup = createRuntimeMcpSourceCleanup(createOwnedSources(async () => {
        disposed++;
        throw new Error("termination failed");
      }));
      throw new Error("discovery failed");
    },
    Error,
    "discovery failed",
  );
  assertEquals(disposed, 1);
});

Deno.test("MCP cleanup leaves inherited and injected sources with their owner", async () => {
  let disposed = 0;
  const parentSources = createOwnedSources(async () => {
    disposed++;
  });
  const injected: RemoteToolSource = {
    id: "host-mcp",
    listTools: async () => [],
    executeTool: async () => undefined,
    dispose: async () => {
      disposed++;
    },
  };
  const childSources = runWithExactRuntimeRemoteToolSources(
    parentSources,
    () =>
      getRuntimeRemoteToolSources({ system: "Child", tools: { get_file: true } }, {
        getVeryfrontBootstrap: () => ({
          apiBaseUrl: "https://api.example/",
          hasRequestContext: false,
          usesVeryfrontFs: false,
        }),
      }),
  );
  const injectedSources = getRuntimeRemoteToolSources(
    {
      system: "Host",
      __vfRemoteToolSources: [injected],
    } as AgentConfig & RuntimeRemoteToolConfig,
  );
  {
    await using _childCleanup = createRuntimeMcpSourceCleanup(childSources);
    await using _injectedCleanup = createRuntimeMcpSourceCleanup(injectedSources);
  }
  assertEquals(disposed, 0);
  {
    await using _parentCleanup = createRuntimeMcpSourceCleanup(parentSources);
  }
  assertEquals(disposed, 1);
});
