/**
 * Step DSL Tests
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { agentStep, step, toolStep } from "./step.ts";
import type { StepNodeConfig } from "../types.ts";

describe("step()", () => {
  it("should create an agent step", () => {
    const node = step("research", {
      agent: "researcher",
      input: "Research AI safety",
    });

    assertEquals(node.id, "research");
    assertEquals(node.config.type, "step");

    const config = node.config as StepNodeConfig;
    assertEquals(config.agent, "researcher");
    assertEquals(config.input, "Research AI safety");
  });

  it("should create a tool step", () => {
    const node = step("fetch-data", {
      tool: "dataFetcher",
      input: { url: "https://api.example.com" },
    });

    assertEquals(node.id, "fetch-data");
    assertEquals(node.config.type, "step");

    const config = node.config as StepNodeConfig;
    assertEquals(config.tool, "dataFetcher");
    assertEquals(config.input, { url: "https://api.example.com" });
  });

  it("should default checkpoint to true for agent steps", () => {
    const agentNode = step("agent-step", { agent: "test-agent" });
    assertEquals(agentNode.config.checkpoint, true);
  });

  it("should default checkpoint to false for tool steps", () => {
    const toolNode = step("tool-step", { tool: "test-tool" });
    assertEquals(toolNode.config.checkpoint, false);
  });

  it("should allow explicit checkpoint setting", () => {
    const node = step("explicit", { agent: "test", checkpoint: false });
    assertEquals(node.config.checkpoint, false);
  });

  it("should include retry config", () => {
    const node = step("with-retry", {
      agent: "test",
      retry: { maxAttempts: 5, initialDelay: 1000 },
    });

    assertEquals(node.config.retry?.maxAttempts, 5);
    assertEquals(node.config.retry?.initialDelay, 1000);
  });

  it("should include timeout", () => {
    const node = step("with-timeout", {
      agent: "test",
      timeout: "5m",
    });

    assertEquals(node.config.timeout, "5m");
  });

  it("should support dynamic input function", () => {
    const node = step("dynamic", {
      agent: "test",
      input: (ctx) => ctx["previous"],
    });

    const config = node.config as StepNodeConfig;
    assertEquals(typeof config.input, "function");
  });
});

describe("agentStep()", () => {
  it("should be a convenience wrapper for agent steps", () => {
    const node = agentStep("research", "researcher", {
      input: "Research topic",
      timeout: "10m",
    });

    assertEquals(node.id, "research");
    const config = node.config as StepNodeConfig;
    assertEquals(config.agent, "researcher");
    assertEquals(config.input, "Research topic");
    assertEquals(config.timeout, "10m");
  });

  it("should work with just agent ID", () => {
    const node = agentStep("simple", "my-agent");

    assertEquals(node.id, "simple");
    const config = node.config as StepNodeConfig;
    assertEquals(config.agent, "my-agent");
  });
});

describe("toolStep()", () => {
  it("should be a convenience wrapper for tool steps", () => {
    const node = toolStep("fetch", "dataFetcher", {
      input: { url: "https://example.com" },
    });

    assertEquals(node.id, "fetch");
    const config = node.config as StepNodeConfig;
    assertEquals(config.tool, "dataFetcher");
    assertEquals(config.input, { url: "https://example.com" });
  });
});
