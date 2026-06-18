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
} from "./model-catalog.ts";

describe("provider/veryfront-cloud/model-catalog", () => {
  it("finds catalog models by alias", () => {
    const opus = findVeryfrontCloudModel("opus");
    assertExists(opus);
    assertEquals(opus.provider, "anthropic");
    assertEquals(findVeryfrontCloudModel("sonnet")?.provider, "anthropic");
    assertEquals(opus.modelId, "anthropic/claude-opus-4-8");
    assertEquals(findVeryfrontCloudModel("gpt-5.5")?.provider, "openai");
    assertEquals(findVeryfrontCloudModel("gemini-3.1-pro-preview")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("gemini-3.5-flash")?.provider, "google");
    assertEquals(findVeryfrontCloudModel("mistral-large-2512")?.provider, "mistral");
    assertEquals(findVeryfrontCloudModel("kimi-k2.6")?.provider, "moonshotai");
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
      'Unknown model provider prefix "unknown"',
    );
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
      undefined,
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
    assertEquals(resolveVeryfrontCloudModelId("gpt-5.5"), "openai/gpt-5.5");
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
    assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-opus-4-8"), undefined);
    assertEquals(
      resolveVeryfrontCloudModelThinking("veryfront-cloud/anthropic/claude-opus-4-8"),
      undefined,
    );
    assertEquals(resolveVeryfrontCloudModelThinking("openai/gpt-5.5"), undefined);
    assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6")?.enabled, true);
    assertEquals(
      resolveVeryfrontCloudModelThinking("anthropic/claude-haiku-4-5-20251001")?.enabled,
      true,
    );
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
