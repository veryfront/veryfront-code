import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "./catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "./catalog-client.ts";
import {
  canonicalVeryfrontCloudModelKey,
  canVeryfrontCloudCatalogRefuse,
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID,
  DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
  DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID,
  getVeryfrontCloudProviderFromModelId,
  isListedInServedVeryfrontCloudCatalog,
  isRetiredVeryfrontCloudModelId,
  isServedVeryfrontCloudProvider,
  isSupportedMistralModelId,
  isVeryfrontCloudCatalogLoaded,
  resolveHostedVeryfrontCloudModelId,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAICallTransport,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAIChatSystemMessages,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudOpenAITransportPlan,
  resolveVeryfrontCloudProviderRouting,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  tryGetVeryfrontCloudProviderFromModelId,
} from "./model-catalog.ts";

describe("provider/veryfront-cloud/model-catalog", () => {
  beforeEach(seedServedCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);
  it("retires DeepSeek from managed selections while retaining Mistral as default", () => {
    assertEquals(isListedInServedVeryfrontCloudCatalog("deepseek/deepseek-v4-flash"), false);
    assertEquals(isServedVeryfrontCloudProvider("deepseek"), false);
    assertEquals(DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID, "mistral/mistral-small-2503");
    assertThrows(() => resolveVeryfrontCloudModelId("deepseek-v4-flash"));
  });

  it("drops the models the gateway has retired from the catalog", () => {
    for (
      const modelId of [
        "openai/gpt-5.4-nano",
        "google-ai-studio/gemini-3.1-pro-preview",
        "mistral/mistral-large-2512",
      ]
    ) {
      assertEquals(isListedInServedVeryfrontCloudCatalog(modelId), false);
    }
    for (const alias of ["gpt-5.4-nano", "gemini-3.1-pro-preview", "mistral-large-2512"]) {
      assertThrows(() => resolveVeryfrontCloudModelId(alias));
    }
    assertThrows(
      () => resolveVeryfrontCloudModelId("mistral/mistral-large-2512"),
      Error,
      'Unsupported Mistral model "mistral/mistral-large-2512"',
    );
    for (const modelId of ["openai/gpt-5.4-nano", "google/gemini-3.1-pro-preview"]) {
      assertEquals(isRetiredVeryfrontCloudModelId(modelId), true);
      assertEquals(isRetiredVeryfrontCloudModelId(`veryfront-cloud/${modelId}`), true);
      assertThrows(
        () => resolveVeryfrontCloudModelId(modelId),
        Error,
        "is no longer available through Veryfront Cloud",
      );
    }
    assertEquals(isRetiredVeryfrontCloudModelId("openai/gpt-5-nano"), false);
  });

  it("preserves system layers only for the verified Mistral transport", () => {
    assertEquals(resolveVeryfrontCloudOpenAIChatSystemMessages("mistral/mistral-small-2503"), true);
    assertEquals(
      resolveVeryfrontCloudOpenAIChatSystemMessages("veryfront-cloud/mistral/mistral-small-2503"),
      true,
    );
    for (
      const model of [
        "mistral/mistral-large-2512",
        "openai/gpt-5.4",
        "moonshotai/kimi-k2.6",
        "unlisted/model",
      ]
    ) {
      assertEquals(resolveVeryfrontCloudOpenAIChatSystemMessages(model), undefined);
    }
  });

  it("keeps the EU Nano and DeepSeek identities distinct with their gateway transports", () => {
    assertEquals(resolveVeryfrontCloudModelId("gpt-5-nano"), "openai/gpt-5-nano");
    assertEquals(
      resolveVeryfrontCloudModelId("deepseek/deepseek-v4-flash"),
      "deepseek/deepseek-v4-flash",
    );
    assertEquals(
      resolveVeryfrontCloudOpenAITransportPlan("openai", "gpt-5-nano").transport,
      "responses",
    );
    assertEquals(
      resolveVeryfrontCloudOpenAITransportPlan("deepseek", "deepseek-v4-flash").transport,
      "chat-completions",
    );
  });

  it("finds a catalog model by model id through either spelling of its provider", () => {
    // The catalog publishes Gemini under the `google-ai-studio` alias; a caller
    // spelling the canonical provider (or carrying the gateway prefix) must
    // reach the same entry, thinking defaults included.
    for (
      const modelId of [
        "google-ai-studio/gemini-2.5-pro",
        "google/gemini-2.5-pro",
        "veryfront-cloud/google/gemini-2.5-pro",
      ]
    ) {
      assertEquals(isListedInServedVeryfrontCloudCatalog(modelId), true);
      assertEquals(resolveVeryfrontCloudModelThinking(modelId)?.enabled, true);
    }
    assertEquals(isListedInServedVeryfrontCloudCatalog("google/not-a-listed-model"), false);
  });

  it("recognizes a supported Mistral model through any spelling of its id", () => {
    assertEquals(isSupportedMistralModelId("mistral/mistral-small-2503"), true);
    assertEquals(
      isSupportedMistralModelId("veryfront-cloud/mistral/mistral-small-2503"),
      true,
    );
    assertEquals(
      isSupportedMistralModelId("mistral/not-a-listed-model"),
      false,
    );
  });

  it("resolves Mistral Small 3.1 through the hosted catalog", () => {
    const modelId = "mistral/mistral-small-2503";

    assertEquals(resolveVeryfrontCloudModelId("mistral-small-2503"), modelId);
    assertEquals(isSupportedMistralModelId(modelId), true);
    assertEquals(resolveVeryfrontCloudModelId(modelId), modelId);
    assertEquals(
      resolveHostedVeryfrontCloudModelId(modelId),
      `veryfront-cloud/${modelId}`,
    );
  });

  it("looks capability rows up by the canonical provider, whatever the id spells", () => {
    // Rows are keyed `<canonical provider>/<upstream id>`. A listed alias and
    // the gateway prefix both normalize to that key; an unlisted provider is
    // kept as written; an id with no provider segment is left alone.
    assertEquals(
      canonicalVeryfrontCloudModelKey("google-ai-studio/gemini-2.5-pro"),
      "google/gemini-2.5-pro",
    );
    assertEquals(
      canonicalVeryfrontCloudModelKey(
        "veryfront-cloud/google-ai-studio/gemini-2.5-pro",
      ),
      "google/gemini-2.5-pro",
    );
    assertEquals(
      canonicalVeryfrontCloudModelKey("openai/gpt-5.5"),
      "openai/gpt-5.5",
    );
    assertEquals(
      canonicalVeryfrontCloudModelKey("acme-labs/model-x"),
      "acme-labs/model-x",
    );
    assertEquals(canonicalVeryfrontCloudModelKey("no-slash"), "no-slash");
  });

  it("resolves served short IDs and aliases", () => {
    assertEquals(resolveVeryfrontCloudModelId("opus"), "anthropic/claude-opus-4-8");
    assertEquals(resolveVeryfrontCloudModelId("sonnet"), "anthropic/claude-sonnet-4-6");
    for (
      const [alias, modelId] of [
        ["gpt-5.5", "openai/gpt-5.5"],
        ["gpt-5.4-mini", "openai/gpt-5.4-mini"],
        ["gpt-5.4", "openai/gpt-5.4"],
        ["gpt-5.2", "openai/gpt-5.2"],
        ["gemini-3.5-flash", "google-ai-studio/gemini-3.5-flash"],
        ["gemini-2.5-pro", "google-ai-studio/gemini-2.5-pro"],
        ["gemini-2.5-flash", "google-ai-studio/gemini-2.5-flash"],
        ["mistral-small-2503", "mistral/mistral-small-2503"],
        ["kimi-k2.6", "moonshotai/kimi-k2.6"],
        ["kimi-k2.5", "moonshotai/kimi-k2.5"],
      ]
    ) {
      assertEquals(resolveVeryfrontCloudModelId(alias), modelId);
    }
    assertThrows(() => resolveVeryfrontCloudModelId("nonexistent"), Error, "Unknown model alias");
  });

  it("derives every default-model representation from one built-in default", () => {
    assertEquals(
      DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
      `mistral/${DEFAULT_VERYFRONT_CLOUD_MODEL_ID}`,
    );
    assertEquals(
      DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID,
      `veryfront-cloud/${DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID}`,
    );
  });

  it("extracts providers from direct and hosted model ids", () => {
    assertEquals(
      getVeryfrontCloudProviderFromModelId("anthropic/claude-opus-4-8"),
      "anthropic",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId("veryfront-cloud/openai/gpt-5.5"),
      "openai",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId("google/gemini-3.5-flash"),
      "google",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId(
        "google-ai-studio/gemini-3.1-pro-preview",
      ),
      "google",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId("mistral/mistral-large-2512"),
      "mistral",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId("moonshotai/kimi-k2.6"),
      "moonshotai",
    );
    // A provider the package does not list is kept as written: hosted and
    // delegated runs install this resolver, so rejecting it here would make a
    // model the gateway routes unreachable from those flows.
    assertEquals(
      getVeryfrontCloudProviderFromModelId("acme-labs/mystery-1"),
      "acme-labs",
    );
    assertEquals(
      getVeryfrontCloudProviderFromModelId(
        "veryfront-cloud/acme-labs/mystery-1",
      ),
      "acme-labs",
    );
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("opus"),
      Error,
      'Unknown model provider prefix "opus"',
    );
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("Acme Labs/mystery-1"),
      Error,
      "Unknown model provider prefix",
    );
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("constructor/mystery-1"),
      Error,
      'Unknown model provider prefix "constructor"',
    );
    // The gateway prefix is not a provider. A doubly prefixed ID would otherwise
    // resolve to a provider named after the prefix and build a path that points
    // back at the gateway itself.
    assertThrows(
      () =>
        getVeryfrontCloudProviderFromModelId(
          "veryfront-cloud/veryfront-cloud/mystery-1",
        ),
      Error,
      'Unknown model provider prefix "veryfront-cloud"',
    );
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("veryfront-cloud/mystery-1"),
      Error,
      "Unknown model provider prefix",
    );
  });

  it("returns undefined for unusable provider prefixes in the try helper", () => {
    assertEquals(
      tryGetVeryfrontCloudProviderFromModelId(
        "veryfront-cloud/anthropic/claude-opus-4-8",
      ),
      "anthropic",
    );
    assertEquals(
      tryGetVeryfrontCloudProviderFromModelId("acme-labs/mystery-1"),
      "acme-labs",
    );
    assertEquals(tryGetVeryfrontCloudProviderFromModelId("opus"), undefined);
  });

  it("reads served thinking budgets for direct and hosted model ids", () => {
    for (
      const modelId of [
        "anthropic/claude-sonnet-4-6",
        "veryfront-cloud/anthropic/claude-sonnet-4-6",
      ]
    ) {
      assertEquals(resolveVeryfrontCloudModelThinking(modelId)?.budgetTokens, 2048);
    }
  });

  it("resolves aliases and preserves direct model ids", () => {
    assertEquals(
      resolveVeryfrontCloudModelId("opus"),
      "anthropic/claude-opus-4-8",
    );
    assertEquals(resolveVeryfrontCloudModelId(), "mistral/mistral-small-2503");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.5"), "openai/gpt-5.5");
    assertEquals(
      resolveVeryfrontCloudModelId("gpt-5.4-mini"),
      "openai/gpt-5.4-mini",
    );
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.4"), "openai/gpt-5.4");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.2"), "openai/gpt-5.2");
    assertEquals(
      resolveVeryfrontCloudModelId("mistral-small-2503"),
      "mistral/mistral-small-2503",
    );
    assertEquals(
      resolveVeryfrontCloudModelId("openai/gpt-5.5"),
      "openai/gpt-5.5",
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId("mistral/mistral-small-2603"),
      Error,
      'Unsupported Mistral model "mistral/mistral-small-2603"',
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId("mistral/mistral-medium-3-5"),
      Error,
      'Unsupported Mistral model "mistral/mistral-medium-3-5"',
    );
    // The allowlist is applied to the CANONICAL key, so every spelling the
    // runtime accepts for a Mistral id — the gateway prefix, a provider alias
    // — is gated exactly as the canonical one is.
    assertThrows(
      () =>
        resolveVeryfrontCloudModelId(
          "veryfront-cloud/mistral/mistral-small-2603",
        ),
      Error,
      'Unsupported Mistral model "veryfront-cloud/mistral/mistral-small-2603"',
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId("not-a-real-model"),
      Error,
      'Unknown model alias "not-a-real-model"',
    );
  });

  it("resolves default thinking budgets for catalog models", () => {
    const thinkingModelIds = [
      "anthropic/claude-opus-4-8",
      "veryfront-cloud/anthropic/claude-opus-4-8",
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-haiku-4-5-20251001",
      "openai/gpt-5.5",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4",
      "openai/gpt-5.2",
      "google-ai-studio/gemini-2.5-pro",
      "moonshotai/kimi-k2.6",
      "moonshotai/kimi-k2.5",
    ];

    for (const modelId of thinkingModelIds) {
      assertEquals(resolveVeryfrontCloudModelThinking(modelId)?.enabled, true);
    }

    assertEquals(
      resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6")
        ?.budgetTokens,
      2048,
    );
    assertEquals(
      resolveVeryfrontCloudModelThinking("anthropic/claude-haiku-4-5-20251001")
        ?.budgetTokens,
      1024,
    );
    assertEquals(
      resolveVeryfrontCloudModelThinking("google-ai-studio/gemini-3.5-flash"),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudModelThinking("google-ai-studio/gemini-2.5-flash"),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudModelThinking("mistral/mistral-small-2503"),
      undefined,
    );
  });

  it("resolves model-specific OpenAI transport overrides", () => {
    for (
      const modelId of [
        "openai/gpt-5.4",
        "veryfront-cloud/openai/gpt-5.4",
        "openai/gpt-5.5",
        "veryfront-cloud/openai/gpt-5.5",
      ]
    ) {
      assertEquals(
        resolveVeryfrontCloudOpenAITransport(modelId),
        "chat-completions",
      );
    }

    assertEquals(
      resolveVeryfrontCloudOpenAITransport("openai/gpt-5.2"),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudOpenAITransport("openai/gpt-5.4-mini"),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudOpenAITransport("openai/gpt-5.4-nano"),
      undefined,
    );
  });

  it("resolves model-specific Chat function-tool reasoning capabilities", () => {
    assertEquals(
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("openai/gpt-5.5"),
      false,
    );
    assertEquals(
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
        "veryfront-cloud/openai/gpt-5.5",
      ),
      false,
    );
    assertEquals(
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("openai/gpt-5.4"),
      false,
    );
    assertEquals(
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
        "openai/gpt-5.4-nano",
      ),
      undefined,
    );
  });

  it("rejects non-positive and non-safe thinking budgets", () => {
    const invalidBudgets = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const budgetTokens of invalidBudgets) {
      assertThrows(
        () =>
          resolveVeryfrontCloudReasoningOption("anthropic/claude-sonnet-4-6", {
            enabled: true,
            budgetTokens,
          }),
        Error,
        "positive safe integer",
      );
      assertThrows(
        () =>
          resolveVeryfrontCloudThinkingProviderOptions(
            "anthropic/claude-sonnet-4-6",
            {
              enabled: true,
              budgetTokens,
            },
          ),
        Error,
        "positive safe integer",
      );
    }
  });

  it("prefixes direct provider model ids for the Veryfront Cloud gateway", () => {
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("anthropic/claude-opus-4-8"),
      "veryfront-cloud/anthropic/claude-opus-4-8",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("google-ai-studio/gemini-3.5-flash"),
      "veryfront-cloud/google-ai-studio/gemini-3.5-flash",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("google/gemini-3.5-flash"),
      "veryfront-cloud/google/gemini-3.5-flash",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("mistral/mistral-small-2503"),
      "veryfront-cloud/mistral/mistral-small-2503",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("mistral/mistral-small-2603"),
      "mistral/mistral-small-2603",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("mistral/mistral-medium-3-5"),
      "mistral/mistral-medium-3-5",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("veryfront-cloud/openai/gpt-5.5"),
      "veryfront-cloud/openai/gpt-5.5",
    );
    // A provider the package does not list is routed through the gateway too,
    // so callers that normalize before resolving a model do not fall back to
    // the global provider registry.
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("acme-labs/mystery-1"),
      "veryfront-cloud/acme-labs/mystery-1",
    );
    assertEquals(resolveVeryfrontCloudGatewayModelId("opus"), "opus");
    // The early return for an already prefixed ID is unchanged, so this never
    // stacks a second prefix, and the gateway prefix is never a provider segment.
    assertEquals(
      resolveVeryfrontCloudGatewayModelId(
        "veryfront-cloud/veryfront-cloud/mystery-1",
      ),
      "veryfront-cloud/veryfront-cloud/mystery-1",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("Acme Labs/mystery-1"),
      "Acme Labs/mystery-1",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("constructor/mystery-1"),
      "constructor/mystery-1",
    );
    assertEquals(resolveVeryfrontCloudGatewayModelId(undefined), undefined);
    assertEquals(
      resolveHostedVeryfrontCloudModelId("openai/gpt-5.5"),
      "veryfront-cloud/openai/gpt-5.5",
    );
    assertEquals(
      resolveHostedVeryfrontCloudModelId("mistral/mistral-small-2503"),
      "veryfront-cloud/mistral/mistral-small-2503",
    );
  });

  it("maps enabled Anthropic thinking into provider options", () => {
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions(
        "veryfront-cloud/anthropic/claude-sonnet-4-6",
        {
          enabled: true,
          budgetTokens: 2048,
        },
      ),
      {
        anthropic: {
          temperature: 1,
          thinking: {
            type: "enabled",
            budget_tokens: 2048,
          },
        },
      },
    );
  });

  it("maps Claude Opus 4.8 thinking overrides to adaptive provider options", () => {
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions(
        "anthropic/claude-opus-4-8",
        {
          enabled: true,
          budgetTokens: 2048,
        },
      ),
      {
        anthropic: {
          thinking: {
            type: "adaptive",
            display: "summarized",
          },
          output_config: {
            effort: "high",
          },
        },
      },
    );
  });

  it("keeps adaptive Anthropic thinking out of provider-neutral reasoning", () => {
    for (
      const modelId of [
        "anthropic/claude-opus-4-8",
        "veryfront-cloud/anthropic/claude-opus-4-8",
      ]
    ) {
      assertEquals(
        resolveVeryfrontCloudReasoningOption(modelId, {
          enabled: true,
          budgetTokens: 2048,
        }),
        undefined,
      );
    }

    assertEquals(
      resolveVeryfrontCloudReasoningOption("anthropic/claude-opus-4-8", {
        enabled: false,
      }),
      { enabled: false },
    );
  });

  it("preserves provider-neutral reasoning for non-adaptive models", () => {
    assertEquals(
      resolveVeryfrontCloudReasoningOption("anthropic/claude-sonnet-4-6", {
        enabled: true,
        effort: "high",
        budgetTokens: 2048,
      }),
      {
        enabled: true,
        effort: "high",
        budgetTokens: 2048,
      },
    );
  });

  it("omits disabled, missing-budget, and non-Anthropic thinking options", () => {
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions(
        "anthropic/claude-sonnet-4-6",
        {
          enabled: false,
        },
      ),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions(
        "anthropic/claude-sonnet-4-6",
        {
          enabled: true,
        },
      ),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("openai/gpt-5.5", {
        enabled: true,
        budgetTokens: 2048,
      }),
      undefined,
    );
  });
});

