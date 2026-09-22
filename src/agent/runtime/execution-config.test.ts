import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAgentExecutionConfig, registerOmittedModelConfig } from "./execution-config.ts";

describe("agent execution config", () => {
  it("restores model omission while preserving other configuration", () => {
    const config = { model: "openai/gpt-5.4-nano", system: "Reply briefly." };
    registerOmittedModelConfig(config);
    assertEquals(getAgentExecutionConfig(config), { ...config, model: undefined });
    assertEquals(config.model, "openai/gpt-5.4-nano");
  });
  it("preserves an explicit selection of the former default", () => {
    const config = { model: "openai/gpt-5.4-nano" };
    assertStrictEquals(getAgentExecutionConfig(config), config);
  });
  it("preserves a model explicitly changed after construction", () => {
    const config = { model: "openai/gpt-5.4-nano" };
    registerOmittedModelConfig(config);
    config.model = "openai/gpt-5.4-mini";
    assertStrictEquals(getAgentExecutionConfig(config), config);
  });
});
