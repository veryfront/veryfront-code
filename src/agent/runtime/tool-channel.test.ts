import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getToolChannelProfile,
  resolveStepToolChoice,
  type ToolChannelStepInput,
} from "./tool-channel.ts";

function stepInput(overrides: Partial<ToolChannelStepInput> = {}): ToolChannelStepInput {
  return { step: 0, hasTools: true, madeToolCall: false, hasOutputSchema: false, ...overrides };
}

describe("getToolChannelProfile", () => {
  it("forces the tool channel for Mistral models", () => {
    const profile = getToolChannelProfile("mistral/mistral-small-2503");
    assertEquals(profile.forceByDefault, true);
    assertEquals(profile.toolChoiceValue, "any");
  });

  it("reads the upstream provider through a Veryfront Cloud prefix", () => {
    assertEquals(
      getToolChannelProfile("veryfront-cloud/mistral/mistral-large-2512").forceByDefault,
      true,
    );
  });

  it("leaves models that hold the channel on the provider default", () => {
    for (
      const model of [
        "anthropic/claude-haiku-4-5-20251001",
        "openai/gpt-5-nano",
        "google-ai-studio/gemini-3.5-flash",
      ]
    ) {
      const profile = getToolChannelProfile(model);
      assertEquals(profile.forceByDefault, false, model);
    }
  });

  it("leaves an unlisted provider on the provider default", () => {
    assertEquals(getToolChannelProfile("deepseek/deepseek-v3").forceByDefault, false);
  });
});

describe("resolveStepToolChoice", () => {
  const mistral = getToolChannelProfile("mistral/mistral-small-2503");
  const anthropic = getToolChannelProfile("anthropic/claude-haiku-4-5-20251001");

  it("forces the channel on the opening step of a run with tools", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput()), "any");
  });

  it("keeps forcing until the model makes its first tool call", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ step: 2 })), "any");
  });

  it("releases the channel once the model has made a tool call", () => {
    assertEquals(
      resolveStepToolChoice(mistral, stepInput({ step: 2, madeToolCall: true })),
      undefined,
    );
  });

  it("leaves a step that sends no tools alone", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ hasTools: false })), undefined);
  });

  it("yields to a requested response schema", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ hasOutputSchema: true })), undefined);
  });

  it("never forces a model that holds the channel", () => {
    assertEquals(resolveStepToolChoice(anthropic, stepInput()), undefined);
  });

  it("restores the previous behavior in off mode", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput(), "off"), undefined);
  });

  it("limits forcing to the opening step in force-first-step mode", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput(), "force-first-step"), "any");
    assertEquals(
      resolveStepToolChoice(mistral, stepInput({ step: 1 }), "force-first-step"),
      undefined,
    );
  });

  it("forces a model that holds the channel only when an operator asks", () => {
    assertEquals(resolveStepToolChoice(anthropic, stepInput(), "force-first-step"), "any");
  });

  it("sends the tool_choice value each provider accepts", () => {
    const openai = getToolChannelProfile("openai/gpt-5-nano");
    assertEquals(resolveStepToolChoice(openai, stepInput(), "force-first-step"), "required");
  });
});
