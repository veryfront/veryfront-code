import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeModelCapabilityId, supportsTemperatureParameter } from "./model-capabilities.ts";

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
    assertEquals(
      supportsTemperatureParameter("veryfront-cloud/anthropic/claude-opus-4-8"),
      false,
    );
  });

  it("keeps temperature for other current hosted models", () => {
    assertEquals(supportsTemperatureParameter("anthropic/claude-opus-4-6"), true);
    assertEquals(supportsTemperatureParameter("anthropic/claude-sonnet-4-6"), true);
    assertEquals(supportsTemperatureParameter("anthropic/claude-haiku-4-5-20251001"), true);
    assertEquals(supportsTemperatureParameter("openai/gpt-5.5"), true);
    assertEquals(supportsTemperatureParameter("google-ai-studio/gemini-3.1-pro-preview"), true);
    assertEquals(supportsTemperatureParameter(undefined), true);
  });
});
