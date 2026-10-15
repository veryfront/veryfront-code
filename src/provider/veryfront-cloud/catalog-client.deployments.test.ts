import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SERVED_MODEL_ROWS, UNSERVED_MODEL_ROWS } from "./catalog-client.test-helpers.ts";
import { parseVeryfrontCloudCatalog, type VeryfrontCloudCatalogModel } from "./catalog-client.ts";

type LegacyRow = (typeof SERVED_MODEL_ROWS)[number] | (typeof UNSERVED_MODEL_ROWS)[number];

const LEGACY_ROWS: readonly LegacyRow[] = [...SERVED_MODEL_ROWS, ...UNSERVED_MODEL_ROWS];

/**
 * The `deployments` entry the API serves for a legacy row: model aliases start
 * with the short ID and leave out the provider-qualified ID.
 */
function deploymentOf(row: LegacyRow, overrides: Record<string, unknown> = {}) {
  const capabilities: Record<string, unknown> = row.capabilities;
  const reasoningMode = capabilities.reasoning_mode;
  const budgetTokens = capabilities.reasoning_budget_tokens;
  const reasoningWithTools = capabilities.chat_completions_reasoning_with_function_tools;
  const consecutiveSystem = capabilities.chat_completions_consecutive_system_messages;
  return {
    model: {
      id: row.modelId,
      aliases: [...new Set([row.id, ...row.aliases])].filter((alias) => alias !== row.modelId),
      name: row.id,
      capabilities: { reasoning: capabilities.thinking, web_research: false, temperature: null },
    },
    model_provider: { id: row.provider, name: row.provider, icon_url: "https://example.test/icon" },
    inference_provider: { id: "google-vertex", name: "Google" },
    region: "eu",
    pricing: null,
    routing: {
      surface: row.surface,
      operations: row.operations,
      provider_tools: [],
      ...(capabilities.transport === undefined ? {} : { transport: capabilities.transport }),
      ...(reasoningMode === undefined
        ? {}
        : { reasoning: { mode: reasoningMode, budget_tokens: budgetTokens } }),
      ...(reasoningWithTools === undefined && consecutiveSystem === undefined ? {} : {
        chat_completions: {
          reasoning_with_function_tools: reasoningWithTools,
          consecutive_system_messages: consecutiveSystem,
        },
      }),
    },
    is_default: row.modelId === "mistral/mistral-small-2503",
    enabled: true,
    ...overrides,
  };
}

/** Short IDs a model is selected by: slashed aliases select nothing. */
function shortIds(model: VeryfrontCloudCatalogModel): string[] {
  return [...new Set([model.id, ...model.aliases])].filter((id) => !id.includes("/")).sort();
}

/** What routing reads from a model. A missing tool list grants no tools, like an empty one. */
function routingFacts(model: VeryfrontCloudCatalogModel) {
  const { aliases: _aliases, ...facts } = model;
  return {
    ...facts,
    supportedProviderTools: model.supportedProviderTools ?? [],
    shortIds: shortIds(model),
  };
}

