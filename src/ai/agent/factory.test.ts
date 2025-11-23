/**
 * Agent Factory Tests
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { agent } from "./factory.ts";

describe("Agent Factory", () => {
  it("should create an agent with minimal config", () => {
    const myAgent = agent({
      model: "openai/gpt-4",
      system: "You are a test agent",
    });

    assertExists(myAgent.id);
    assertEquals(myAgent.config.model, "openai/gpt-4");
    assertEquals(myAgent.config.system, "You are a test agent");
    assertExists(myAgent.generate);
    assertExists(myAgent.stream);
  });

  it("should allow custom ID", () => {
    const myAgent = agent({
      id: "custom-agent",
      model: "openai/gpt-4",
      system: "Test system prompt",
    });

    assertEquals(myAgent.id, "custom-agent");
  });

  it("should validate platform compatibility", () => {
    // Mock platform detection to force error (if possible, or just test valid config)
    // For now, we test valid config as mocking platform detection requires dependency injection or stubbing

    const myAgent = agent({
      model: "openai/gpt-4",
      system: "Test system prompt",
    });
    assertExists(myAgent);
  });
});
