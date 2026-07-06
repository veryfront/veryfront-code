import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModelMaxOutputTokens } from "./constants.ts";

describe("getModelMaxOutputTokens", () => {
  it("returns known limit for Anthropic Opus", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-opus-4-8"), 128_000);
  });

  it("returns known limit for Anthropic Sonnet", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-sonnet-4-6"), 64_000);
  });

  it("strips veryfront-cloud/ prefix before matching", () => {
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/anthropic/claude-opus-4-8"), 128_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.5"), 128_000);
  });

  it("uses Gemini limits for direct Google runtime model ids", () => {
    assertEquals(getModelMaxOutputTokens("google/gemini-3.1-pro-preview"), 65_536);
    assertEquals(getModelMaxOutputTokens("google/gemini-3.5-flash"), 65_536);
  });

  it("returns known limits for Mistral models", () => {
    assertEquals(getModelMaxOutputTokens("mistral/mistral-large-2512"), 1_024);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/mistral/mistral-large-2512"), 1_024);
  });

  it("returns a large limit for Kimi thinking models so reasoning_content does not exhaust the budget", () => {
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.5"), 32_000);
  });

  it("returns undefined for unknown models", () => {
    assertEquals(getModelMaxOutputTokens("unknown/model"), undefined);
  });
});
