import { scriptedModel } from "./model-runtime.test-helpers.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../factory.ts";
import type { CompletedAgentStep, RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

let agentWrites = 0;
const recordedAgentWrite = tool({
  id: "create_agent",
  description: "Creates an agent",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ writes: ++agentWrites }),
});

function fixture(
  boundary: (step: CompletedAgentStep) => Promise<boolean>,
  completedSteps = 0,
  toolName = "write",
) {
  let calls = 0;
  let writes = 0;
  const model: ModelRuntime<ModelRuntimeCallOptions> = {
    provider: "test",
    modelId: "test/completed-step",
    executionMode: "remote",
    doGenerate() {
      throw new Error("stream fixture");
    },
    doStream() {
      calls++;
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: `write-${calls}`,
              toolName,
              input: {},
            });
            controller.enqueue({
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
      });
    },
  };
  const config: RuntimeToolFilterConfig & {
    __vfCompletedStepBoundary: typeof boundary;
    __vfCompletedSteps: number;
  } = {
    id: "step-boundary",
    model: "test/completed-step",
    system: "Run the write tool",
    maxSteps: 3,
    tools: {
      [toolName]: toolName === "create_agent" ? recordedAgentWrite : tool({
        id: toolName,
        description: "Records a write",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ writes: ++writes }),
      }),
    },
    resolveModelTransport: () => Promise.resolve({ model }),
    __vfCompletedStepBoundary: boundary,
    __vfCompletedSteps: completedSteps,
  };
  return {
    assistant: agent(config),
    calls: () => calls,
    writes: () => toolName === "create_agent" ? agentWrites : writes,
  };
}

