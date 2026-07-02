import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDefaultOpenAIReasoningEffort } from "./openai-reasoning-models.ts";

describe("ext-llm-openai/openai-reasoning-models", () => {
  it("defaults known reasoning models while excluding chat snapshots and legacy o1 variants", () => {
    const cases: Array<[string, "medium" | undefined]> = [
      ["gpt-5", "medium"],
      ["gpt-5-mini", "medium"],
      ["gpt-5.4-nano", "medium"],
      ["gpt-5.5", "medium"],
      ["gpt-5.1", undefined],
      ["gpt-5-chat-latest", undefined],
      ["o1", "medium"],
      ["o1-2024-12-17", "medium"],
      ["o1-mini", undefined],
      ["o1-preview", undefined],
      ["o3-mini", "medium"],
      ["o4-mini", "medium"],
    ];

    for (const [modelId, expected] of cases) {
      assertEquals(getDefaultOpenAIReasoningEffort(modelId), expected, modelId);
    }
  });

  it("only enables default reasoning params for native OpenAI providers", () => {
    assertEquals(getDefaultOpenAIReasoningEffort("gpt-5.4-nano", "openai"), "medium");
    assertEquals(getDefaultOpenAIReasoningEffort("gpt-5.4-nano", "veryfront-cloud"), "medium");
    assertEquals(getDefaultOpenAIReasoningEffort("gpt-5.4-nano", "azure"), undefined);
    assertEquals(getDefaultOpenAIReasoningEffort("gpt-5.4-nano", "moonshot"), undefined);
  });
});
