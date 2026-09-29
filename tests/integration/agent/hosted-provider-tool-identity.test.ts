import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { SERVED_MODEL_ROWS } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { getProviderNativeToolNames } from "#veryfront/agent/runtime/provider-native-tool-inventory.ts";
import { selectHostedChildForkRuntimeTools } from "#veryfront/agent/hosted/child-requested-tools.ts";
import { createDefaultHostedChatRuntime } from "#veryfront/agent/hosted/default-chat-runtime.ts";
import type { DefaultHostedChatRuntimeTaskContext } from "#veryfront/agent/hosted/default-chat-runtime.ts";

/**
 * Hosted execution caps provider-native tools by the served declaration
 * whatever form the model id takes once it is normalized. A model the runtime
 * routes to its provider directly keeps the implemented tools.
 */

const CREDENTIAL_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "VERYFRONT_API_TOKEN"];

function serveProviderTools(supportedProviderTools: readonly string[]): void {
  __setVeryfrontCloudCatalogForTests({
    models: SERVED_MODEL_ROWS.map((model) => ({ ...model, supportedProviderTools })),
  });
}

function withCredentials<T>(keys: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = CREDENTIAL_KEYS.map((key) => [key, getEnv(key)] as const);
  for (const key of CREDENTIAL_KEYS) deleteEnv(key);
  for (const [key, value] of Object.entries(keys)) setEnv(key, value);
  return fn().finally(() => {
    for (const [key, value] of saved) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
  });
}

async function hostedRunToolNames(model: string): Promise<readonly string[] | undefined> {
  let taskContext: DefaultHostedChatRuntimeTaskContext | undefined;
  const runtime = await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    options: {
      agentId: "researcher",
      projectId: "project-1",
      projectSlug: "test-project",
      authToken: "vf_run_token",
      instructions: "Answer directly.",
      model,
      allowedTools: [],
      allowedProviderTools: ["web_search"],
    },
    config: {
      apiUrl: "https://api.example.test",
      apiMcpUrl: "https://api.example.test/mcp",
    },
    buildLocalTools: (context) => {
      taskContext = context;
      return {};
    },
    createRemoteToolSource: (config) => ({
      id: config.id ?? "fixture",
      listTools: () => Promise.resolve([]),
      executeTool: () => Promise.resolve({}),
    }),
    preloadLatestConversationUserText: false,
  });
  await runtime.cleanup?.();
  return taskContext?.availableToolNames;
}

describe("hosted provider tool identity", () => {
  afterEach(() => __resetVeryfrontCloudCatalogForTests());

  for (const model of ["sonnet", "anthropic/claude-sonnet-4-6", "openai/gpt-5.4"]) {
    it(`removes undeclared provider tools from a hosted run of ${model}`, async () => {
      serveProviderTools([]);
      await withCredentials({}, async () => {
        assertEquals(await hostedRunToolNames(model), []);
      });
    });

    it(`keeps declared provider tools on a hosted run of ${model}`, async () => {
      serveProviderTools(["web_search"]);
      await withCredentials({}, async () => {
        assertEquals(await hostedRunToolNames(model), ["web_search"]);
      });
    });

    it(`caps an explicitly hosted inventory lookup for ${model}`, () => {
      serveProviderTools([]);
      const canonical = resolveVeryfrontCloudModelId(model);
      assertEquals(getProviderNativeToolNames({ model: canonical, hosted: true }), []);
      // The same id routed to its provider directly keeps the implemented tools.
      assertEquals(getProviderNativeToolNames({ model: canonical }).includes("web_search"), true);
    });
  }

  it("keeps implemented provider tools when a hosted run routes to a direct credential", async () => {
    serveProviderTools([]);
    await withCredentials({ ANTHROPIC_API_KEY: "synthetic-direct-key" }, async () => {
      assertEquals(await hostedRunToolNames("anthropic/claude-sonnet-4-6"), ["web_search"]);
    });
  });

  for (const hosted of [true, false]) {
    it(`selects hosted child fork provider tools by explicit identity (hosted: ${hosted})`, () => {
      serveProviderTools([]);
      const result = selectHostedChildForkRuntimeTools({
        provider: "anthropic",
        forkModel: "anthropic/claude-sonnet-4-6",
        hostedModel: hosted,
        forkTools: {},
        requestedTools: ["web_search"],
      });
      assertEquals(result.ok, !hosted);
    });
  }
});
