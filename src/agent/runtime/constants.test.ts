import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModelMaxOutputTokens } from "./constants.ts";

describe("getModelMaxOutputTokens", () => {
  it("returns known limit for Anthropic Opus", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-opus-4-6"), 32_768);
  });

  it("returns known limit for Anthropic Sonnet", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-sonnet-4-6"), 16_384);
  });

  it("strips veryfront-cloud/ prefix before matching", () => {
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/anthropic/claude-opus-4-6"), 32_768);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.2"), 16_384);
  });

  it("returns undefined for unknown models", () => {
    assertEquals(getModelMaxOutputTokens("unknown/model"), undefined);
  });
});
