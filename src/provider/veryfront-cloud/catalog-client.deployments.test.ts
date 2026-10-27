import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { SERVED_MODEL_ROWS, UNSERVED_MODEL_ROWS } from "./catalog-client.test-helpers.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
  parseVeryfrontCloudCatalog,
  type VeryfrontCloudCatalogModel,
} from "./catalog-client.ts";
import {
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudProviderRouting,
} from "./model-catalog.ts";

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

/** IDs a model is selected by besides its model ID, which deployments do not repeat as an alias. */
function selectorIds(model: VeryfrontCloudCatalogModel): string[] {
  return [...new Set([model.id, ...model.aliases])].filter((id) => id !== model.modelId).sort();
}

/** What routing reads from a model. A missing tool list grants no tools, like an empty one. */
function routingFacts(model: VeryfrontCloudCatalogModel) {
  const { aliases: _aliases, ...facts } = model;
  return {
    ...facts,
    supportedProviderTools: model.supportedProviderTools ?? [],
    selectorIds: selectorIds(model),
  };
}

/** The legacy row with this short ID. */
function legacyRow(id: string): LegacyRow {
  const row = LEGACY_ROWS.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`No legacy row ${id}`);
  return row;
}

describe("provider/veryfront-cloud/catalog-client deployments", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

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

  it("routes a model by its deprecated row when its first enabled deployment cannot be read", () => {
    const mistral = legacyRow("mistral-small-2503");
    const unreadable = deploymentOf(mistral);
    const catalog = parseVeryfrontCloudCatalog({
      models: [mistral],
      deployments: [{ ...unreadable, routing: { operations: [] } }, deploymentOf(mistral)],
    });

    assertEquals(
      catalog,
      parseVeryfrontCloudCatalog({ models: [mistral], defaultModelId: mistral.modelId }),
    );
  });

  it("uses the served token ceilings when the API sends deployments without legacy rows", () => {
    const item = deploymentOf(legacyRow("gpt-5.5"));
    const limit = { context: 256_000, output: 32_000 };
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [{
        ...item,
        model: { ...item.model, capabilities: { ...item.model.capabilities, limit } },
      }],
    });
    assertEquals(catalog?.models[0]?.limit, limit);
  });

  it("prefers replacement token ceilings over legacy values for the same model", () => {
    const row = legacyRow("gpt-5.5");
    const item = deploymentOf(row);
    const limit = { context: 128_000, output: 16_000 };
    const catalog = parseVeryfrontCloudCatalog({
      models: [{
        ...row,
        capabilities: { ...row.capabilities, limit: { context: 1_000_000, output: 64_000 } },
      }],
      deployments: [{
        ...item,
        model: { ...item.model, capabilities: { ...item.model.capabilities, limit } },
      }],
    });
    assertEquals(catalog?.models[0]?.limit, limit);
  });

  it("preserves known legacy dimensions when the deployment publishes only one ceiling", () => {
    const row = legacyRow("gpt-5.5");
    const item = deploymentOf(row);
    const catalog = parseVeryfrontCloudCatalog({
      models: [{
        ...row,
        capabilities: { ...row.capabilities, limit: { context: 1_000_000, output: 64_000 } },
      }],
      deployments: [{
        ...item,
        model: {
          ...item.model,
          capabilities: { ...item.model.capabilities, limit: { context: 128_000 } },
        },
      }],
    });
    assertEquals(catalog?.models[0]?.limit, { context: 128_000, output: 64_000 });
  });

  it("leaves token limits unset when the API serves deployments only", () => {
    const catalog = parseVeryfrontCloudCatalog({
      deployments: LEGACY_ROWS.map((row) => deploymentOf(row)),
    });

    assertEquals(catalog?.models.map((model) => model.limit), LEGACY_ROWS.map(() => undefined));
  });

  it("leaves out a model whose first enabled deployment cannot be read, default included", () => {
    const mistral = legacyRow("mistral-small-2503");
    const unreadable = deploymentOf(mistral);
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [
        { ...unreadable, model: { ...unreadable.model, aliases: [] } },
        deploymentOf(mistral),
      ],
    });

    assertEquals(catalog, { models: [], defaultModelId: undefined });
  });

  it("preserves legacy token limits across the served Gemini canonical ID migration", () => {
    const pro = legacyRow("gemini-2.5-pro");
    const limit = { context: 1_000_000, output: 65_536 };
    const deployment = deploymentOf(pro);
    const catalog = parseVeryfrontCloudCatalog({
      models: [{ ...pro, capabilities: { ...pro.capabilities, limit } }],
      deployments: [{
        ...deployment,
        model: { ...deployment.model, id: "google/gemini-2.5-pro" },
      }],
    });
    assertEquals(catalog?.models[0]?.limit, limit);
  });

  it("prefers exact legacy identities and never inherits limits through arbitrary aliases", () => {
    const pro = legacyRow("gemini-2.5-pro");
    const deployment = deploymentOf(pro);
    const exactLimit = { context: 200_000, output: 32_000 };
    const catalog = parseVeryfrontCloudCatalog({
      models: [
        { ...pro, capabilities: { ...pro.capabilities, limit: { context: 1_000_000 } } },
        {
          ...pro,
          modelId: "google/gemini-2.5-pro",
          capabilities: { ...pro.capabilities, limit: exactLimit },
        },
      ],
      deployments: [{ ...deployment, model: { ...deployment.model, id: "google/gemini-2.5-pro" } }],
    });
    assertEquals(catalog?.models[0]?.limit, exactLimit);
    const foreign = parseVeryfrontCloudCatalog({
      models: [{
        ...pro,
        modelId: "foreign/gemini-2.5-pro",
        capabilities: { ...pro.capabilities, limit: exactLimit },
      }],
      deployments: [{ ...deployment, model: { ...deployment.model, id: "google/gemini-2.5-pro" } }],
    });
    assertEquals(foreign?.models[0]?.limit, undefined);
  });

  it("takes the default only from the first enabled deployment of a listed model", () => {
    const [gpt, mistral] = ["gpt-5.5", "mistral-small-2503"].map(legacyRow);
    const catalog = parseVeryfrontCloudCatalog({
      deployments: [
        deploymentOf(gpt!, { enabled: false, disabled_by: "project", is_default: true }),
        deploymentOf(gpt!),
        deploymentOf(mistral!, { is_default: false }),
        deploymentOf(mistral!, { is_default: true }),
      ],
    });

    assertEquals(catalog?.models.map((model) => model.modelId), [
      "openai/gpt-5.5",
      "mistral/mistral-small-2503",
    ]);
    assertEquals(catalog?.defaultModelId, undefined);
  });

  it("routes a Gemini model saved as google-ai-studio/... when deployments serve google/...", () => {
    const pro = legacyRow("gemini-2.5-pro");
    const saved = "google-ai-studio/gemini-2.5-pro";
    const routing = () => ({
      thinking: resolveVeryfrontCloudModelThinking(saved),
      provider: resolveVeryfrontCloudProviderRouting("google-ai-studio"),
    });
    __setVeryfrontCloudCatalogForTests({ models: [pro] });
    const legacy = routing();

    const served = deploymentOf(pro);
    __setVeryfrontCloudCatalogForTests({
      deployments: [{
        ...served,
        model: { ...served.model, id: "google/gemini-2.5-pro", aliases: ["gemini-2.5-pro"] },
      }],
    });

    assertEquals(legacy.thinking !== undefined, true);
    assertEquals(routing(), legacy);
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
