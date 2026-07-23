import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findVeryfrontCloudModel,
  findVeryfrontCloudModelByModelId,
  getVeryfrontCloudProviderFromModelId,
  groupVeryfrontCloudModelsByProvider,
  resolveHostedVeryfrontCloudModelId,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudThinkingProviderOptions,
  tryGetVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "./model-catalog.ts";

describe("provider/veryfront-cloud/model-catalog", () => {
  it("keeps the exported model catalog immutable", () => {
    assertEquals(Object.isFrozen(VERYFRONT_CLOUD_CHAT_MODELS), true);
    assertEquals(VERYFRONT_CLOUD_CHAT_MODELS.every(Object.isFrozen), true);
  });

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

  it("extracts providers from direct and hosted model ids", () => {
    assertEquals(getVeryfrontCloudProviderFromModelId("anthropic/claude-opus-4-8"), "anthropic");
    assertEquals(getVeryfrontCloudProviderFromModelId("veryfront-cloud/openai/gpt-5.5"), "openai");
    assertEquals(
      getVeryfrontCloudProviderFromModelId("google-ai-studio/gemini-3.1-pro-preview"),
      "google",
    );
    assertEquals(getVeryfrontCloudProviderFromModelId("mistral/mistral-large-2512"), "mistral");
    assertEquals(getVeryfrontCloudProviderFromModelId("moonshotai/kimi-k2.6"), "moonshotai");
    assertThrows(
      () => getVeryfrontCloudProviderFromModelId("unknown/model"),
      Error,
      "unknown provider prefix",
    );
  });

  it("returns undefined for unknown provider prefixes in the try helper", () => {
    assertEquals(
      tryGetVeryfrontCloudProviderFromModelId("veryfront-cloud/anthropic/claude-opus-4-8"),
      "anthropic",
    );
    assertEquals(tryGetVeryfrontCloudProviderFromModelId("unknown/model"), undefined);
    assertEquals(tryGetVeryfrontCloudProviderFromModelId("openai/model\nprivate"), undefined);
  });

  it("finds catalog entries for direct and hosted model ids", () => {
    assertEquals(findVeryfrontCloudModelByModelId("anthropic/claude-opus-4-8")?.id, "opus");
    assertEquals(
      findVeryfrontCloudModelByModelId("veryfront-cloud/anthropic/claude-opus-4-8")
        ?.thinkingBudgetTokens,
      2048,
    );
    assertThrows(
      () => findVeryfrontCloudModelByModelId("veryfront-cloud/"),
      Error,
      "model ID is invalid",
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
      "Mistral model is not supported",
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId("mistral/mistral-medium-3-5"),
      Error,
      "Mistral model is not supported",
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId("not-a-real-model"),
      Error,
      "model alias is unknown",
    );
    assertThrows(
      () => resolveVeryfrontCloudModelId(null as unknown as string),
      Error,
      "model ID is invalid",
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
    assertThrows(
      () => resolveVeryfrontCloudGatewayModelId(""),
      Error,
      "model ID is invalid",
    );
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
