import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERYFRONT_CLOUD_CHAT_MODELS } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { FALLBACK_MODEL_MAX_OUTPUT_TOKENS, getModelMaxOutputTokens } from "./constants.ts";

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
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2"), 32_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/moonshotai/kimi-k2"), 32_000);
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.5"), 32_000);
  });

  it("returns a large limit for the OpenAI GPT-5.4 thinking family (incl. the default agent model gpt-5.4-nano)", () => {
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4"), 128_000);
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4-mini"), 128_000);
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4-nano"), 128_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.4-nano"), 128_000);
  });

  it("returns the safe fallback limit for unknown models", () => {
    assertEquals(getModelMaxOutputTokens("unknown/model"), FALLBACK_MODEL_MAX_OUTPUT_TOKENS);
  });
});

describe("MODEL_MAX_OUTPUT_TOKENS covers the catalog", () => {
  // Every catalog model MUST have an explicit budget. A missing entry falls back
  // to FALLBACK_MODEL_MAX_OUTPUT_TOKENS (4_096), which truncates thinking models
  // before they emit any answer content (see veryfront-code#2791). This test
  // keeps the token table in sync with the catalog so a newly added model
  // cannot regress into that class of bug unnoticed.
  it("every catalog model has an explicit max-output-token budget (not just the fallback)", () => {
    const missing = VERYFRONT_CLOUD_CHAT_MODELS
      .filter((model) =>
        getModelMaxOutputTokens(model.modelId) === FALLBACK_MODEL_MAX_OUTPUT_TOKENS
      )
      .map((model) => model.modelId);
    assertEquals(missing, []);
  });

  it("every thinking model gets enough budget for reasoning plus an answer", () => {
    // Thinking models stream reasoning_content ahead of the answer; the budget
    // must comfortably exceed the reasoning burst. Non-thinking models are
    // exempt (e.g. mistral-large-2512 is intentionally quota-capped at 1_024).
    const FLOOR = 16_000;
    const tooLow = VERYFRONT_CLOUD_CHAT_MODELS
      .filter((model) => model.thinking && getModelMaxOutputTokens(model.modelId) < FLOOR)
      .map((model) => `${model.modelId}=${getModelMaxOutputTokens(model.modelId)}`);
    assertEquals(tooLow, []);
  });
});
