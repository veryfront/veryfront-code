/**
 * Golden record of Veryfront Cloud gateway routing.
 *
 * Every assertion here is a pure resolution: no environment, no transport. The
 * routes these tables describe are exercised end to end in provider.test.ts.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveGenAiProviderName } from "#veryfront/agent/hosted/trace-attributes.ts";
import { getProviderToolProfile } from "#veryfront/agent/runtime/provider-tool-compat.ts";
import {
  requireVeryfrontCloudWireSurface,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "./model-catalog.ts";
import { getVeryfrontCloudGatewayBaseUrl, parseVeryfrontCloudModelId } from "./shared.ts";

const API_BASE_URL = "https://api.veryfront.com";

/** Routing facts one catalog model resolves to today. */
type RoutingRow = {
  readonly model: string;
  readonly provider: string;
  readonly gatewayBaseUrl: string;
  readonly genAiSystem: string | null;
  readonly toolProfile: string;
};

function routingRow(modelId: string): RoutingRow {
  const { provider } = parseVeryfrontCloudModelId(modelId, "language");
  return {
    model: modelId,
    provider,
    gatewayBaseUrl: getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, provider),
    genAiSystem: resolveGenAiProviderName(modelId),
    toolProfile: getProviderToolProfile(`veryfront-cloud/${modelId}`).provider,
  };
}

describe("provider/veryfront-cloud gateway routing", () => {
  it("keeps the routing facts of every catalog model", () => {
    assertEquals(VERYFRONT_CLOUD_CHAT_MODELS.map((model) => routingRow(model.modelId)), [
      {
        model: "anthropic/claude-opus-4-8",
        provider: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-opus-4-6",
        provider: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-haiku-4-5-20251001",
        provider: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "openai/gpt-5.5",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4-mini",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4-nano",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.2",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "google-ai-studio/gemini-3.1-pro-preview",
        provider: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-3.5-flash",
        provider: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-2.5-pro",
        provider: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-2.5-flash",
        provider: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "mistral/mistral-large-2512",
        provider: "mistral",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/mistral/v1",
        genAiSystem: null,
        toolProfile: "unknown",
      },
      {
        model: "mistral/mistral-small-2503",
        provider: "mistral",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/mistral/v1",
        genAiSystem: null,
        toolProfile: "unknown",
      },
      {
        model: "moonshotai/kimi-k2.6",
        provider: "moonshotai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/moonshotai/v1",
        genAiSystem: "moonshotai",
        toolProfile: "moonshot",
      },
      {
        model: "moonshotai/kimi-k2.5",
        provider: "moonshotai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/moonshotai/v1",
        genAiSystem: "moonshotai",
        toolProfile: "moonshot",
      },
      {
        model: "openai/gpt-5-nano",
        provider: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "deepseek/deepseek-v4-flash",
        provider: "deepseek",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/deepseek/v1",
        genAiSystem: null,
        toolProfile: "unknown",
      },
    ]);
  });

  it("keeps the gateway base URL of every accepted provider alias", () => {
    // Mistral is the one provider whose model IDs are gated by the catalog, so
    // the alias is exercised with a listed model rather than a placeholder.
    const aliases: ReadonlyArray<readonly [string, string]> = [
      ["anthropic", "model-x"],
      ["openai", "model-x"],
      ["google", "model-x"],
      ["google-ai-studio", "model-x"],
      ["mistral", "mistral-large-2512"],
      ["moonshotai", "model-x"],
    ];

    assertEquals(
      aliases.map(([alias, modelId]) => {
        const { provider } = parseVeryfrontCloudModelId(`${alias}/${modelId}`, "language");
        return [alias, getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, provider)];
      }),
      [
        ["anthropic", "https://api.veryfront.com/ai/gateway/anthropic/v1"],
        ["openai", "https://api.veryfront.com/ai/gateway/openai/v1"],
        ["google", "https://api.veryfront.com/ai/gateway/google/v1beta"],
        ["google-ai-studio", "https://api.veryfront.com/ai/gateway/google/v1beta"],
        ["mistral", "https://api.veryfront.com/ai/gateway/mistral/v1"],
        ["moonshotai", "https://api.veryfront.com/ai/gateway/moonshotai/v1"],
      ],
    );
  });

  it("degrades for an unlisted provider instead of throwing", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, "acme-labs"),
      "https://api.veryfront.com/ai/gateway/acme-labs/v1",
    );
    assertEquals(resolveGenAiProviderName("acme-labs/mystery-1"), null);
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/mystery-1").provider, "unknown");
  });

  it("ignores capabilities it has no entry for instead of throwing", () => {
    assertEquals(resolveVeryfrontCloudOpenAITransport("acme-labs/mystery-1"), undefined);
    assertEquals(
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("acme-labs/mystery-1"),
      undefined,
    );
    assertEquals(resolveVeryfrontCloudModelThinking("acme-labs/mystery-1"), undefined);
    assertEquals(
      resolveVeryfrontCloudThinkingProviderOptions("acme-labs/mystery-1", { enabled: true }),
      undefined,
    );
    assertEquals(
      resolveVeryfrontCloudReasoningOption("acme-labs/mystery-1", {
        enabled: true,
        effort: "high",
      }),
      { enabled: true, effort: "high" },
    );
  });

  it("names the surface when the package builds no request for it", () => {
    assertEquals(requireVeryfrontCloudWireSurface("openai"), "openai");
    assertThrows(
      () => requireVeryfrontCloudWireSurface("a-later-wire-format"),
      Error,
      'Veryfront Cloud wire surface "a-later-wire-format" is not supported',
    );
  });
});
