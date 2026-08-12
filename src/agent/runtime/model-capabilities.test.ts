import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getFixedTemperatureParameter,
  normalizeModelCapabilityId,
  resolveTemperatureParameter,
  supportsTemperatureParameter,
} from "./model-capabilities.ts";

describe("runtime model capabilities", () => {
  it("normalizes Veryfront Cloud model aliases", () => {
    assertEquals(
      normalizeModelCapabilityId("veryfront-cloud/anthropic/claude-opus-4-8"),
      "anthropic/claude-opus-4-8",
    );
    assertEquals(
      normalizeModelCapabilityId("anthropic/claude-opus-4-8"),
      "anthropic/claude-opus-4-8",
    );
  });

  it("omits temperature for Anthropic Opus models that reject sampling parameters", () => {
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-4-7"), false);
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-4-8"), false);
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-5"), false);
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-5-20260801"), false);
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-5.1"), false);
    assertEquals(
      supportsTemperatureParameter("veryfront-cloud/anthropic/claude-opus-4-8"),
      false,
    );
    assertEquals(
      supportsTemperatureParameter("veryfront-cloud/anthropic/claude-opus-5"),
      false,
    );
  });

  it("applies the temperature policy to the full current model matrix", () => {
    const temperatureMatrix = [
      ["anthropic/claude-opus-4-8", undefined],
      ["anthropic/claude-opus-4-6", 0.2],
      ["anthropic/claude-sonnet-4-6", 0.2],
      ["anthropic/claude-haiku-4-5-20251001", 0.2],
      ["openai/gpt-5.5", 0.2],
      ["openai/gpt-5.4-mini", 0.2],
      ["openai/gpt-5.4", 0.2],
      ["openai/gpt-5.4-nano", 0.2],
      ["openai/gpt-5.2", 0.2],
      ["google-ai-studio/gemini-3.1-pro-preview", 0.2],
      ["google-ai-studio/gemini-3.5-flash", 0.2],
      ["google-ai-studio/gemini-2.5-pro", 0.2],
      ["google-ai-studio/gemini-2.5-flash", 0.2],
      ["mistral/mistral-large-2512", 0.2],
      ["moonshotai/kimi-k2.6", 1],
      ["moonshotai/kimi-k2.5", 0.2],
    ] as const;

    for (const [modelId, expectedTemperature] of temperatureMatrix) {
      assertEquals(resolveTemperatureParameter(modelId, 0.2, 0), expectedTemperature, modelId);
      assertEquals(
        resolveTemperatureParameter(`veryfront-cloud/${modelId}`, 0.2, 0),
        expectedTemperature,
        `hosted ${modelId}`,
      );
    }
  });

  it("keeps temperature for other current hosted models", () => {
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-4-6"), true);
    assertEquals(supportsTemperatureParameter("anthropic/claude-sonnet-4-6"), true);
    assertEquals(supportsTemperatureParameter("anthropic/claude-haiku-4-5-20251001"), true);
    assertEquals(supportsTemperatureParameter("openai/gpt-5.5"), true);
    assertEquals(supportsTemperatureParameter("google-ai-studio/gemini-3.1-pro-preview"), true);
    assertEquals(supportsTemperatureParameter(undefined), true);
  });

  it("uses fixed temperature for Kimi 2.6 thinking requests", () => {
    assertEquals(getFixedTemperatureParameter("moonshotai/kimi-k2.6"), 1);
    assertEquals(getFixedTemperatureParameter("veryfront-cloud/moonshotai/kimi-k2.6"), 1);
    assertEquals(
      resolveTemperatureParameter("moonshotai/kimi-k2.6", 0, 0),
      1,
    );
    assertEquals(
      resolveTemperatureParameter("veryfront-cloud/moonshotai/kimi-k2.6", undefined, 0),
      1,
    );
  });

  it("uses fixed temperature for Kimi 2.6 non-thinking requests", () => {
    const providerOptionShapes = [
      { thinking: { type: "disabled" } },
      { moonshotai: { thinking: { type: "disabled" } } },
      { moonshotai: { extraBody: { thinking: { type: "disabled" } } } },
      { openai: { thinking: { type: "disabled" } } },
      { openai: { extraBody: { thinking: { type: "disabled" } } } },
      { openai: { extra_body: { thinking: { type: "disabled" } } } },
    ];

    for (const providerOptions of providerOptionShapes) {
      assertEquals(
        getFixedTemperatureParameter("moonshotai/kimi-k2.6", providerOptions),
        0.6,
      );
      assertEquals(
        resolveTemperatureParameter(
          "veryfront-cloud/moonshotai/kimi-k2.6",
          0,
          0,
          providerOptions,
        ),
        0.6,
      );
    }
  });

  it("resolves temperature from model-specific capabilities", () => {
    assertEquals(resolveTemperatureParameter("anthropic/claude-opus-4-8", 0, 0), undefined);
    assertEquals(resolveTemperatureParameter("anthropic/claude-sonnet-4-6", 0.2, 0), 0.2);
    assertEquals(resolveTemperatureParameter("anthropic/claude-sonnet-4-6", undefined, 0), 0);
    assertEquals(resolveTemperatureParameter(undefined, undefined, 0), 0);
  });
});
