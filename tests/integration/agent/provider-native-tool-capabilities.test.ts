import "#veryfront/schemas/_test-setup.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import type { Tool } from "#veryfront/tool";
import { clearMCPRegistry, registerTool } from "#veryfront/mcp";
import { applyAgUiRuntimeRestrictionsForModel } from "#veryfront/agent/ag-ui/runtime-restrictions.ts";

function createConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return { id: "researcher", system: "Answer directly.", ...overrides } as AgentConfig;
}

describe("hosted provider tool restriction routing", () => {
  beforeEach(() => {
    clearMCPRegistry();
    registerTool("web_search", {
      id: "web_search",
      type: "function",
      description: "Synthetic local search",
      inputSchema: { type: "object", properties: {} },
      execute: () => Promise.resolve({ ok: true }),
    } as unknown as Tool);
  });
  afterEach(() => clearMCPRegistry());
  for (
    const [configuredModel, credential] of [
      ["anthropic/claude-sonnet-4-6", "ANTHROPIC_API_KEY"],
      ["openai/gpt-5.4", "OPENAI_API_KEY"],
    ] as const
  ) {
    it(`preserves a local search tool when ${configuredModel} routes through a denying cloud catalog`, async () => {
      const previous = getEnv(credential);
      deleteEnv(credential);
      const [provider, id] = configuredModel.split("/");
      __setVeryfrontCloudCatalogForTests({
        models: [{ id, modelId: configuredModel, provider, supportedProviderTools: [] }],
      });
      try {
        await runWithVeryfrontCloudContext(
          { apiToken: "vf_test", projectSlug: "test-project", serviceLayer: "cloud" },
          () => {
            const config = createConfig({
              model: configuredModel,
              tools: true,
              providerTools: ["web_search"],
            });
            const restrictions = { allowedTools: ["web_search"] };
            const hosted = applyAgUiRuntimeRestrictionsForModel(config, restrictions);
            // Keep authored intent; the effective runtime filters native exposure.
            assertEquals(hosted.providerTools, ["web_search"]);
            assertEquals(hosted.tools, { web_search: true });
            setEnv(credential, "synthetic-direct-key");
            const direct = applyAgUiRuntimeRestrictionsForModel(config, restrictions);
            assertEquals(direct.providerTools, ["web_search"]);
            assertEquals(direct.tools, {});
            return Promise.resolve();
          },
        );
      } finally {
        __resetVeryfrontCloudCatalogForTests();
        if (previous === undefined) deleteEnv(credential);
        else setEnv(credential, previous);
      }
    });
  }
});
