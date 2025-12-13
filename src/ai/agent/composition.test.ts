import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import {
  agentAsTool,
  createWorkflow,
  agentRegistry,
  registerAgent,
  getAgent,
  getAllAgentIds,
  getAgentsAsTools,
  AgentRegistryClass,
} from "./composition.ts";
import type { Agent } from "../types/agent.ts";
import { z } from "zod";

describe("agent composition", () => {
  // Clean registry before each test
  const beforeEach = () => {
    agentRegistry.clear();
  };

  describe("agentAsTool", () => {
    beforeEach();

    it("should convert agent to tool", async () => {
      const mockAgent = {
        id: "test-agent",
        generate: async ({ input }) => ({
          text: `Response to: ${input}`,
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const tool = agentAsTool(mockAgent, "Test agent tool");

      assertEquals(tool.id, "agent_test-agent");
      assertEquals(tool.description, "Test agent tool");
      assertExists(tool.inputSchema);
      assertExists(tool.execute);

      const result = await tool.execute({ input: "hello" });
      assertEquals(result.text, "Response to: hello");
      assertEquals(result.status, "completed");
    });

    it("should include tool call count in result", async () => {
      const mockAgent = {
        id: "agent-with-tools",
        generate: async () => ({
          text: "Response",
          messages: [],
          toolCalls: [
            { id: "1", name: "tool1", args: {}, status: "completed" },
            { id: "2", name: "tool2", args: {}, status: "completed" },
          ],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const tool = agentAsTool(mockAgent, "Agent with tools");
      const result = await tool.execute({ input: "test" });

      assertEquals(result.toolCalls, 2);
    });
  });

  describe("createWorkflow", () => {
    it("should execute workflow steps in sequence", async () => {
      const step1Agent = {
        id: "step1",
        generate: async ({ input }) => ({
          text: `Step1: ${input}`,
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      };

      const step2Agent = {
        id: "step2",
        generate: async ({ input }) => ({
          text: `Step2: ${input}`,
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const workflow = createWorkflow({
        steps: [
          { agent: step1Agent, name: "first" },
          { agent: step2Agent, name: "second" },
        ],
      });

      const result = await workflow.execute("input");

      assertEquals(result.steps.length, 2);
      assertEquals(result.steps[0].name, "first");
      assertEquals(result.steps[0].output, "Step1: input");
      assertEquals(result.steps[1].name, "second");
      assertEquals(result.steps[1].output, "Step2: Step1: input");
      assertEquals(result.output, "Step2: Step1: input");
    });

    it("should apply transform function to step output", async () => {
      const agent = {
        id: "transform-agent",
        generate: async () => ({
          text: "lowercase",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const workflow = createWorkflow({
        steps: [
          {
            agent,
            name: "uppercase",
            transform: (output) => output.toUpperCase(),
          },
        ],
      });

      const result = await workflow.execute("input");

      assertEquals(result.output, "LOWERCASE");
      assertEquals(result.steps[0].output, "LOWERCASE");
    });

    it("should skip steps based on skip condition", async () => {
      const agent = {
        id: "skip-agent",
        generate: async ({ input }) => ({
          text: `Processed: ${input}`,
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const workflow = createWorkflow({
        steps: [
          { agent, name: "step1" },
          { agent, name: "step2", skip: () => true },
          { agent, name: "step3" },
        ],
      });

      const result = await workflow.execute("input");

      assertEquals(result.steps.length, 3);
      assertEquals(result.steps[0].skipped, false);
      assertEquals(result.steps[1].skipped, true);
      assertEquals(result.steps[2].skipped, false);
    });

    it("should build context from step outputs", async () => {
      const agent = {
        id: "context-agent",
        generate: async ({ input }) => ({
          text: `${input}-result`,
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      const workflow = createWorkflow({
        steps: [
          { agent, name: "analyze" },
          { agent, name: "summarize" },
        ],
        initialContext: { session: "test" },
      });

      const result = await workflow.execute("data");

      assertExists(result.context);
      assertEquals(result.context.session, "test");
      assertEquals(result.context.analyze, "data-result");
      assertEquals(result.context.summarize, "data-result-result");
    });
  });

  describe("AgentRegistryClass", () => {
    it("should register and retrieve agents", () => {
      const registry = new AgentRegistryClass();
      const agent = {
        id: "test",
        generate: async () => ({
          text: "response",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registry.register("test", agent);
      const retrieved = registry.get("test");

      assertExists(retrieved);
      assertEquals(retrieved.id, "test");
    });

    it("should check if agent exists", () => {
      const registry = new AgentRegistryClass();
      const agent = {
        id: "exists",
        generate: async () => ({
          text: "response",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registry.register("exists", agent);

      assert(registry.has("exists"));
      assert(!registry.has("not-exists"));
    });

    it("should get all agent IDs", () => {
      const registry = new AgentRegistryClass();
      const agent1 = {
        id: "agent1",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      };
      const agent2 = {
        id: "agent2",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registry.register("agent1", agent1);
      registry.register("agent2", agent2);

      const ids = registry.getAllIds();
      assertEquals(ids.length, 2);
      assert(ids.includes("agent1"));
      assert(ids.includes("agent2"));
    });

    it("should clear all agents", () => {
      const registry = new AgentRegistryClass();
      const agent = {
        id: "test",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registry.register("test", agent);
      assertEquals(registry.getAllIds().length, 1);

      registry.clear();
      assertEquals(registry.getAllIds().length, 0);
    });
  });

  describe("global registry functions", () => {
    beforeEach();

    it("should register agent globally", () => {
      const agent = {
        id: "global-agent",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registerAgent("global", agent);
      const retrieved = getAgent("global");

      assertExists(retrieved);
      assertEquals(retrieved.id, "global-agent");
    });

    it("should get all agent IDs globally", () => {
      agentRegistry.clear();

      const agent1 = {
        id: "agent1",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registerAgent("test1", agent1);
      const ids = getAllAgentIds();

      assert(ids.length >= 1);
      assert(ids.includes("test1"));
    });
  });

  describe("getAgentsAsTools", () => {
    beforeEach();

    it("should convert all registered agents to tools", () => {
      agentRegistry.clear();

      const agent1 = {
        id: "tool-agent-1",
        generate: async () => ({
          text: "response1",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      };

      const agent2 = {
        id: "tool-agent-2",
        generate: async () => ({
          text: "response2",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registerAgent("agent1", agent1);
      registerAgent("agent2", agent2);

      const tools = getAgentsAsTools();

      assertExists(tools.agent1);
      assertExists(tools.agent2);
      assertEquals(tools.agent1.id, "agent_tool-agent-1");
      assertEquals(tools.agent2.id, "agent_tool-agent-2");
    });

    it("should use custom descriptions", () => {
      agentRegistry.clear();

      const agent = {
        id: "desc-agent",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registerAgent("custom", agent);

      const tools = getAgentsAsTools({
        custom: "Custom description for agent",
      });

      const customTool = tools.custom;
      assertExists(customTool);
      assertEquals(customTool.description, "Custom description for agent");
    });

    it("should use default description when not provided", () => {
      agentRegistry.clear();

      const agent = {
        id: "default-desc",
        generate: async () => ({
          text: "",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: async () => ({}) as any,
      } as unknown as Agent;

      registerAgent("noDesc", agent);

      const tools = getAgentsAsTools();

      const noDescTool = tools.noDesc;
      assertExists(noDescTool);
      assertEquals(noDescTool.description, "Call noDesc agent");
    });
  });
});