describe("provider/veryfront-cloud/catalog-client deployments", () => {
  it("reads every model from deployments with the facts the deprecated rows gave", () => {
    const legacy = parseVeryfrontCloudCatalog({
      models: LEGACY_ROWS,
      defaultModelId: "mistral/mistral-small-2503",
    });
    const current = parseVeryfrontCloudCatalog({
      deployments: LEGACY_ROWS.map((row) => deploymentOf(row)),
    });

    assertEquals(current?.models.map(routingFacts), legacy?.models.map(routingFacts));
    assertEquals(current?.defaultModelId, "mistral/mistral-small-2503");
  });

  it("maps every routing field of a deployment", () => {
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [{
        model: {
          id: "openai/gpt-5.5",
          aliases: ["gpt-5.5", "gpt"],
          name: "GPT-5.5",
          capabilities: { reasoning: true, web_research: true, temperature: null },
        },
        model_provider: { id: "openai", name: "OpenAI", icon_url: "https://example.test/icon" },
        inference_provider: { id: "azure-foundry", name: "Microsoft" },
        region: "eu",
        pricing: null,
        routing: {
          surface: "openai",
          operations: ["chat-completions"],
          transport: "chat-completions",
          provider_tools: ["web_search"],
          reasoning: { mode: "budget", budget_tokens: 4096 },
          chat_completions: {
            reasoning_with_function_tools: false,
            consecutive_system_messages: true,
          },
        },
        is_default: false,
        enabled: true,
      }],
    });

    assertEquals(catalog, {
      models: [{
        id: "gpt-5.5",
        modelId: "openai/gpt-5.5",
        provider: "openai",
        aliases: ["gpt-5.5", "gpt"],
        surface: "openai",
        operations: ["chat-completions"],
        supportedProviderTools: ["web_search"],
        thinking: true,
        reasoningMode: "budget",
        transport: "chat-completions",
        reasoningBudgetTokens: 4096,
        limit: undefined,
        chatCompletionsReasoningWithFunctionTools: false,
        chatCompletionsConsecutiveSystemMessages: true,
      }],
      defaultModelId: undefined,
    });
  });

  it("routes each model to its first enabled deployment and leaves out disabled models", () => {
    const [sonnet, gpt, mistral] = ["claude-sonnet-4-6", "gpt-5.5", "mistral-small-2503"].map(
      (id) => LEGACY_ROWS.find((row) => row.id === id)!,
    );
    const disabled = { enabled: false, disabled_by: "account", is_default: false };
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [
        deploymentOf(sonnet!, { ...disabled, routing: { surface: "openai", operations: [] } }),
        deploymentOf(sonnet!),
        deploymentOf(sonnet!, { routing: { surface: "openai", operations: [] } }),
        deploymentOf(gpt!, disabled),
        deploymentOf(mistral!, disabled),
        deploymentOf(mistral!),
      ],
    });

    assertEquals(catalog?.models.map((model) => [model.modelId, model.surface]), [
      ["anthropic/claude-sonnet-4-6", "anthropic"],
      ["mistral/mistral-small-2503", "openai"],
    ]);
    assertEquals(catalog?.defaultModelId, "mistral/mistral-small-2503");
  });

  it("keeps a model's token limits from its deprecated row while the API serves both", () => {
    const [row] = LEGACY_ROWS;
    const limit = { context: 200_000, output: 32_000 };
    const catalog = parseVeryfrontCloudCatalog({
      models: [{ ...row, capabilities: { ...row!.capabilities, limit } }],
      deployments: [deploymentOf(row!)],
    });

    assertEquals(catalog?.models[0]?.limit, limit);
  });

  it("reads an empty deployment list as a catalog without models", () => {
    assertEquals(parseVeryfrontCloudCatalog({ deployments: [] }), {
      models: [],
      defaultModelId: undefined,
    });
  });

  it("skips a deployment whose model has no short ID", () => {
    const [row] = LEGACY_ROWS;
    const deployment = deploymentOf(row!);
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [{ ...deployment, model: { ...deployment.model, aliases: [] } }],
    });

    assertEquals(catalog?.models, []);
  });

  it("reads the deprecated rows from an API that serves deployments without routing", () => {
    const [row] = LEGACY_ROWS;
    const { routing: _routing, ...firstDrop } = deploymentOf(row!, { is_default: true });
    const catalog = parseVeryfrontCloudCatalog({
      models: [row],
      defaultModelId: "anthropic/claude-sonnet-4-6",
      deployments: [firstDrop],
    });

    assertEquals(catalog?.models.map((model) => model.aliases), [row!.aliases]);
    assertEquals(catalog?.defaultModelId, "anthropic/claude-sonnet-4-6");
  });

  it("reads the deprecated rows from an API without deployments", () => {
    const catalog = parseVeryfrontCloudCatalog({ models: LEGACY_ROWS });

    assertEquals(catalog?.models.length, LEGACY_ROWS.length);
  });
});
