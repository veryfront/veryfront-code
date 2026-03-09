import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AUTO_AGENT_MODEL,
  normalizeAgentModelConfig,
  resolveConfiguredAgentModel,
} from "./model-resolution.ts";

describe("agent/runtime/model-resolution", () => {
  it("normalizes missing models to auto", () => {
    assertEquals(normalizeAgentModelConfig(), AUTO_AGENT_MODEL);
    assertEquals(normalizeAgentModelConfig("   "), AUTO_AGENT_MODEL);
  });

  it("preserves explicit provider models", () => {
    assertEquals(
      normalizeAgentModelConfig("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("resolves auto to the local default model string", () => {
    assertEquals(resolveConfiguredAgentModel(), "local/smollm2-135m");
    assertEquals(resolveConfiguredAgentModel("auto"), "local/smollm2-135m");
  });

  it("passes explicit models through unchanged", () => {
    assertEquals(
      resolveConfiguredAgentModel("openai/gpt-4o"),
      "openai/gpt-4o",
    );
  });
});