describe("provider/veryfront-cloud/model-catalog without a loaded catalog", () => {
  beforeEach(__resetVeryfrontCloudCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);

  it("refuses no unlisted model, because there is no list to refuse against", () => {
    assertEquals(isVeryfrontCloudCatalogLoaded(), false);
    assertEquals(canVeryfrontCloudCatalogRefuse(), false);
    assertEquals(isSupportedMistralModelId("mistral/mistral-small-2503"), false);
    for (
      const modelId of [
        "mistral/mistral-small-2603",
        "veryfront-cloud/mistral/mistral-medium-3-5",
        "zai/glm-5.2",
        "qwen/qwen3-max",
        "acme-labs/mystery-1",
      ]
    ) {
      assertEquals(resolveVeryfrontCloudModelId(modelId), modelId);
    }
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("mistral/mistral-small-2603"),
      "veryfront-cloud/mistral/mistral-small-2603",
    );
    assertEquals(
      resolveVeryfrontCloudGatewayModelId("zai/glm-5.2"),
      "veryfront-cloud/zai/glm-5.2",
    );
  });

  it("still refuses every model the gateway has retired", () => {
    for (
      const modelId of [
        "openai/gpt-5.4-nano",
        "google/gemini-3.1-pro-preview",
        "google-ai-studio/gemini-3.1-pro-preview",
        "mistral/mistral-large-2512",
      ]
    ) {
      assertEquals(isRetiredVeryfrontCloudModelId(modelId), true, modelId);
      assertThrows(
        () => resolveVeryfrontCloudModelId(modelId),
        Error,
        "is no longer available through Veryfront Cloud",
      );
    }
  });

  it("resolves the built-in default but no short alias", () => {
    assertEquals(resolveVeryfrontCloudModelId(), DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID);
    for (const alias of ["opus", "sonnet", "haiku", DEFAULT_VERYFRONT_CLOUD_MODEL_ID]) {
      assertThrows(
        () => resolveVeryfrontCloudModelId(alias),
        Error,
        "Call loadVeryfrontCloudModelCatalog() first",
      );
    }
  });

  it("routes by protocol defaults", () => {
    for (const provider of ["openai", "anthropic", "google"]) {
      assertEquals(resolveVeryfrontCloudProviderRouting(provider), {
        surface: provider,
        native: true,
      });
    }
    assertEquals(resolveVeryfrontCloudProviderRouting("google-ai-studio"), {
      surface: "google",
      native: true,
    });
    for (const provider of ["mistral", "moonshotai", "deepseek", "zai", "qwen"]) {
      assertEquals(resolveVeryfrontCloudProviderRouting(provider), { surface: "openai" });
      assertEquals(
        resolveVeryfrontCloudOpenAITransportPlan(provider, "some-model"),
        { transport: "chat-completions", pinned: true },
      );
    }
    // OpenAI reasoning families are pinned to Responses by their ID alone.
    for (const model of ["gpt-5-nano", "gpt-5.4", "o3", "o4-mini", "o1"]) {
      assertEquals(
        resolveVeryfrontCloudOpenAITransportPlan("openai", model),
        { transport: "responses", pinned: true },
        model,
      );
    }
    // Any other openai model stays on Chat Completions until a call carries a hosted tool.
    for (const model of ["gpt-5.1", "gpt-5-chat-latest", "gpt-6-sol", "gpt-4o"]) {
      assertEquals(
        resolveVeryfrontCloudOpenAITransportPlan("openai", model),
        { transport: "chat-completions", pinned: false },
        model,
      );
      assertEquals(
        resolveVeryfrontCloudOpenAICallTransport("openai", model, false),
        "chat-completions",
      );
      assertEquals(resolveVeryfrontCloudOpenAICallTransport("openai", model, true), "responses");
    }
    // A reasoning-style ID on another provider never leaves Chat Completions.
    assertEquals(
      resolveVeryfrontCloudOpenAICallTransport("zai", "gpt-5.4", true),
      "chat-completions",
    );
  });

  it("knows no model facts", () => {
    for (
      const modelId of [
        "anthropic/claude-opus-4-8",
        "anthropic/claude-sonnet-4-6",
        "google-ai-studio/gemini-2.5-pro",
        "moonshotai/kimi-k2.6",
      ]
    ) {
      assertEquals(resolveVeryfrontCloudModelThinking(modelId), undefined);
      assertEquals(isListedInServedVeryfrontCloudCatalog(modelId), false);
    }
    assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.5"), undefined);
    assertEquals(resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("openai/gpt-5.5"), undefined);
    assertEquals(
      resolveVeryfrontCloudOpenAIChatSystemMessages("mistral/mistral-small-2503"),
      undefined,
    );
    assertEquals(isServedVeryfrontCloudProvider("anthropic"), false);
  });

  it("takes adaptive Anthropic thinking only from a served model", () => {
    // No model is pinned to adaptive thinking by this package. A model the
    // catalog does not serve with `reasoning_mode: "adaptive"`, including
    // claude-opus-4-7 that the platform no longer lists, gets the budget form.
    for (const modelId of ["anthropic/claude-opus-4-8", "anthropic/claude-opus-4-7"]) {
      assertEquals(
        resolveVeryfrontCloudThinkingProviderOptions(modelId, {
          enabled: true,
          budgetTokens: 2048,
        }),
        { anthropic: { temperature: 1, thinking: { type: "enabled", budget_tokens: 2048 } } },
      );
    }
    seedServedCatalogForTests();
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-opus-4-8", {
        enabled: true,
        budgetTokens: 2048,
      }),
      {
        anthropic: {
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
        },
      },
    );
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-opus-4-7", {
        enabled: true,
        budgetTokens: 2048,
      }),
      { anthropic: { temperature: 1, thinking: { type: "enabled", budget_tokens: 2048 } } },
    );
  });
});
