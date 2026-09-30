import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent, type AgentConfig, AgentRuntime } from "#veryfront/agent";
import { VeryfrontError } from "#veryfront/errors";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "#veryfront/agent/conversation/run-event-limits.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import {
  captureProviderReplayCheckpoint,
  createProviderReplayCheckpointEmissionState,
  type ProviderReplayCheckpoint,
} from "./provider-replay.ts";
import type { ProviderReplayTurnFailure, RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { ProviderOutputTruncatedError } from "veryfront/provider/shared";

const MESSAGE_ID = "assistant-message-1";
const SIGNATURE = "test-signature";

function metadata(...rawAssistantMessages: Record<string, unknown>[][]) {
  return { anthropic: { rawAssistantMessages } };
}

function lookupTool(onExecute: () => void = () => {}) {
  return tool({
    id: "lookup",
    description: "Look up a value",
    inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
    execute: () => {
      onExecute();
      return { value: "found" };
    },
  });
}

function invokeAgentTool(onExecute: (task: string) => void = () => {}) {
  return tool({
    id: "invoke_agent",
    description: "Invoke a child agent",
    inputSchema: defineSchema((v) => v.object({ task: v.string() }))(),
    execute: ({ task }) => {
      onExecute(task);
      return { result: task };
    },
  });
}

function skillDelegationTools(callbacks: {
  onLoad?: () => void;
  onInvoke?: (task: string) => void;
} = {}) {
  return {
    load_skill: tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => {
        callbacks.onLoad?.();
        return {
          skillId: "delegate",
          instructions: "# Delegate",
          allowedTools: ["invoke_agent"],
          references: [],
          scripts: [],
          model: "anthropic/claude-sonnet-4-5",
          thinking: false,
          maxSteps: 6,
        };
      },
    }),
    invoke_agent: tool({
      id: "invoke_agent",
      description: "Invoke a child agent",
      inputSchema: defineSchema((v) =>
        v.object({
          task: v.string(),
          model: v.string().optional(),
          thinking: v.number().optional(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ task }) => {
        callbacks.onInvoke?.(task);
        return { result: task };
      },
    }),
  };
}

describe("provider replay checkpoint emission", () => {
  it("accumulates private provider blocks without consulting the buffer append method", () => {
    const state = createProviderReplayCheckpointEmissionState({ messageId: MESSAGE_ID });
    let observations = 0;
    Object.defineProperty(state.rawAssistantMessages, "push", {
      value: function (this: unknown[], ...items: unknown[]) {
        observations++;
        return Reflect.apply(Array.prototype.push, this, items);
      },
    });
    const checkpoint = captureProviderReplayCheckpoint(
      state,
      metadata([{
        type: "thinking",
        thinking: "synthetic private reasoning",
        signature: SIGNATURE,
      }]),
    );
    assertEquals(checkpoint?.providerBlocks[0]?.block.thinking, "synthetic private reasoning");
    assertEquals(observations, 0);
  });
  it("restores an existing checkpoint without consulting its array find method", async () => {
    const prior: ProviderReplayCheckpoint = {
      version: 1,
      messageId: MESSAGE_ID,
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "prior-signature" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 1,
    };
    const checkpoints = [prior];
    let observations = 0;
    Object.defineProperty(checkpoints, "find", {
      get() {
        observations++;
        return Array.prototype.find;
      },
    });
    const persisted: ProviderReplayCheckpoint[] = [];
    const model = scriptedModel([{
      text: "continued",
      providerMetadata: metadata([{ type: "text", text: "continued" }]),
    }], {
      modelId: "anthropic/private-checkpoint-selection",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "private-checkpoint-selection",
      model: "anthropic/private-checkpoint-selection",
      system: "Continue.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpoints: checkpoints,
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfPersistProviderReplayCheckpoint: (checkpoint: ProviderReplayCheckpoint) => {
        persisted.push(checkpoint);
      },
    } as AgentConfig & RuntimeToolFilterConfig;
    await agent(config).generate({
      input: [
        { id: MESSAGE_ID, role: "assistant", parts: [] },
        { id: "current-user", role: "user", parts: [{ type: "text", text: "Continue" }] },
      ],
    });
    assertEquals(persisted[0]?.providerBlocks[0]?.block, prior.providerBlocks[0]?.block);
    assertEquals(persisted[0]?.providerMessageBlockCounts, [1, 1]);
    assertEquals(observations, 0);
  });

  it("retains pre-signature groups and appends to the delivered run checkpoint", () => {
    const prior: ProviderReplayCheckpoint = {
      version: 1,
      messageId: MESSAGE_ID,
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "prior-signature" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 1,
    };
    const state = createProviderReplayCheckpointEmissionState({
      messageId: MESSAGE_ID,
      existingCheckpoint: prior,
    });

    const checkpoint = captureProviderReplayCheckpoint(
      state,
      metadata([{ type: "text", text: "continued" }]),
    );

    assertEquals(checkpoint?.providerMessageBlockCounts, [1, 1]);
    assertEquals(
      checkpoint?.providerBlocks.map((entry) => entry.block),
      [prior.providerBlocks[0]?.block, { type: "text", text: "continued" }],
    );
    assertEquals(checkpoint?.providerBlockPositions, [0, 1]);
    assertEquals(checkpoint?.totalPartCount, 2);

    const inactiveState = createProviderReplayCheckpointEmissionState({ messageId: MESSAGE_ID });
    assertEquals(
      captureProviderReplayCheckpoint(
        inactiveState,
        metadata([{ type: "text", text: "prefix" }]),
      ),
      undefined,
    );
    const activated = captureProviderReplayCheckpoint(
      inactiveState,
      metadata([{
        type: "thinking",
        thinking: "",
        signature: SIGNATURE,
      }]),
    );
    assertEquals(activated?.providerMessageBlockCounts, [1, 1]);
    assertEquals(activated?.providerBlocks[0]?.block, { type: "text", text: "prefix" });
  });

  it("accumulates provider response groups across more than six model steps", () => {
    const state = createProviderReplayCheckpointEmissionState({ messageId: MESSAGE_ID });
    let checkpoint = captureProviderReplayCheckpoint(
      state,
      metadata([{ type: "thinking", thinking: "", signature: SIGNATURE }]),
    );
    for (let index = 1; index < 7; index++) {
      checkpoint = captureProviderReplayCheckpoint(
        state,
        metadata([{ type: "text", text: `step ${index}` }]),
      );
    }

    assertEquals(checkpoint?.providerMessageBlockCounts, [1, 1, 1, 1, 1, 1, 1]);
    assertEquals(checkpoint?.providerBlocks.length, 7);
  });

  it("rejects a checkpoint that the durable event boundary cannot accept", () => {
    const state = createProviderReplayCheckpointEmissionState({ messageId: MESSAGE_ID });
    const error = assertThrows(() =>
      captureProviderReplayCheckpoint(
        state,
        metadata([{
          type: "thinking",
          thinking: "",
          signature: "x".repeat(MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES),
        }]),
      )
    );

    assertEquals(error instanceof Error, true);
    assertEquals(String(error).includes("xxxxx"), false);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`${mode} durably emits cumulative replay state before the next model step`, async () => {
      const operations: string[] = [];
      const checkpoints: ProviderReplayCheckpoint[] = [];
      const rawToolUse = {
        type: "tool_use",
        id: "lookup-1",
        name: "lookup",
        input: { query: "value" },
      };
      const model = scriptedModel([
        () => {
          operations.push("model:1");
          return {
            toolCalls: [{ id: "lookup-1", name: "lookup", input: { query: "value" } }],
            providerMetadata: metadata([{
              type: "thinking",
              thinking: "",
              signature: SIGNATURE,
            }, rawToolUse]),
          };
        },
        () => {
          operations.push("model:2");
          return {
            text: "done",
            providerMetadata: metadata([{ type: "text", text: "done" }]),
          };
        },
      ], {
        modelId: `anthropic/${mode}-provider-replay-emission`,
        provider: "anthropic",
        only: mode,
      });
      const config = {
        id: `${mode}-provider-replay-emission`,
        model: `anthropic/${mode}-provider-replay-emission`,
        system: "Use tools.",
        skills: false,
        tools: { lookup: lookupTool(() => operations.push("tool")) },
        maxSteps: 2,
        resolveModelTransport: () => ({ model }),
        __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
        __vfProviderReplayCheckpointPersistenceRequired: true,
        __vfPersistProviderReplayCheckpoint: async (checkpoint: ProviderReplayCheckpoint) => {
          operations.push("persist:start");
          await Promise.resolve();
          checkpoints.push(checkpoint);
          operations.push("persist:done");
        },
        __vfProviderReplayCheckpointTurnComplete: () => {
          operations.push("turn:complete");
        },
      } as AgentConfig & RuntimeToolFilterConfig;

      const assistant = agent(config);
      if (mode === "generate") {
        await assistant.generate({ input: "Look it up" });
      } else {
        await (await assistant.stream({ input: "Look it up" })).toDataStreamResponse().text();
      }

      assertEquals(operations.indexOf("persist:done") < operations.indexOf("model:2"), true);
      const completionIndex = operations.indexOf("turn:complete");
      assertEquals(completionIndex >= 0, true);
      assertEquals(completionIndex < operations.indexOf("model:2"), true);
      assertEquals(checkpoints.length, 2);
      assertEquals(checkpoints[0]?.providerMessageBlockCounts, [2]);
      assertEquals(checkpoints[1]?.providerMessageBlockCounts, [2, 1]);
      assertEquals(checkpoints[1]?.providerBlocks.map((entry) => entry.block), [
        { type: "thinking", thinking: "", signature: SIGNATURE },
        rawToolUse,
        { type: "text", text: "done" },
      ]);
    });
  }

  it("passes the complete parallel invoke_agent batch before tool execution", async () => {
    const operations: string[] = [];
    let completedBatch: unknown;
    const model = scriptedModel([{
      toolCalls: [
        { id: "child-1", name: "invoke_agent", input: { task: "first" } },
        { id: "child-2", name: "invoke_agent", input: { task: "second" } },
      ],
    }], {
      modelId: "anthropic/parallel-invoke-agent-replay-boundary",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "parallel-invoke-agent-replay-boundary",
      model: "anthropic/parallel-invoke-agent-replay-boundary",
      system: "Delegate twice.",
      skills: false,
      tools: {
        invoke_agent: invokeAgentTool((task) => operations.push(`tool:${task}`)),
      },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls) => {
        operations.push("turn:complete");
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await (await agent(config).stream({ input: "Delegate both tasks" })).toDataStreamResponse()
      .text();

    assertEquals(completedBatch, [
      {
        toolCallId: "child-1",
        toolName: "invoke_agent",
        toolArgsJson: '{"task":"first"}',
      },
      {
        toolCallId: "child-2",
        toolName: "invoke_agent",
        toolArgsJson: '{"task":"second"}',
      },
    ]);
    assertEquals(operations, ["turn:complete", "tool:first", "tool:second"]);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`excludes precompleted calls from a parallel ${mode} batch`, async () => {
      let completedBatch: unknown = "not-called";
      let localExecutions = 0;
      const localCalls = [
        { id: "child-1", name: "invoke_agent", input: { task: "first" } },
        { id: "child-2", name: "invoke_agent", input: { task: "second" } },
      ] as const;
      const providerCall = {
        id: "provider-child",
        name: "invoke_agent",
        input: { task: "provider" },
      } as const;
      const model = scriptedModel([
        mode === "generate"
          ? {
            content: [
              ...localCalls.map((call) => ({
                type: "tool-call",
                toolCallId: call.id,
                toolName: call.name,
                input: JSON.stringify(call.input),
              })),
              {
                type: "tool-call",
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                input: JSON.stringify(providerCall.input),
              },
              {
                type: "tool-result",
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                result: { result: providerCall.input.task },
              },
            ],
            finishReason: "tool-calls",
          }
          : {
            parts: [
              ...localCalls.map((call) => ({
                type: "tool-call" as const,
                toolCallId: call.id,
                toolName: call.name,
                input: call.input,
              })),
              {
                type: "tool-call" as const,
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                input: providerCall.input,
              },
              {
                type: "tool-result" as const,
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                output: { result: providerCall.input.task },
              },
              { type: "finish", finishReason: "tool-calls", totalUsage: null },
            ],
          },
      ], {
        modelId: `anthropic/provider-executed-${mode}-replay-boundary`,
        provider: "anthropic",
        only: mode,
      });
      const config = {
        id: `provider-executed-${mode}-replay-boundary`,
        model: `anthropic/provider-executed-${mode}-replay-boundary`,
        system: "Delegate twice.",
        skills: false,
        tools: {
          invoke_agent: invokeAgentTool(() => localExecutions++),
        },
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
        __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
        __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
          completedBatch = invokeAgentToolCalls;
        },
      } as AgentConfig & RuntimeToolFilterConfig & {
        __vfProviderReplayInvokeAgentToolNames: string[];
      };

      const assistant = agent(config);
      if (mode === "generate") {
        await assistant.generate({ input: "Delegate both tasks" });
      } else {
        await (await assistant.stream({ input: "Delegate both tasks" })).toDataStreamResponse()
          .text();
      }

      assertEquals(completedBatch, [
        {
          toolCallId: "child-1",
          toolName: "invoke_agent",
          toolArgsJson: '{"task":"first"}',
        },
        {
          toolCallId: "child-2",
          toolName: "invoke_agent",
          toolArgsJson: '{"task":"second"}',
        },
      ]);
      assertEquals(localExecutions, 2);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`publishes same-turn skill overrides before parallel ${mode} dispatch`, async () => {
      const operations: string[] = [];
      let completedBatch: unknown;
      const model = scriptedModel([{
        toolCalls: [
          { id: "load-1", name: "load_skill", input: { skillId: "delegate" } },
          { id: "child-1", name: "invoke_agent", input: { task: "first" } },
          { id: "child-2", name: "invoke_agent", input: { task: "second" } },
        ],
      }], {
        modelId: `anthropic/same-turn-skill-parallel-${mode}-replay-boundary`,
        provider: "anthropic",
        only: mode,
      });
      const config = {
        id: `same-turn-skill-parallel-${mode}-replay-boundary`,
        model: `anthropic/same-turn-skill-parallel-${mode}-replay-boundary`,
        system: "Load the skill, then delegate twice.",
        skills: true,
        tools: skillDelegationTools({
          onLoad: () => operations.push("load"),
          onInvoke: (task) => operations.push(`invoke:${task}`),
        }),
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
        __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
        __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
          operations.push("turn:complete");
          completedBatch = invokeAgentToolCalls;
        },
      } as AgentConfig & RuntimeToolFilterConfig & {
        __vfProviderReplayInvokeAgentToolNames: string[];
      };

      const assistant = agent(config);
      if (mode === "generate") {
        await assistant.generate({ input: "Delegate both tasks" });
      } else {
        await (await assistant.stream({ input: "Delegate both tasks" })).toDataStreamResponse()
          .text();
      }

      assertEquals(completedBatch, [
        {
          toolCallId: "child-1",
          toolName: "invoke_agent",
          toolArgsJson:
            '{"task":"first","model":"anthropic/claude-sonnet-4-5","thinking":0,"max_steps":6}',
        },
        {
          toolCallId: "child-2",
          toolName: "invoke_agent",
          toolArgsJson:
            '{"task":"second","model":"anthropic/claude-sonnet-4-5","thinking":0,"max_steps":6}',
        },
      ]);
      assertEquals(operations, ["load", "turn:complete", "invoke:first", "invoke:second"]);
    });
  }

  it("publishes a completed same-turn streamed skill result in a parallel batch", async () => {
    const operations: string[] = [];
    const executedInputs: unknown[] = [];
    let completedBatch: unknown;
    const model = scriptedModel([{
      parts: [
        {
          type: "tool-call" as const,
          toolCallId: "load-1",
          toolName: "load_skill",
          input: { skillId: "delegate" },
        },
        {
          type: "tool-result" as const,
          toolCallId: "load-1",
          toolName: "load_skill",
          output: {
            skillId: "delegate",
            instructions: "# Delegate",
            allowedTools: ["invoke_agent"],
            references: [],
            scripts: [],
            model: "anthropic/claude-sonnet-4-5",
            thinking: false,
            maxSteps: 6,
          },
        },
        {
          type: "tool-call" as const,
          toolCallId: "child-1",
          toolName: "invoke_agent",
          input: { task: "first" },
        },
        {
          type: "tool-call" as const,
          toolCallId: "child-2",
          toolName: "invoke_agent",
          input: { task: "second" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ],
    }], {
      modelId: "anthropic/completed-skill-parallel-stream-replay-boundary",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "completed-skill-parallel-stream-replay-boundary",
      model: "anthropic/completed-skill-parallel-stream-replay-boundary",
      system: "Load the skill, then delegate twice.",
      skills: true,
      tools: skillDelegationTools({
        onLoad: () => operations.push("load"),
        onInvoke: (task) => operations.push(`invoke:${task}`),
      }),
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      onToolResult: (request: { toolName: string; input: unknown }) => {
        if (request.toolName === "invoke_agent") executedInputs.push(request.input);
      },
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        operations.push("turn:complete");
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    await (await agent(config).stream({ input: "Delegate both tasks" })).toDataStreamResponse()
      .text();

    const effectiveArgs = [
      { task: "first", model: "anthropic/claude-sonnet-4-5", thinking: 0, max_steps: 6 },
      { task: "second", model: "anthropic/claude-sonnet-4-5", thinking: 0, max_steps: 6 },
    ];
    assertEquals(executedInputs, effectiveArgs);
    assertEquals(completedBatch, [
      {
        toolCallId: "child-1",
        toolName: "invoke_agent",
        toolArgsJson: JSON.stringify(effectiveArgs[0]),
      },
      {
        toolCallId: "child-2",
        toolName: "invoke_agent",
        toolArgsJson: JSON.stringify(effectiveArgs[1]),
      },
    ]);
    assertEquals(operations, ["turn:complete", "invoke:first", "invoke:second"]);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`keeps interleaved skill delegation sequential in ${mode}`, async () => {
      const operations: string[] = [];
      let completedBatch: unknown = "not-called";
      const model = scriptedModel([{
        toolCalls: [
          { id: "child-1", name: "invoke_agent", input: { task: "first" } },
          { id: "load-1", name: "load_skill", input: { skillId: "delegate" } },
          { id: "child-2", name: "invoke_agent", input: { task: "second" } },
        ],
      }], {
        modelId: `anthropic/interleaved-skill-${mode}-replay-boundary`,
        provider: "anthropic",
        only: mode,
      });
      const config = {
        id: `interleaved-skill-${mode}-replay-boundary`,
        model: `anthropic/interleaved-skill-${mode}-replay-boundary`,
        system: "Delegate, load the skill, then delegate again.",
        skills: true,
        tools: skillDelegationTools({
          onLoad: () => operations.push("load"),
          onInvoke: (task) => operations.push(`invoke:${task}`),
        }),
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
        __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
        __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
          operations.push("turn:complete");
          completedBatch = invokeAgentToolCalls;
        },
      } as AgentConfig & RuntimeToolFilterConfig & {
        __vfProviderReplayInvokeAgentToolNames: string[];
      };

      const assistant = agent(config);
      if (mode === "generate") {
        await assistant.generate({ input: "Delegate in order" });
      } else {
        await (await assistant.stream({ input: "Delegate in order" })).toDataStreamResponse()
          .text();
      }

      assertEquals(completedBatch, undefined);
      assertEquals(operations, ["turn:complete", "invoke:first", "load", "invoke:second"]);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`publishes effective skill delegation args for a parallel ${mode} batch`, async () => {
      const completedBatches: unknown[] = [];
      const executedInputs: unknown[] = [];
      const model = scriptedModel([{
        toolCalls: [{ id: "load-1", name: "load_skill", input: { skillId: "delegate" } }],
      }, {
        toolCalls: [
          { id: "child-1", name: "invoke_agent", input: { task: "first" } },
          { id: "child-2", name: "invoke_agent", input: { task: "second" } },
        ],
      }], {
        modelId: `anthropic/skill-parallel-${mode}-replay-boundary`,
        provider: "anthropic",
        only: mode,
      });
      const config = {
        id: `skill-parallel-${mode}-replay-boundary`,
        model: `anthropic/skill-parallel-${mode}-replay-boundary`,
        system: "Load the skill, then delegate twice.",
        skills: true,
        tools: skillDelegationTools(),
        maxSteps: 2,
        resolveModelTransport: () => ({ model }),
        onToolResult: (request: { toolName: string; input: unknown }) => {
          if (request.toolName === "invoke_agent") executedInputs.push(request.input);
        },
        __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
        __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
        __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
          completedBatches.push(invokeAgentToolCalls);
        },
      } as AgentConfig & RuntimeToolFilterConfig & {
        __vfProviderReplayInvokeAgentToolNames: string[];
      };

      const assistant = agent(config);
      if (mode === "generate") {
        await assistant.generate({ input: "Delegate both tasks" });
      } else {
        await (await assistant.stream({ input: "Delegate both tasks" })).toDataStreamResponse()
          .text();
      }

      const expectedArgs = [
        {
          task: "first",
          model: "anthropic/claude-sonnet-4-5",
          thinking: 0,
          max_steps: 6,
        },
        {
          task: "second",
          model: "anthropic/claude-sonnet-4-5",
          thinking: 0,
          max_steps: 6,
        },
      ];
      assertEquals(executedInputs, expectedArgs);
      assertEquals(completedBatches[1], [
        {
          toolCallId: "child-1",
          toolName: "invoke_agent",
          toolArgsJson:
            '{"task":"first","model":"anthropic/claude-sonnet-4-5","thinking":0,"max_steps":6}',
        },
        {
          toolCallId: "child-2",
          toolName: "invoke_agent",
          toolArgsJson:
            '{"task":"second","model":"anthropic/claude-sonnet-4-5","thinking":0,"max_steps":6}',
        },
      ]);
    });
  }

  it("uses the trusted aliased control-plane name for a parallel batch", async () => {
    let completedBatch: unknown;
    const model = scriptedModel([{
      toolCalls: [
        { id: "child-1", name: "veryfront__invoke_agent", input: { task: "first" } },
        { id: "child-2", name: "veryfront__invoke_agent", input: { task: "second" } },
      ],
    }], {
      modelId: "anthropic/aliased-parallel-invoke-agent-replay-boundary",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "aliased-parallel-invoke-agent-replay-boundary",
      model: "anthropic/aliased-parallel-invoke-agent-replay-boundary",
      system: "Delegate twice.",
      skills: false,
      tools: { veryfront__invoke_agent: invokeAgentTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["veryfront__invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    await new AgentRuntime(config.id!, config).generate("Delegate both tasks");

    assertEquals(completedBatch, [
      {
        toolCallId: "child-1",
        toolName: "veryfront__invoke_agent",
        toolArgsJson: '{"task":"first"}',
      },
      {
        toolCallId: "child-2",
        toolName: "veryfront__invoke_agent",
        toolArgsJson: '{"task":"second"}',
      },
    ]);
  });

  it("excludes incomplete and malformed streamed calls from the parallel batch", async () => {
    let completedBatch: unknown = "not-called";
    const model = scriptedModel([{
      parts: [
        { type: "tool-input-start", id: "child-incomplete", toolName: "invoke_agent" },
        { type: "tool-input-delta", id: "child-incomplete", delta: '{"task":"partial"' },
        { type: "tool-input-start", id: "child-malformed", toolName: "invoke_agent" },
        { type: "tool-input-delta", id: "child-malformed", delta: '{"task":}' },
        { type: "tool-input-end", id: "child-malformed" },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ],
    }], {
      modelId: "anthropic/uncommitted-parallel-invoke-agent",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "uncommitted-parallel-invoke-agent",
      model: "anthropic/uncommitted-parallel-invoke-agent",
      system: "Delegate twice.",
      skills: false,
      tools: { invoke_agent: invokeAgentTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    await (await agent(config).stream({ input: "Delegate both tasks" })).toDataStreamResponse()
      .text();

    assertEquals(completedBatch, undefined);
  });

  it("suppresses a finalized delegation prefix when a sibling call is interrupted", async () => {
    let completedBatch: unknown = "not-called";
    const executedTasks: string[] = [];
    const model = scriptedModel([{
      parts: [
        {
          type: "tool-call",
          toolCallId: "child-1",
          toolName: "invoke_agent",
          input: { task: "first" },
        },
        {
          type: "tool-call",
          toolCallId: "child-2",
          toolName: "invoke_agent",
          input: { task: "second" },
        },
        { type: "tool-input-start", id: "child-interrupted", toolName: "invoke_agent" },
        { type: "tool-input-delta", id: "child-interrupted", delta: '{"task":"partial"' },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ],
    }], {
      modelId: "anthropic/interrupted-parallel-invoke-agent-sibling",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "interrupted-parallel-invoke-agent-sibling",
      model: "anthropic/interrupted-parallel-invoke-agent-sibling",
      system: "Delegate three times.",
      skills: false,
      tools: {
        invoke_agent: invokeAgentTool((task) => executedTasks.push(task)),
      },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    await (await agent(config).stream({ input: "Delegate all tasks" })).toDataStreamResponse()
      .text();

    assertEquals(completedBatch, undefined);
    assertEquals(executedTasks, []);
  });

  it("keeps the replay boundary payload unchanged for one invoke_agent call", async () => {
    let completedBatch: unknown = "not-called";
    const model = scriptedModel([{
      toolCalls: [{ id: "child-1", name: "invoke_agent", input: { task: "only" } }],
    }], {
      modelId: "anthropic/single-invoke-agent-replay-boundary",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "single-invoke-agent-replay-boundary",
      model: "anthropic/single-invoke-agent-replay-boundary",
      system: "Delegate once.",
      skills: false,
      tools: { invoke_agent: invokeAgentTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await agent(config).generate({ input: "Delegate one task" });

    assertEquals(completedBatch, undefined);
  });

  it("does not apply private replay batch limits outside a hosted replay boundary", async () => {
    const tasks: string[] = [];
    const model = scriptedModel([{
      toolCalls: [
        { id: `child-${"a".repeat(128)}`, name: "invoke_agent", input: { task: "first" } },
        { id: "child-2", name: "invoke_agent", input: { task: "second" } },
      ],
    }], {
      modelId: "anthropic/direct-parallel-invoke-agent",
      provider: "anthropic",
      only: "generate",
    });

    await agent({
      id: "direct-parallel-invoke-agent",
      model: "anthropic/direct-parallel-invoke-agent",
      system: "Delegate twice.",
      skills: false,
      tools: { invoke_agent: invokeAgentTool((task) => tasks.push(task)) },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    }).generate({ input: "Delegate both tasks" });

    assertEquals(tasks, ["first", "second"]);
  });

  it("required replay checkpoint persistence fails closed on the final provider turn", async () => {
    const model = scriptedModel([{
      text: "done",
      providerMetadata: metadata([{
        type: "thinking",
        thinking: "",
        signature: SIGNATURE,
      }, { type: "text", text: "done" }]),
    }], {
      modelId: "anthropic/missing-provider-replay-persister",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "missing-provider-replay-persister",
      model: "anthropic/missing-provider-replay-persister",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayCheckpointPersistenceRequired: true,
    } as AgentConfig & RuntimeToolFilterConfig;

    const error = await assertRejects(
      () => agent(config).generate({ input: "Answer" }),
      VeryfrontError,
      "provider replay checkpoint persistence is required",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "durable-run-event-persistence-failed");
    assertEquals(model.callCount, 1);
  });

  it("closes the provider turn when no replay checkpoint is required", async () => {
    let completedTurns = 0;
    const model = scriptedModel([{
      text: "done",
      providerMetadata: metadata([{ type: "text", text: "done" }]),
    }], {
      modelId: "anthropic/provider-replay-turn-boundary",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "provider-replay-turn-boundary",
      model: "anthropic/provider-replay-turn-boundary",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointTurnComplete: () => {
        completedTurns++;
      },
      __vfPersistProviderReplayCheckpoint: () => {
        throw new Error("checkpoint persister must stay unused");
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await agent(config).generate({ input: "Answer" });

    assertEquals(completedTurns, 1);
    assertEquals(model.callCount, 1);
  });

  it("stops execution when the checkpoint persister rejects", async () => {
    let failedTurns = 0;
    const model = scriptedModel([{
      text: "done",
      providerMetadata: metadata([{
        type: "thinking",
        thinking: "",
        signature: SIGNATURE,
      }, { type: "text", text: "done" }]),
    }], {
      modelId: "anthropic/rejected-provider-replay-persister",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "rejected-provider-replay-persister",
      model: "anthropic/rejected-provider-replay-persister",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfPersistProviderReplayCheckpoint: () =>
        Promise.reject(new Error("checkpoint sink rejected")),
      __vfProviderReplayCheckpointTurnFailed: () => {
        failedTurns++;
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await assertRejects(
      () => agent(config).generate({ input: "Answer" }),
      Error,
      "checkpoint sink rejected",
    );
    assertEquals(model.callCount, 1);
    assertEquals(failedTurns, 1);
  });

  it("fails the provider turn when streaming aborts before checkpoint capture", async () => {
    let failedTurns = 0;
    const privateProviderMarker = "private provider replay failure <TOKEN>";
    const model = scriptedModel([() => {
      throw new Error(privateProviderMarker);
    }], {
      modelId: "anthropic/failed-provider-replay-stream",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "failed-provider-replay-stream",
      model: "anthropic/failed-provider-replay-stream",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayCheckpointTurnFailed: () => {
        failedTurns++;
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    const stream = await agent(config).stream({ input: "Answer" });
    const body = await stream.toDataStreamResponse().text();

    assertEquals(body.includes("Provider stream failed"), true);
    assertEquals(body.includes(privateProviderMarker), false);
    assertEquals(body.includes('"type":"message-finish"'), false);
    assertEquals(failedTurns, 1);
  });

  it("required replay checkpoint persistence rejects a missing durable message identity", async () => {
    const model = scriptedModel([{ text: "done" }], {
      modelId: "anthropic/missing-provider-replay-message-id",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "missing-provider-replay-message-id",
      model: "anthropic/missing-provider-replay-message-id",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointPersistenceRequired: true,
    } as AgentConfig & RuntimeToolFilterConfig;

    const error = await assertRejects(
      () => agent(config).generate({ input: "Answer" }),
      VeryfrontError,
      "provider replay checkpoint message identity is required",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "durable-run-event-persistence-failed");
  });
  /**
   * Regression coverage for #1467: this is the junction between the typed
   * truncation the Anthropic parser now raises and the run error an internal
   * agent reports. The runtime is the only place that carries the sanitized
   * `{message, code}` pair into the replay failure hook, so the hook argument
   * is asserted against a real provider failure rather than a hand-built one.
   */
  it("hands the classified provider truncation to the replay failure hook", async () => {
    const failures: (ProviderReplayTurnFailure | undefined)[] = [];
    const privateProviderDetail = "incomplete tool_use input <PRIVATE>";
    const model = scriptedModel([() => {
      throw new ProviderOutputTruncatedError({
        provider: "anthropic",
        status: 200,
        message:
          `Anthropic request failed: provider output truncated at the max output token limit (${privateProviderDetail})`,
        retryable: false,
      });
    }], {
      modelId: "anthropic/truncated-provider-replay-stream",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "truncated-provider-replay-stream",
      model: "anthropic/truncated-provider-replay-stream",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayCheckpointTurnFailed: (failure?: ProviderReplayTurnFailure) => {
        failures.push(failure);
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    const stream = await agent(config).stream({ input: "Answer" });
    const body = await stream.toDataStreamResponse().text();

    assertEquals(failures.length, 1);
    assertEquals(failures[0]?.code, "PROVIDER_OUTPUT_TRUNCATED");
    assertEquals(
      failures[0]?.message,
      "The model stopped at its output token limit before it finished the response. " +
        "Raise the model output token limit, or ask for a shorter response.",
    );
    assertEquals(failures[0]?.message.includes(privateProviderDetail), false);
    assertEquals(body.includes("PROVIDER_OUTPUT_TRUNCATED"), true);
    assertEquals(body.includes(privateProviderDetail), false);
  });

  it("keeps a cancelled turn's replay failure free of the cancellation reason", async () => {
    const failures: (ProviderReplayTurnFailure | undefined)[] = [];
    const cancelReasonMarker = "client disconnected <PRIVATE CANCEL REASON>";
    const model = scriptedModel([{ hangUntilAbort: true }], {
      modelId: "anthropic/cancelled-provider-replay-stream",
      provider: "anthropic",
      only: "stream",
    });
    const config = {
      id: "cancelled-provider-replay-stream",
      model: "anthropic/cancelled-provider-replay-stream",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayCheckpointTurnFailed: (failure?: ProviderReplayTurnFailure) => {
        failures.push(failure);
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    const abortController = new AbortController();
    const stream = await agent(config).stream({
      input: "Answer",
      abortSignal: abortController.signal,
    });
    const bodyPromise = stream.toDataStreamResponse().text();
    await waitFor(() => model.callCount > 0, {
      message: "the model call must start before the run is cancelled",
    });
    abortController.abort(new DOMException(cancelReasonMarker, "AbortError"));
    const body = await bodyPromise;

    assertEquals(failures.length, 1);
    // A cancellation reports no cause at all, so the relay keeps its neutral
    // default instead of surfacing the client's raw abort reason.
    assertEquals(failures[0], undefined);
    assertEquals(body.includes(cancelReasonMarker), false);
  });

  it("attributes a checkpoint persistence failure to Veryfront, not the provider", async () => {
    const failures: (ProviderReplayTurnFailure | undefined)[] = [];
    const model = scriptedModel([{ text: "done" }], {
      modelId: "anthropic/required-provider-replay-persistence",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "required-provider-replay-persistence",
      model: "anthropic/required-provider-replay-persistence",
      system: "Answer.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointPersistenceRequired: true,
      __vfProviderReplayCheckpointTurnFailed: (failure?: ProviderReplayTurnFailure) => {
        failures.push(failure);
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await assertRejects(
      () => agent(config).generate({ input: "Answer" }),
      VeryfrontError,
      "provider replay checkpoint message identity is required",
    );

    assertEquals(failures.length, 1);
    assertEquals(failures[0]?.code, "DURABLE_RUN_EVENT_PERSISTENCE_FAILED");
    assertEquals(failures[0]?.message, "Durable run event persistence failed");
  });
});
