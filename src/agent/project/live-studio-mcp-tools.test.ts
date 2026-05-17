import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "@std/assert";
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

function createDeferredRemoteToolFixtures() {
  const createdSources: RemoteMCPToolSourceConfig[] = [];
  const executedCalls: Array<{
    sourceIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    context?: ToolExecutionContext;
  }> = [];
  const listedContexts: Array<ToolExecutionContext | undefined> = [];

  const createRemoteToolSource = (config: RemoteMCPToolSourceConfig): RemoteToolSource => {
    const sourceIndex = createdSources.length;
    createdSources.push(config);

    return {
      id: config.id ?? "studio-mcp-live-tools",
      listTools: (context) => {
        listedContexts.push(context);
        return Promise.resolve([
          {
            name: "studio_suggestions",
            description: "studio_suggestions",
            parameters: { type: "object", properties: {} },
          },
        ]);
      },
      executeTool: (toolName, args, context) => {
        executedCalls.push({ sourceIndex, toolName, args, context });
        return Promise.resolve({ project: `project-${sourceIndex + 1}` });
      },
    };
  };

  return {
    createdSources,
    executedCalls,
    listedContexts,
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
  assertEquals(fixtures.createdSources, [
    {
      id: "studio-mcp-live-tools",
      endpoint: "https://studio.example.com/mcp",
      headers: {
        Authorization: "Bearer auth-token",
        "x-project-id": "project-1",
        "x-conversation-id": "conversation-1",
      },
    },
    {
      id: "studio-mcp-live-tools",
      endpoint: "https://studio.example.com/mcp",
      headers: {
        Authorization: "Bearer auth-token",
        "x-project-id": "project-2",
        "x-conversation-id": "conversation-1",
      },
    },
  ]);
  assertEquals(fixtures.listedContexts, [{ projectId: "project-1" }, { projectId: "project-2" }]);
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
