import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { AgentRuntime } from "./index.ts";
import type { AgentConfig, Message } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

describe("agent manual pause", () => {
  for (const [pauseStep, exhaustBudget] of [[1, false], [2, false], [1, true]] as const) {
    it(`parks at settled step ${pauseStep} and resumes without repeating it (budget=${exhaustBudget})`, async () => {
      let modelCalls = 0;
      let toolCalls = 0;
      let finishes = 0;
      let saved: unknown = null;
      let resumedTokens = 0;
      const model: ModelRuntime = {
        provider: "test",
        modelId: "test/manual-pause",
        async doGenerate() {
          throw new Error("Only streaming is used");
        },
        async doStream() {
          modelCalls++;
          const parts = modelCalls === 1 || exhaustBudget
            ? [{
              type: "tool-call",
              toolCallId: `charge-${modelCalls}`,
              toolName: "charge",
              input: {},
            }]
            : [{ type: "text-delta", text: "Done" }];
          return {
            stream: new ReadableStream<unknown>({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.enqueue({
                  type: "finish",
                  finishReason: modelCalls === 1 || exhaustBudget ? "tool-calls" : "stop",
                  totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                });
                controller.close();
              },
            }),
          };
        },
      };
      const config = {
        model: "test/manual-pause",
        system: "Charge once and finish.",
        maxSteps: exhaustBudget ? 2 : 3,
        tools: {
          charge: tool({
            id: "charge",
            description: "Charge once",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              toolCalls++;
              return { charged: true };
            },
          }),
        },
        resolveModelTransport: () => ({ model }),
      };
      const messages: Message[] = [{
        id: "request-1",
        role: "user",
        parts: [{ type: "text", text: "Go" }],
      }];
      const paused = new AgentRuntime("manual-pause", config, {
        manualPause: {
          load: async () => null,
          acknowledge: async (checkpoint: { nextStep: number }) => {
            if (checkpoint.nextStep !== pauseStep) return false;
            saved = structuredClone(checkpoint);
            return true;
          },
        },
      });
      const pausedBody = await new Response(
        await paused.stream(messages, undefined, {
          onFinish: () => finishes++,
        }),
      ).text();
      assertEquals(modelCalls, pauseStep);
      assertEquals(toolCalls, 1);
      assertEquals(finishes, 0);
      assertEquals(pausedBody.includes('"type":"message-finish"'), false);
      assertEquals(saved !== null, true);

      const resumed = new AgentRuntime("manual-pause", config, {
        manualPause: {
          load: async () => saved,
          acknowledge: async () => false,
        },
      });
      const resumedBody = await new Response(
        await resumed.stream(messages, undefined, {
          onFinish: (response) => {
            finishes++;
            resumedTokens = response.usage?.totalTokens ?? 0;
          },
        }),
      ).text();
      assertEquals(modelCalls, 2);
      assertEquals(toolCalls, exhaustBudget ? 2 : 1);
      assertEquals(finishes, 1);
      assertEquals(resumedTokens, 4);
      assertEquals(resumedBody.includes("Done"), !exhaustBudget);
    });
  }
});

for (const pauseStep of [1, 2]) {
  it(`retains deferred tool exposure and empty-response recovery at step ${pauseStep}`, async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "read_marker" } }] },
      {
        parts: [{
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        }],
      },
      { toolCalls: [{ id: "marker-1", name: "read_marker", input: {} }] },
      { text: "Marker read." },
    ], { only: "stream" });
    let executions = 0;
    let saved: unknown = null;
    const config = {
      model: model.modelId,
      system: "Read a marker and report it.",
      maxSteps: 5,
      skills: false,
      __vfToolLoadingMode: "deferred",
      tools: {
        read_marker: tool({
          id: "read_marker",
          description: "Read the marker",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executions++;
            return { marker: "one" };
          },
        }),
      },
      resolveModelTransport: () => ({ model }),
    } as AgentConfig & RuntimeToolFilterConfig;
    const messages: Message[] = [{
      id: "request",
      role: "user",
      parts: [{ type: "text", text: "Read marker" }],
    }];
    const paused = new AgentRuntime("marker", config, {
      manualPause: {
        load: async () => null,
        acknowledge: async (checkpoint) => {
          if (checkpoint.nextStep !== pauseStep) return false;
          saved = structuredClone(checkpoint);
          return true;
        },
      },
    });
    await new Response(await paused.stream(messages)).text();
    assertEquals(model.callCount, pauseStep);
    const resumed = new AgentRuntime("marker", config, {
      manualPause: {
        load: async () => saved,
        acknowledge: async () => false,
      },
    });
    const body = await new Response(await resumed.stream(messages)).text();
    assertEquals(executions, 1);
    assertEquals(model.callCount, 4);
    assertEquals(model.toolNames(pauseStep).includes("read_marker"), true);
    assertEquals(body.includes("Marker read."), true);
  });
}

it("retains a trusted skill's delegation defaults across pause", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "load-1", name: "load_skill", input: {} }] },
    {
      toolCalls: [{
        id: "delegate-1",
        name: "invoke_agent",
        input: { prompt: "Research", description: "Research" },
      }],
    },
    { text: "Researched." },
  ], { only: "stream" });
  let delegated: unknown;
  let saved: unknown;
  const config = {
    model: model.modelId,
    system: "Load and delegate.",
    maxSteps: 4,
    tools: {
      load_skill: tool({
        id: "load_skill",
        description: "Load research skill",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({
          skillId: "research",
          instructions: "Research",
          references: [],
          scripts: [],
          model: "opus",
          thinking: false,
          maxSteps: 160,
        }),
      }),
      invoke_agent: tool({
        id: "invoke_agent",
        description: "Delegate research",
        inputSchema: defineSchema((v) =>
          v.object({
            prompt: v.string(),
            description: v.string(),
            model: v.string().optional(),
            thinking: v.number().optional(),
            max_steps: v.number().optional(),
          })
        )(),
        execute: (input) => {
          delegated = input;
          return { answer: "done" };
        },
      }),
    },
    resolveModelTransport: () => ({ model }),
  };
  const messages: Message[] = [{
    id: "request",
    role: "user",
    parts: [{ type: "text", text: "Research" }],
  }];
  const paused = new AgentRuntime("delegation", config, {
    preserveToolCatalog: true,
    manualPause: {
      load: async () => null,
      acknowledge: async (checkpoint) => {
        if (checkpoint.nextStep !== 1) return false;
        saved = structuredClone(checkpoint);
        return true;
      },
    },
  });
  await new Response(await paused.stream(messages)).text();
  const resumed = new AgentRuntime("delegation", config, {
    preserveToolCatalog: true,
    manualPause: {
      load: async () => saved,
      acknowledge: async () => false,
    },
  });
  await new Response(await resumed.stream(messages)).text();
  assertEquals(delegated, {
    prompt: "Research",
    description: "Research",
    model: "opus",
    thinking: 0,
    max_steps: 160,
  });
  assertEquals(model.callCount, 3);
});
