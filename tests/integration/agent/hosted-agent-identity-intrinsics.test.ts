import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createDefaultHostedChatRuntime,
  createPreparedHostedRuntimeAgent,
} from "#veryfront/agent/hosted/default-chat-runtime.ts";

it("selects hosted identities without invoking a project-replaced string intrinsic", async () => {
  const boundIdentity = "fixture-bound-agent";
  const sourceIntegrationPolicy = {
    schemaVersion: 1,
    mode: "allowlist",
    integrations: {},
  } as const;
  const trim = String.prototype.trim;
  const apply = Reflect.apply;
  let observed = 0;
  const sites: string[] = [];
  try {
    String.prototype.trim = function () {
      if (String(this) === boundIdentity) {
        observed += 1;
        sites.push(new Error().stack ?? "");
      }
      return apply(trim, this, []);
    };
    const options = {
      projectId: "fixture-project",
      agentId: boundIdentity,
      instructions: "Fixture",
      model: "openai/gpt-5.4",
    };
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy,
      options: { ...options, authToken: "fixture-token" },
      config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
      buildLocalTools: () => ({}),
      createRemoteToolSource: (config) => ({
        id: config.id ?? "fixture",
        listTools: () => Promise.resolve([]),
        executeTool: () => Promise.resolve({}),
      }),
      preloadLatestConversationUserText: false,
    });
    await runtime.cleanup();
    createPreparedHostedRuntimeAgent({
      options,
      taskContext: { projectId: "fixture-project" },
      modelId: options.model,
      sourceIntegrationPolicy,
      toolAssembly: {
        sourceIntegrationPolicy,
        runtimeTools: {},
        remoteToolSources: [],
        localToolNames: [],
        remoteToolNames: [],
        providerToolNames: [],
        availableToolNames: [],
        compatibleRemoteToolNames: [],
        toolLoadingMode: "eager",
        systemInstructions: "Fixture",
      },
    }, {});
  } finally {
    String.prototype.trim = trim;
  }
  assertEquals(observed, 0, sites.join("\n"));
});