describe("completed agent step boundary", () => {
  it("suppresses interrupted-batch text already delivered before a pause", async () => {
    let captured: CompletedAgentStep | undefined;
    const model = scriptedModel([
      {
        parts: [
          { type: "text-delta", text: "Created the assistant." },
          { type: "tool-input-start", id: "pending-suggestions", toolName: "pause_suggestions" },
          { type: "tool-input-delta", id: "pending-suggestions", delta: "{}" },
          { type: "finish", finishReason: "tool-calls" },
        ],
      },
      { text: "Created the assistant. It is ready." },
    ], { provider: "hosted", modelId: "hosted/paused-prefix", only: "stream" });
    const config: RuntimeToolFilterConfig = {
      id: "paused-prefix",
      model: "hosted/paused-prefix",
      system: "Create an assistant",
      maxSteps: 3,
      resolveModelTransport: () => Promise.resolve({ model }),
      tools: {
        pause_suggestions: tool({
          id: "pause_suggestions",
          description: "Suggestions",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ suggestions: [] }),
        }),
      },
      __vfCompletedStepBoundary: (step) => {
        captured = step;
        return Promise.resolve(true);
      },
    };
    const first = await agent(config).stream({ input: "Create an assistant" });
    await first.toDataStreamResponse().text();
    assertExists(captured);
    assertEquals(model.callCount, 1);
    assertEquals(captured.loopState?.recoveredInterruptedLocalToolBatch, true);
    const chunks: string[] = [];
    const resumeConfig: RuntimeToolFilterConfig = {
      ...config,
      __vfCompletedStepBoundary: undefined,
      __vfCompletedSteps: captured.completedSteps,
      __vfCompletedStepState: captured.loopState,
    };
    const resumed = await agent(resumeConfig).stream({
      messages: captured.messages,
      onChunk: (chunk) => chunks.push(chunk),
    });
    await resumed.toDataStreamResponse().text();
    assertEquals(model.callCount, 2);
    assertEquals(chunks, [" It is ready."]);
  });

  for (const outcome of ["successful", "failed", "reloaded"] as const) {
    const failed = outcome === "failed";
    it(`restores the final-response guard after a ${outcome} agent write`, async () => {
      const model = scriptedModel([{ text: "Finished" }], {
        provider: "anthropic",
        modelId: "anthropic/claude-sonnet-4-6",
        only: "stream",
      });
      const assistant = agent({
        id: "write-resume",
        model: "anthropic/claude-sonnet-4-6",
        providerTools: ["web_search"],
        system: "Summarize the write",
        maxSteps: 3,
        skills: false,
        __vfToolLoadingMode: "eager",
        __vfCompletedSteps: 1,
        __vfCompletedStepState: {
          agentWriteFinalResponseGuard: outcome === "successful",
          hasCompletedTool: true,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
          hasSubmittedFormInput: false,
          runtimeGeneratedMessageIndexes: [],
        },
        tools: { create_agent: recordedAgentWrite },
        resolveModelTransport: () => ({ model }),
      } as RuntimeToolFilterConfig);
      const stream = await assistant.stream({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{
              type: "tool-call",
              toolCallId: "create-1",
              toolName: "create_agent",
              args: {},
            }],
          },
          {
            id: "tool-1",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "create-1",
              toolName: "create_agent",
              result: failed ? { error: "write failed" } : { id: "created-agent" },
            }],
          },
          ...(outcome === "reloaded"
            ? [{
              id: "search-result",
              role: "tool" as const,
              parts: [{
                type: "tool-result" as const,
                toolCallId: "search-1",
                toolName: "tool_search",
                result: { matches: [{ name: "create_agent", status: "loaded" }] },
              }],
            }]
            : []),
        ],
      });
      await stream.toDataStreamResponse().text();
      assertEquals(model.callCount, 1);
      assertEquals(model.toolNames(0).includes("create_agent"), failed || outcome === "reloaded");
      assertEquals(model.toolNames(0).includes("web_search"), failed || outcome === "reloaded");
    });
  }

  it("acknowledges a pause before recovering an empty turn after a settled tool", async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "write-1", name: "write", input: {} }] },
      {
        parts: [{
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        }],
      },
      { toolCalls: [{ id: "write-2", name: "write", input: {} }] },
      { text: "Finished" },
    ], { modelId: "test/empty-pause", only: "stream" });
    let writes = 0;
    const boundaries: number[] = [];
    const assistant = agent({
      id: "empty-pause",
      model: "test/empty-pause",
      system: "Write",
      skills: false,
      maxSteps: 4,
      __vfToolLoadingMode: "eager",
      __vfCompletedStepBoundary: (step: CompletedAgentStep) => {
        boundaries.push(step.completedSteps);
        return Promise.resolve(step.completedSteps >= 2);
      },
      tools: {
        write: tool({
          id: "write",
          description: "Records a write",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ writes: ++writes }),
        }),
      },
      resolveModelTransport: () => ({ model }),
    } as RuntimeToolFilterConfig);
    await (await assistant.stream({ input: "Write" })).toDataStreamResponse().text();
    assertEquals(model.callCount, 2);
    assertEquals(writes, 1);
    assertEquals(boundaries, [1, 2]);
  });

  it("captures this invocation's successful agent-write guard at the pause boundary", async () => {
    let guarded = false;
    const f = fixture(
      (step) => {
        guarded = step.loopState?.agentWriteFinalResponseGuard === true;
        return Promise.resolve(true);
      },
      0,
      "create_agent",
    );
    await (await f.assistant.stream({ input: "Create" })).toDataStreamResponse().text();
    assertEquals(f.calls(), 1);
    assertEquals(f.writes(), 1);
    assertEquals(guarded, true);
  });

  for (const recoveredEmptyResponse of [false, true]) {
    it(`retains completed-tool recovery with retry already used ${recoveredEmptyResponse}`, async () => {
      const model = scriptedModel([
        {
          parts: [{
            type: "finish",
            finishReason: "stop",
            totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
          }],
        },
        { text: "Recovered" },
      ], { modelId: "test/retained-empty", only: "stream" });
      const assistant = agent({
        id: "retained-empty",
        model: "test/retained-empty",
        system: "Continue",
        skills: false,
        tools: {},
        maxSteps: 4,
        __vfCompletedSteps: 1,
        __vfCompletedStepState: {
          agentWriteFinalResponseGuard: false,
          hasCompletedTool: true,
          recoveredEmptyResponse,
          recoveredInterruptedLocalToolBatch: false,
          hasSubmittedFormInput: false,
          runtimeGeneratedMessageIndexes: [],
        },
        resolveModelTransport: () => ({ model }),
      } as RuntimeToolFilterConfig);
      const stream = await assistant.stream({
        messages: [
          {
            id: "tool-1",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "write-1",
              toolName: "write",
              result: { written: true },
            }],
          },
        ],
      });
      const body = await stream.toDataStreamResponse().text();
      assertEquals(model.callCount, recoveredEmptyResponse ? 1 : 2);
      assertEquals(body.includes('"type":"error"'), recoveredEmptyResponse);
      if (!recoveredEmptyResponse) assertEquals(body.includes("Recovered"), true);
    });
  }

  it("restores verified skill delegation defaults into the next invocation tool", async () => {
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "child-1",
          name: "invoke_agent",
          input: { agent_id: "child", prompt: "Continue" },
        }],
      },
      { text: "Finished" },
    ], { modelId: "test/retained-skill", only: "stream" });
    let delegated: Record<string, unknown> | undefined;
    const assistant = agent({
      id: "retained-skill",
      model: "test/retained-skill",
      system: "Delegate",
      skills: false,
      maxSteps: 3,
      __vfCompletedSteps: 1,
      __vfToolLoadingMode: "eager",
      __vfCompletedStepState: {
        agentWriteFinalResponseGuard: false,
        hasCompletedTool: true,
        recoveredEmptyResponse: false,
        recoveredInterruptedLocalToolBatch: false,
        hasSubmittedFormInput: false,
        runtimeGeneratedMessageIndexes: [],
        activeSkillDelegationOverrides: {
          model: "anthropic/claude-sonnet-4-6",
          thinking: 1024,
          maxSteps: 8,
        },
      },
      tools: {
        invoke_agent: tool({
          id: "invoke_agent",
          description: "Delegates to a child",
          inputSchema: defineSchema((v) =>
            v.object({
              agent_id: v.string(),
              prompt: v.string(),
              model: v.string().optional(),
              thinking: v.number().optional(),
              max_steps: v.number().optional(),
            })
          )(),
          execute: (input) => {
            delegated = input;
            return { status: "completed" };
          },
        }),
      },
      resolveModelTransport: () => ({ model }),
    } as RuntimeToolFilterConfig);
    await (await assistant.stream({
      messages: [
        {
          id: "skill-1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "skill-1",
            toolName: "load_skill",
            result: {
              skillId: "retained",
              instructions: "Delegate",
              model: "anthropic/claude-sonnet-4-6",
              thinking: 1024,
              maxSteps: 8,
            },
          }],
        },
      ],
    })).toDataStreamResponse().text();
    assertEquals(delegated, {
      agent_id: "child",
      prompt: "Continue",
      model: "anthropic/claude-sonnet-4-6",
      thinking: 1024,
      max_steps: 8,
    });
  });

  it("retains completed tool results and stops before another model call", async () => {
    const steps: CompletedAgentStep[] = [];
    const f = fixture((step) => {
      steps.push(step);
      return Promise.resolve(true);
    });
    const stream = await f.assistant.stream({ input: "Write" });
    await stream.toDataStreamResponse().text();
    assertEquals(f.calls(), 1);
    assertEquals(f.writes(), 1);
    assertEquals(steps.length, 1);
    assertExists(steps[0]);
    assertEquals(steps[0].completedSteps, 1);
    assertEquals(steps[0].usageMetadata?.model, "test/completed-step");
    assertEquals(steps[0].usageMetadata?.totalTokens, 2);
    const encoded = JSON.stringify(steps[0].messages);
    assertEquals(encoded.includes('"tool-result"'), true);
    assertEquals(encoded.includes('"writes":1'), true);
  });

  it("holds the boundary while its acknowledgement remains unresolved", async () => {
    let release!: (value: boolean) => void;
    let reached!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const ack = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const f = fixture(() => {
      reached();
      return ack;
    });
    const stream = await f.assistant.stream({ input: "Write" });
    const body = stream.toDataStreamResponse().text();
    await Promise.race([entered, body]);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    assertEquals(f.calls(), 1);
    release(true);
    await body;
    assertEquals(f.calls(), 1);
  });

  it("keeps the authored model step budget across manual resume", async () => {
    const steps: number[] = [];
    const f = fixture((step) => {
      steps.push(step.completedSteps);
      return Promise.resolve(false);
    }, 2);
    const stream = await f.assistant.stream({ input: "Resume" });
    await stream.toDataStreamResponse().text();
    assertEquals(f.calls(), 1);
    assertEquals(steps, []);
  });
});
