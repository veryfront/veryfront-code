import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveAgentModelTransport } from "#veryfront/agent/runtime/model-transport.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";

const SERVED_DEFAULT = "anthropic/claude-sonnet-4-6";

function servedCatalog(): Response {
  return Response.json({
    models: [{
      id: "claude-sonnet-4-6",
      modelId: SERVED_DEFAULT,
      provider: "anthropic",
      surface: "anthropic",
      operations: ["messages"],
      aliases: ["sonnet"],
      capabilities: { thinking: true, reasoning_mode: "budget", reasoning_budget_tokens: 2048 },
    }],
    defaultModelId: SERVED_DEFAULT,
  });
}

describe("agent model transport with the served default model", () => {
  let catalogRequests = 0;

  beforeEach(() => {
    __resetVeryfrontCloudCatalogForTests();
    setEnv("VERYFRONT_API_TOKEN", "vf_default_model_test");
    setEnv("VERYFRONT_PROJECT_SLUG", "default-model-project");
    catalogRequests = 0;
    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === "/ai/models") {
          catalogRequests++;
          return Promise.resolve(servedCatalog());
        }
        return Promise.resolve(new Response("unexpected", { status: 500 }));
      }) as typeof fetch,
    );
  });

  afterEach(() => {
    restoreMockFetch();
    __resetVeryfrontCloudCatalogForTests();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    clearModelProviders();
  });

  for (const model of [undefined, "auto"]) {
    it(`resolves ${model ?? "an omitted model"} to the served default on the first request`, async () => {
      const config: AgentConfig = { system: "You are concise.", ...(model ? { model } : {}) };

      const transport = await resolveAgentModelTransport({
        agentId: "agent-1",
        config,
        context: undefined,
        modelOverride: undefined,
        mode: "stream",
      });

      assertEquals(catalogRequests, 1);
      assertEquals(transport.resolvedModelString, `veryfront-cloud/${SERVED_DEFAULT}`);
      assertEquals(transport.requestedModel, `veryfront-cloud/${SERVED_DEFAULT}`);
    });
  }
});
