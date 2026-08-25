import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL,
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID,
  DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
  DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID,
  findVeryfrontCloudModel,
  findVeryfrontCloudModelByModelId,
  getVeryfrontCloudProviderFromModelId,
  groupVeryfrontCloudModelsByProvider,
  resolveHostedVeryfrontCloudModelId,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  tryGetVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "./model-catalog.ts";

describe("provider/veryfront-cloud/model-catalog", () => {
  it("finds catalog models by alias", () => {
    const opus = findVeryfrontCloudModel("opus");
    assertExists(opus);
    assertEquals(opus.provider, "anthropic");
    assertEquals(findVeryfrontCloudModel("sonnet")?.provider, "anthropic");
    assertEquals(opus.modelId, "anthropic/claude-opus-4-8");
    assertEquals(findVeryfrontCloudModel("gpt-5.5")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gpt-5.4-mini")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gpt-5.4")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gpt-5.4-nano")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gpt-5.2")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gemini-3.1-pro-preview")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("gemini-3.5-flash")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("gemini-2.5-pro")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("gemini-2.5-flash")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("mistral-large-2512")?.provider, "mistral");
    assertEquals(findVeryfrontCloudModel("kimi-k2.6")?.provider, "moonshotai");
    assertEquals(findVeryfrontCloudModel("kimi-k2.5")?.provider, "moonshotai");
    assertEquals(findVeryfrontCloudModel("nonexistent"), undefined);
  });

  it("derives every default-model representation from one catalog entry", () => {
    assertEquals(DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL.id, DEFAULT_VERYFRONT_CLOUD_MODEL_ID);
    assertEquals(
      DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
      DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL.modelId,
    );
    assertEquals(
      DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID,
      `veryfront-cloud/${DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID}`,
    );
  });

  it("extracts providers from direct and hosted model ids", () => {
    assertEquals(getVeryfrontCloudProviderFromModelId("anthropic/claude-opus-4-8"), "anthropic");
    assertEquals(getVeryfrontCloudProviderFromModelId("veryfront-cloud/openai/gpt-5.5"), "openai");
    assertEquals(getVeryfrontCloudProviderFromModelId("google/gemini-3.5-flash"), "google");
    assertEquals(
      getVeryfrontCloudProviderFromModelId("google-ai-studio/gemini-3.1-pro-preview"),
      "google",
    );
    assertEquals(getVeryfrontCloudProviderFromModelId("mistral/mistral-large-2512"), "mistral");
    assertEquals(getVeryfrontCloudProviderFromModelId("moonshotai/kimi-k2.6"), "moonshotai");
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("unknown/model"),
      Error,
      'Unknown model provider prefix "unknown"',
    );
  });

  it("keeps the exported catalog immutable", () => {
    const originalFirstModelId = VERYFRONT_CLOUD_CHAT_MODELS[0]?.id;
    assertThrows(
      () =>
        (VERYFRONT_CLOUD_CHAT_MODELS as unknown as Array<{ id: string }>).push({
          id: "injected",
        }),
      TypeError,
    );
    assertThrows(
      () => {
        (VERYFRONT_CLOUD_CHAT_MODELS[0] as { id: string }).id = "corrupted";
      },
      TypeError,
    );

    assertEquals(VERYFRONT_CLOUD_CHAT_MODELS[0]?.id, originalFirstModelId);
    assertEquals(findVeryfrontCloudModel("injected"), undefined);
  });

  it("returns undefined for unknown provider prefixes in the try helper", () => {
    assertEquals(
      tryGetVeryfrontCloudProviderFromModelId("veryfront-cloud/anthropic/claude-opus-4-8"),
      "anthropic",
    );
    assertEquals(tryGetVeryfrontCloudProviderFromModelId("unknown/model"), undefined);
  });

  it("finds catalog entries for direct and hosted model ids", () => {
    assertEquals(findVeryfrontCloudModelByModelId("anthropic/claude-opus-4-8")?.id, "opus");
    assertEquals(
      findVeryfrontCloudModelByModelId("veryfront-cloud/anthropic/claude-opus-4-8")
        ?.thinkingBudgetTokens,
      2048,
    );
  });

  it("groups models by provider in a stable order", () => {
    const groups = groupVeryfrontCloudModelsByProvider();
    assertEquals(groups.map((group) => group.provider), [
      "anthropic",
      "openai",
      "google",
      "mistral",
      "moonshotai",
    ]);
    assertEquals(groups[0]?.label, "Anthropic");
    assertEquals(groups[1]?.label, "OpenAI");
    for (const group of groups) {
      assertEquals(group.models.every((model) => model.provider === group.provider), true);
    }
  });

  it("resolves aliases and preserves direct model ids", () => {
    assertEquals(resolveVeryfrontCloudModelId("opus"), "anthropic/claude-opus-4-8");
    assertEquals(resolveVeryfrontCloudModelId(), "openai/gpt-5.4-nano");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.5"), "openai/gpt-5.5");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.4-mini"), "openai/gpt-5.4-mini");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.4"), "openai/gpt-5.4");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.4-nano"), "openai/gpt-5.4-nano");
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.2"), "openai/gpt-5.2");
    assertEquals(resolveVeryfrontCloudModelId("mistral-large-2512"), "mistral/mistral-large-2512");
    assertEquals(resolveVeryfrontCloudModelId("openai/gpt-5.5"), "openai/gpt-5.5");
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
      "openai/gpt-5.4-nano",
      "openai/gpt-5.2",
      "google-ai-studio/gemini-3.1-pro-preview",
      "google-ai-studio/gemini-2.5-pro",
      "moonshotai/kimi-k2.6",
      "moonshotai/kimi-k2.5",
    ];

    for (const modelId of thinkingModelIds) {
      assertEquals(resolveVeryfrontCloudModelThinking(modelId)?.enabled, true);
    }

    assertEquals(
      resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6")?.budgetTokens,
      2048,
    );
    assertEquals(
      resolveVeryfrontCloudModelThinking("anthropic/claude-haiku-4-5-20251001")?.budgetTokens,
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
    assertEquals(resolveVeryfrontCloudModelThinking("mistral/mistral-large-2512"), undefined);
    for (const model of VERYFRONT_CLOUD_CHAT_MODELS) {
      if (model.thinkingBudgetTokens !== undefined) {
        assertEquals(Number.isSafeInteger(model.thinkingBudgetTokens), true);
        assertEquals(model.thinkingBudgetTokens > 0, true);
      }
    }
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
      assertEquals(resolveVeryfrontCloudOpenAITransport(modelId), "chat-completions");
    }

    assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.2"), undefined);
    assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.4-mini"), undefined);
    assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.4-nano"), undefined);
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
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("openai/gpt-5.4-nano"),
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
          resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-sonnet-4-6", {
            enabled: true,
            budgetTokens,
          }),
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
      resolveVeryfrontCloudGatewayModelId("mistral/mistral-large-2512"),
      "veryfront-cloud/mistral/mistral-large-2512",
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
    assertEquals(resolveVeryfrontCloudGatewayModelId("opus"), "opus");
    assertEquals(resolveVeryfrontCloudGatewayModelId(undefined), undefined);
    assertEquals(
      resolveHostedVeryfrontCloudModelId("openai/gpt-5.5"),
      "veryfront-cloud/openai/gpt-5.5",
    );
    assertEquals(
      resolveHostedVeryfrontCloudModelId("mistral/mistral-large-2512"),
      "veryfront-cloud/mistral/mistral-large-2512",
    );
  });

  it("maps enabled Anthropic thinking into provider options", () => {
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("veryfront-cloud/anthropic/claude-sonnet-4-6", {
        enabled: true,
        budgetTokens: 2048,
      }),
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
      resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-opus-4-8", {
        enabled: true,
        budgetTokens: 2048,
      }),
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
        "anthropic/claude-opus-4-7",
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
      resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-sonnet-4-6", {
        enabled: false,
      }),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("anthropic/claude-sonnet-4-6", {
        enabled: true,
      }),
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
