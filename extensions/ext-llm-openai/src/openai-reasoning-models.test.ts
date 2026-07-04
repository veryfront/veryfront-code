import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDefaultOpenAIReasoningEffort,
  rejectsOpenAISamplingParams,
  shouldRequestOpenAIReasoningSummary,
} from "./openai-reasoning-models.ts";

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

  it("requests reasoning summaries only for explicit reasoning or Veryfront Cloud", () => {
    assertEquals(
      shouldRequestOpenAIReasoningSummary("openai", { effort: "medium", source: "default" }),
      false,
    );
    assertEquals(
      shouldRequestOpenAIReasoningSummary("openai", { effort: "high", source: "explicit" }),
      true,
    );
    assertEquals(
      shouldRequestOpenAIReasoningSummary("veryfront-cloud", {
        effort: "medium",
        source: "default",
      }),
      true,
    );
    assertEquals(
      shouldRequestOpenAIReasoningSummary("azure", { effort: "medium", source: "default" }),
      false,
    );
  });

  it("detects models that reject sampling params separately from default reasoning params", () => {
    const cases: Array<[string, boolean]> = [
      ["gpt-5", true],
      ["gpt-5-mini", true],
      ["gpt-5.4-nano", true],
      ["gpt-5.5", true],
      ["gpt-5.1", false],
      ["gpt-5-chat-latest", false],
      ["o1", true],
      ["o1-2024-12-17", true],
      ["o1-mini", true],
      ["o1-preview", true],
      ["o1-pro", true],
      ["o3-mini", true],
      ["o4-mini", true],
      ["gpt-4o-mini", false],
    ];

    for (const [modelId, expected] of cases) {
      assertEquals(rejectsOpenAISamplingParams(modelId), expected, modelId);
    }
  });
});
