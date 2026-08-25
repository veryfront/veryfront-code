import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "@std/assert";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolExecutionContext,
} from "#veryfront/tool";
import { buildStudioMcpHeaders, createLiveStudioMcpTools } from "./live-studio-mcp-tools.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";

const trustedStudioProfile: RuntimeClientProfile = {
  id: "veryfront-studio",
  type: "web",
  trusted: true,
  capabilities: ["ui_panels", "form_input", "media_display", "project_switching"],
};

function createDeferredRemoteToolFixtures(options: {
  beforeList?: (sourceIndex: number) => Promise<void> | void;
} = {}) {
  const createdSources: RemoteMCPToolSourceConfig[] = [];
  const executedCalls: Array<{
    sourceIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    context?: ToolExecutionContext;
  }> = [];
  const listedContexts: Array<ToolExecutionContext | undefined> = [];
  const listedHeaders: Array<HeadersInit | undefined> = [];
  const executedHeaders: Array<HeadersInit | undefined> = [];

  const createRemoteToolSource = (config: RemoteMCPToolSourceConfig): RemoteToolSource => {
    const sourceIndex = createdSources.length;
    createdSources.push(config);

    return {
      id: config.id ?? "studio-mcp-live-tools",
      listTools: async (context) => {
        listedContexts.push(context);
        listedHeaders.push(
          typeof config.headers === "function" ? await config.headers(context) : config.headers,
        );
        await options.beforeList?.(sourceIndex);
        return [
          {
            name: "studio_suggestions",
            description: "studio_suggestions",
            parameters: { type: "object", properties: {} },
          },
        ];
      },
      executeTool: async (toolName, args, context) => {
        executedCalls.push({ sourceIndex, toolName, args, context });
        executedHeaders.push(
          typeof config.headers === "function" ? await config.headers(context) : config.headers,
        );
        return { project: `project-${sourceIndex + 1}` };
      },
    };
  };

  return {
    createdSources,
    executedCalls,
    executedHeaders,
    listedContexts,
    listedHeaders,
    createRemoteToolSource,
  };
}

Deno.test("buildStudioMcpHeaders includes auth and optional context headers", () => {
  assertEquals(buildStudioMcpHeaders("token", "project-1", "conversation-1"), {
    Authorization: "Bearer token",
    "x-project-id": "project-1",
    "x-conversation-id": "conversation-1",
  });
  assertEquals(buildStudioMcpHeaders("token", null), {
    Authorization: "Bearer token",
  });
});

Deno.test("createLiveStudioMcpTools reconnects studio tools when the active project changes", async () => {
  const fixtures = createDeferredRemoteToolFixtures();
  let projectId = "project-1";

  const studioTools = await createLiveStudioMcpTools({
    authToken: "auth-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => projectId,
    studioMcpUrl: "https://studio.example.com/mcp",
    conversationId: "conversation-1",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });

  const resultProject1 = await studioTools.tools.studio_suggestions?.execute?.(
    { field: "first" },
    undefined,
  );

  projectId = "project-2";
  const resultProject2 = await studioTools.tools.studio_suggestions?.execute?.(
    { field: "second" },
    undefined,
  );

  assertEquals(resultProject1, { project: "project-1" });
  assertEquals(resultProject2, { project: "project-2" });
  assertEquals(
    fixtures.createdSources.map(({ id, endpoint, headers }) => ({
      id,
      endpoint,
      headersType: typeof headers,
    })),
    [
      {
        id: "studio-mcp-live-tools",
        endpoint: "https://studio.example.com/mcp",
        headersType: "function",
      },
      {
        id: "studio-mcp-live-tools",
        endpoint: "https://studio.example.com/mcp",
        headersType: "function",
      },
    ],
  );
  assertEquals(fixtures.listedHeaders, [
    {
      Authorization: "Bearer auth-token",
      "x-project-id": "project-1",
      "x-conversation-id": "conversation-1",
    },
    {
      Authorization: "Bearer auth-token",
      "x-project-id": "project-2",
      "x-conversation-id": "conversation-1",
    },
  ]);
  assertEquals(fixtures.listedContexts, [
    { authToken: "auth-token", projectId: "project-1" },
    { authToken: "auth-token", projectId: "project-2" },
  ]);
  assertEquals(fixtures.executedHeaders, [
    {
      Authorization: "Bearer auth-token",
      "x-project-id": "project-1",
      "x-conversation-id": "conversation-1",
    },
    {
      Authorization: "Bearer auth-token",
      "x-project-id": "project-2",
      "x-conversation-id": "conversation-1",
    },
  ]);
  assertEquals(fixtures.executedCalls, [
    {
      sourceIndex: 0,
      toolName: "studio_suggestions",
      args: { field: "first" },
      context: undefined,
    },
    {
      sourceIndex: 1,
      toolName: "studio_suggestions",
      args: { field: "second" },
      context: undefined,
    },
  ]);

  await studioTools.close();
});

