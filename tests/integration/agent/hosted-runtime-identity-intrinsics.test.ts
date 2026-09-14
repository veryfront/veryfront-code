import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createDefaultHostedChatRuntime,
  createPreparedHostedRuntimeAgent,
} from "#veryfront/agent/hosted/default-chat-runtime.ts";

const agentId = "bound-identity-intrinsics";
const policy = { schemaVersion: 1, mode: "allowlist", integrations: {} } as const;

for (const surface of ["default", "prepared"] as const) {
  for (const replacement of ["blank", "throw"] as const) {
    it(`preserves ${surface} identity with a ${replacement} trim replacement`, async () => {
      const trim = String.prototype.trim;
      const apply = Reflect.apply;
      let calls = 0;
      let cleanup: (() => Promise<void>) | undefined;
      let preparedId: string | undefined;
      String.prototype.trim = function () {
        if (String(this) === agentId) {
          calls++;
          if (replacement === "throw") throw new Error("project replacement invoked");
          return "";
        }
        return apply(trim, this, []);
      };
      try {
        if (surface === "default") {
          const runtime = await createDefaultHostedChatRuntime({
            sourceIntegrationPolicy: policy,
            options: {
              agentId,
              projectId: "project-1",
              authToken: "fixture",
              instructions: "Fixture",
              model: "openai/gpt-5.4",
            },
            config: {
              apiUrl: "https://api.example.test",
              apiMcpUrl: "https://api.example.test/mcp",
            },
            buildLocalTools: () => ({}),
            createRemoteToolSource: (config) => ({
              id: config.id ?? "fixture",
              listTools: async () => [],
              executeTool: async () => ({}),
            }),
            preloadLatestConversationUserText: false,
          });
          cleanup = runtime.cleanup;
        } else {
          const runtime = createPreparedHostedRuntimeAgent({
            options: {
              agentId,
              projectId: "project-1",
              instructions: "Fixture",
              model: "openai/gpt-5.4",
            },
            modelId: "openai/gpt-5.4",
            taskContext: {},
            sourceIntegrationPolicy: policy,
            toolAssembly: {
              sourceIntegrationPolicy: policy,
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
          preparedId = runtime.id;
        }
      } finally {
        String.prototype.trim = trim;
        await cleanup?.();
      }
      assertEquals(calls, 0);
      if (surface === "prepared") assertEquals(preparedId, agentId);
    });
  }
}
