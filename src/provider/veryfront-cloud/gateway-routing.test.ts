/**
 * Golden record of Veryfront Cloud gateway routing.
 *
 * Every assertion here is a pure resolution: no environment, no transport. The
 * routes these tables describe are exercised in provider.test.ts.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  seedServedCatalogForTests,
  SERVED_MODEL_ROWS,
  UNSERVED_MODEL_ROWS,
} from "./catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "./catalog-client.ts";
import { resolveGenAiProviderName } from "#veryfront/agent/hosted/trace-attributes.ts";
import { getProviderToolProfile } from "#veryfront/agent/runtime/provider-tool-compat.ts";
import {
  requireVeryfrontCloudWireSurface,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "./model-catalog.ts";
import {
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  resolveVeryfrontCloudGatewayRoute,
} from "./shared.ts";

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
  beforeEach(seedServedCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);
  it("keeps the routing facts of every catalog model", () => {
    assertEquals(
      [...SERVED_MODEL_ROWS, ...UNSERVED_MODEL_ROWS].map((model) => routingRow(model.modelId)),
      [
        {
          model: "anthropic/claude-opus-4-8",
          provider: "anthropic",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "anthropic",
          toolProfile: "anthropic",
        },
        {
          model: "anthropic/claude-opus-4-6",
          provider: "anthropic",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "anthropic",
          toolProfile: "anthropic",
        },
        {
          model: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "anthropic",
          toolProfile: "anthropic",
        },
        {
          model: "anthropic/claude-haiku-4-5-20251001",
          provider: "anthropic",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "anthropic",
          toolProfile: "anthropic",
        },
        {
          model: "openai/gpt-5.5",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "openai/gpt-6-sol",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "openai/gpt-6-luna",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "openai/gpt-5.4-mini",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "openai/gpt-5.4",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "openai/gpt-5-nano",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
        {
          model: "google-ai-studio/gemini-3.5-flash",
          provider: "google",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1beta",
          genAiSystem: "gcp.gen_ai",
          toolProfile: "google",
        },
        {
          model: "google-ai-studio/gemini-2.5-pro",
          provider: "google",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1beta",
          genAiSystem: "gcp.gen_ai",
          toolProfile: "google",
        },
        {
          model: "google-ai-studio/gemini-2.5-flash",
          provider: "google",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1beta",
          genAiSystem: "gcp.gen_ai",
          toolProfile: "google",
        },
        {
          model: "mistral/mistral-small-2503",
          provider: "mistral",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: null,
          toolProfile: "unknown",
        },
        {
          model: "moonshotai/kimi-k2.6",
          provider: "moonshotai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "moonshotai",
          toolProfile: "moonshot",
        },
        {
          model: "moonshotai/kimi-k2.5",
          provider: "moonshotai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "moonshotai",
          toolProfile: "moonshot",
        },
        {
          model: "openai/gpt-5.2",
          provider: "openai",
          gatewayBaseUrl: "https://api.veryfront.com/ai/v1",
          genAiSystem: "openai",
          toolProfile: "openai",
        },
      ],
    );
  });

  it("keeps the gateway base URL of every accepted provider alias", () => {
    // Mistral is the one provider whose model IDs are gated by the catalog, so
    // the alias is exercised with a listed model rather than a placeholder.
    const aliases: ReadonlyArray<readonly [string, string]> = [
      ["anthropic", "model-x"],
      ["openai", "model-x"],
      ["google", "model-x"],
      ["google-ai-studio", "model-x"],
      ["mistral", "mistral-small-2503"],
      ["moonshotai", "model-x"],
    ];

    assertEquals(
      aliases.map(([alias, modelId]) => {
        const { provider } = parseVeryfrontCloudModelId(`${alias}/${modelId}`, "language");
        return [alias, getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, provider)];
      }),
      [
        ["anthropic", "https://api.veryfront.com/ai/v1"],
        ["openai", "https://api.veryfront.com/ai/v1"],
        ["google", "https://api.veryfront.com/ai/v1beta"],
        ["google-ai-studio", "https://api.veryfront.com/ai/v1beta"],
        ["mistral", "https://api.veryfront.com/ai/v1"],
        ["moonshotai", "https://api.veryfront.com/ai/v1"],
      ],
    );
  });

  it("names the provider for the body only on a body-addressed vendor-neutral route", () => {
    assertEquals(
      ["anthropic", "openai", "google", "mistral", "moonshotai", "acme-labs"].map((provider) =>
        resolveVeryfrontCloudGatewayRoute(API_BASE_URL, provider)
      ),
      [
        {
          baseURL: "https://api.veryfront.com/ai/v1",
          neutral: true,
          wireModelProvider: "anthropic",
        },
        { baseURL: "https://api.veryfront.com/ai/v1", neutral: true, wireModelProvider: "openai" },
        // Gemini names the model in the URL, so no body model is rewritten.
        { baseURL: "https://api.veryfront.com/ai/v1beta", neutral: true },
        { baseURL: "https://api.veryfront.com/ai/v1", neutral: true, wireModelProvider: "mistral" },
        {
          baseURL: "https://api.veryfront.com/ai/v1",
          neutral: true,
          wireModelProvider: "moonshotai",
        },
        {
          baseURL: "https://api.veryfront.com/ai/v1",
          neutral: true,
          wireModelProvider: "acme-labs",
        },
      ],
    );
  });

  it("keeps an API base path in front of the vendor-neutral path", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl("https://gateway.example/api/", "anthropic"),
      "https://gateway.example/api/ai/v1",
    );
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl("https://gateway.example/api", "openai"),
      "https://gateway.example/api/ai/v1",
    );
  });

  it("degrades for an unlisted provider instead of throwing", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, "acme-labs"),
      "https://api.veryfront.com/ai/v1",
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