Deno.test("createLiveStudioMcpTools reuses the existing client while the active project stays the same", async () => {
  const fixtures = createDeferredRemoteToolFixtures();

  const studioTools = await createLiveStudioMcpTools({
    authToken: "auth-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });

  await studioTools.tools.studio_suggestions?.execute?.({ field: "first" }, undefined);
  await studioTools.tools.studio_suggestions?.execute?.({ field: "second" }, undefined);

  assertEquals(fixtures.createdSources.length, 1);
  assertEquals(fixtures.listedContexts.length, 1);
  assertEquals(fixtures.executedCalls.length, 2);
});

Deno.test("createLiveStudioMcpTools falls back as one tuple without owned execution auth", async () => {
  const fixtures = createDeferredRemoteToolFixtures();
  const studioTools = await createLiveStudioMcpTools({
    authToken: "bootstrap-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "bootstrap-project",
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });
  const execute = studioTools.tools.studio_suggestions?.execute;
  if (!execute) {
    throw new Error("Expected Studio suggestions tool");
  }

  await execute({}, { runId: "run-1" });
  await execute({}, { projectId: "unowned-project" });

  assertEquals(fixtures.createdSources.length, 1);
  assertEquals(fixtures.executedHeaders, [
    {
      Authorization: "Bearer bootstrap-token",
      "x-project-id": "bootstrap-project",
    },
    {
      Authorization: "Bearer bootstrap-token",
      "x-project-id": "bootstrap-project",
    },
  ]);
  assertEquals(fixtures.executedCalls.map(({ context }) => context), [
    {
      authToken: "bootstrap-token",
      projectId: "bootstrap-project",
      runId: "run-1",
    },
    {
      authToken: "bootstrap-token",
      projectId: "bootstrap-project",
    },
  ]);
});

Deno.test("createLiveStudioMcpTools reloads and caches a same-project auth rotation", async () => {
  const fixtures = createDeferredRemoteToolFixtures();
  const studioTools = await createLiveStudioMcpTools({
    authToken: "bootstrap-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });
  const execute = studioTools.tools.studio_suggestions?.execute;
  if (!execute) {
    throw new Error("Expected Studio suggestions tool");
  }

  await execute({}, { authToken: "run-token-1", projectId: "project-1" });
  await execute({}, { authToken: "run-token-2", projectId: "project-1" });
  await execute({}, { authToken: "run-token-2", projectId: "project-1" });

  assertEquals(fixtures.createdSources.length, 3);
  assertEquals(fixtures.listedHeaders, [
    {
      Authorization: "Bearer bootstrap-token",
      "x-project-id": "project-1",
    },
    {
      Authorization: "Bearer run-token-1",
      "x-project-id": "project-1",
    },
    {
      Authorization: "Bearer run-token-2",
      "x-project-id": "project-1",
    },
  ]);
  assertEquals(fixtures.executedHeaders, [
    {
      Authorization: "Bearer run-token-1",
      "x-project-id": "project-1",
    },
    {
      Authorization: "Bearer run-token-2",
      "x-project-id": "project-1",
    },
    {
      Authorization: "Bearer run-token-2",
      "x-project-id": "project-1",
    },
  ]);
  assertEquals(
    fixtures.executedCalls.map(({ sourceIndex }) => sourceIndex),
    [1, 2, 2],
  );
});

Deno.test("createLiveStudioMcpTools keeps live auth and project identity atomic", async () => {
  const fixtures = createDeferredRemoteToolFixtures();
  let fallbackGetterCalls = 0;
  let allowFallbackGetter = true;
  const studioTools = await createLiveStudioMcpTools({
    authToken: "bootstrap-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => {
      fallbackGetterCalls += 1;
      if (!allowFallbackGetter) {
        throw new Error("Live identity must not read the fallback project");
      }
      return "old-project";
    },
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });
  const execute = studioTools.tools.studio_suggestions?.execute;
  if (!execute) {
    throw new Error("Expected Studio suggestions tool");
  }

  allowFallbackGetter = false;
  let unrelatedGetterCalls = 0;
  const liveContext = {
    authToken: "new-token",
    projectId: "new-project",
  } as ToolExecutionContext;
  Object.defineProperty(liveContext, "untrusted", {
    enumerable: true,
    get() {
      unrelatedGetterCalls += 1;
      return "must-not-run";
    },
  });
  await execute({}, liveContext);

  assertEquals(fallbackGetterCalls, 1);
  assertEquals(unrelatedGetterCalls, 0);
  assertEquals(fixtures.listedHeaders.at(-1), {
    Authorization: "Bearer new-token",
    "x-project-id": "new-project",
  });
  assertEquals(fixtures.executedHeaders.at(-1), {
    Authorization: "Bearer new-token",
    "x-project-id": "new-project",
  });
  assertEquals(fixtures.executedCalls.at(-1)?.context, {
    authToken: "new-token",
    projectId: "new-project",
  });

  let proxyGetCalls = 0;
  const proxyContext = new Proxy<ToolExecutionContext>(
    {
      authToken: "proxy-token",
      projectId: "proxy-project",
      runId: "run-1",
    },
    {
      get(target, property, receiver) {
        proxyGetCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  await execute({}, proxyContext);
  assertEquals(proxyGetCalls, 0);
  assertEquals(fixtures.executedCalls.at(-1)?.context, {
    authToken: "proxy-token",
    projectId: "proxy-project",
    runId: "run-1",
  });
});

Deno.test("createLiveStudioMcpTools keeps owned projectless auth and invalid auth fail closed", async () => {
  const fixtures = createDeferredRemoteToolFixtures();
  let fallbackGetterCalls = 0;
  let allowFallbackGetter = true;
  const studioTools = await createLiveStudioMcpTools({
    authToken: "bootstrap-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => {
      fallbackGetterCalls += 1;
      if (!allowFallbackGetter) {
        throw new Error("Owned auth must not read the fallback project");
      }
      return "project-1";
    },
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });
  const execute = studioTools.tools.studio_suggestions?.execute;
  if (!execute) {
    throw new Error("Expected Studio suggestions tool");
  }

  allowFallbackGetter = false;
  await execute({}, { authToken: "projectless-token" });
  assertEquals(fixtures.listedHeaders.at(-1), {
    Authorization: "Bearer projectless-token",
  });
  assertEquals(fixtures.executedHeaders.at(-1), {
    Authorization: "Bearer projectless-token",
  });

  for (
    const authToken of [
      undefined,
      "",
      " padded-token ",
      "token\nwith-control",
      "tökén",
      "t".repeat(16_385),
    ]
  ) {
    await assertRejects(
      async () => await execute({}, { authToken }),
      TypeError,
      "Studio execution context authToken is invalid",
    );
  }

  let authGetterCalls = 0;
  const accessorContext = {} as ToolExecutionContext;
  Object.defineProperty(accessorContext, "authToken", {
    get() {
      authGetterCalls += 1;
      return "accessor-token";
    },
  });
  await assertRejects(
    async () => await execute({}, accessorContext),
    TypeError,
    "Studio execution context authToken is unreadable",
  );

  assertEquals(authGetterCalls, 0);
  assertEquals(fallbackGetterCalls, 1);
  assertEquals(fixtures.createdSources.length, 2);
});

Deno.test("createLiveStudioMcpTools singleflights by tuple and preserves latest completion", async () => {
  const gates = new Map<number, PromiseWithResolvers<void>>();
  const fixtures = createDeferredRemoteToolFixtures({
    beforeList: async (sourceIndex) => await gates.get(sourceIndex)?.promise,
  });
  const studioTools = await createLiveStudioMcpTools({
    authToken: "bootstrap-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });
  const execute = studioTools.tools.studio_suggestions?.execute;
  if (!execute) {
    throw new Error("Expected Studio suggestions tool");
  }

  const sharedGate = Promise.withResolvers<void>();
  gates.set(1, sharedGate);
  const sharedFirst = execute({}, {
    authToken: "shared-token",
    projectId: "project-1",
  });
  const sharedSecond = execute({}, {
    authToken: "shared-token",
    projectId: "project-1",
  });
  assertEquals(fixtures.createdSources.length, 2);
  sharedGate.resolve();
  await Promise.all([sharedFirst, sharedSecond]);
  assertEquals(fixtures.createdSources.length, 2);

  const olderGate = Promise.withResolvers<void>();
  const latestGate = Promise.withResolvers<void>();
  gates.set(2, olderGate);
  gates.set(3, latestGate);
  const olderExecution = execute({}, {
    authToken: "older-token",
    projectId: "project-1",
  });
  const latestExecution = execute({}, {
    authToken: "latest-token",
    projectId: "project-1",
  });
  assertEquals(fixtures.createdSources.length, 4);

  latestGate.resolve();
  await latestExecution;
  olderGate.resolve();
  await olderExecution;

  await execute({}, {
    authToken: "latest-token",
    projectId: "project-1",
  });
  assertEquals(fixtures.createdSources.length, 4);
  assertEquals(fixtures.executedCalls.at(-1)?.sourceIndex, 3);
});

Deno.test("createLiveStudioMcpTools fails closed when a studio tool disappears after the project changes", async () => {
  let sourceCount = 0;
  const createRemoteToolSource = (config: RemoteMCPToolSourceConfig): RemoteToolSource => {
    const sourceIndex = sourceCount++;

    return {
      id: config.id ?? "studio-mcp-live-tools",
      // Only the first project exposes studio_suggestions; the reconnected
      // project no longer advertises it.
      listTools: () =>
        Promise.resolve(
          sourceIndex === 0
            ? [
              {
                name: "studio_suggestions",
                description: "studio_suggestions",
                parameters: { type: "object", properties: {} },
              },
            ]
            : [],
        ),
      executeTool: () => Promise.resolve({ project: `project-${sourceIndex + 1}` }),
    };
  };

  let projectId = "project-1";
  const studioTools = await createLiveStudioMcpTools({
    authToken: "auth-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => projectId,
    studioMcpUrl: "https://studio.example.com/mcp",
    conversationId: "conversation-1",
    createRemoteToolSource,
  });

  assertEquals(
    await studioTools.tools.studio_suggestions?.execute?.({ field: "first" }, undefined),
    { project: "project-1" },
    "the tool still resolves while the active project advertises it",
  );

  projectId = "project-2";
  await assertRejects(
    async () =>
      await studioTools.tools.studio_suggestions?.execute?.({ field: "second" }, undefined),
    Error,
    "Studio MCP tool unavailable for current project: studio_suggestions",
    "a tool missing after reconnection must fail closed instead of resolving undefined",
  );
});

Deno.test("createLiveStudioMcpTools returns no tools without a trusted Studio-capable client", async () => {
  const fixtures = createDeferredRemoteToolFixtures();

  const studioTools = await createLiveStudioMcpTools({
    authToken: "auth-token",
    clientProfile: {
      id: "veryfront-api",
      type: "api",
      trusted: true,
      capabilities: [],
    },
    getProjectId: () => "project-1",
    studioMcpUrl: "https://studio.example.com/mcp",
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });

  assertEquals(studioTools.tools, {});
  assertEquals(fixtures.createdSources.length, 0);
});

Deno.test("createLiveStudioMcpTools returns no tools without a Studio MCP URL", async () => {
  const fixtures = createDeferredRemoteToolFixtures();

  const studioTools = await createLiveStudioMcpTools({
    authToken: "auth-token",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    studioMcpUrl: null,
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });

  assertEquals(studioTools.tools, {});
  assertEquals(fixtures.createdSources.length, 0);
});
