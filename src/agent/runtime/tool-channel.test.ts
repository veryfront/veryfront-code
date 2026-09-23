import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  forcesToolChannel,
  resolveStepToolChoice,
  type ToolChannelStepInput,
} from "./tool-channel.ts";

function stepInput(overrides: Partial<ToolChannelStepInput> = {}): ToolChannelStepInput {
  return { hasTools: true, madeToolCall: false, hasOutputSchema: false, ...overrides };
}

describe("forcesToolChannel", () => {
  it("forces the tool channel for Mistral models", () => {
    assertEquals(forcesToolChannel("mistral/mistral-small-2503"), true);
  });

  it("reads the upstream provider through a Veryfront Cloud prefix", () => {
    assertEquals(forcesToolChannel("veryfront-cloud/mistral/mistral-large-2512"), true);
  });

  it("leaves models that hold the channel on the provider default", () => {
    for (
      const model of [
        "anthropic/claude-haiku-4-5-20251001",
        "openai/gpt-5-nano",
        "google-ai-studio/gemini-3.5-flash",
        "deepseek/deepseek-v3",
      ]
    ) {
      assertEquals(forcesToolChannel(model), false, model);
    }
  });
});

describe("resolveStepToolChoice", () => {
  it("forces the channel on a step that sends tools", () => {
    assertEquals(resolveStepToolChoice(true, stepInput()), "any");
  });

  it("releases the channel once the model has made a tool call", () => {
    assertEquals(resolveStepToolChoice(true, stepInput({ madeToolCall: true })), undefined);
  });

  it("leaves a step that sends no tools alone", () => {
    assertEquals(resolveStepToolChoice(true, stepInput({ hasTools: false })), undefined);
  });

  it("yields to a requested response schema", () => {
    assertEquals(resolveStepToolChoice(true, stepInput({ hasOutputSchema: true })), undefined);
  });

  it("never forces a model that holds the channel", () => {
    assertEquals(resolveStepToolChoice(false, stepInput()), undefined);
  });
});
