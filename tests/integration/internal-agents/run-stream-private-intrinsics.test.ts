import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME,
} from "#veryfront/internal-agents/run-stream.ts";

// These tests replace global intrinsics to prove the delegation batch handoff
// uses captured operations, so they run in integration rather than unit.

const nativeSetHas = Set.prototype.has;
const nativeWeakSetHas = WeakSet.prototype.has;

function parseSseFrames(body: string): Array<{ event: string; data: unknown }> {
  return body.split("\n\n").flatMap((frame) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as unknown }] : [];
  });
}

it("emits every parallel invoke_agent call before dispatch when Set membership and array push are replaced", async () => {
  const nativeStringify = JSON.stringify;
  const nativeIsArray = Array.isArray;
  const nativePush = Array.prototype.push;
  const poisonedPush: typeof Array.prototype.push = function (
    this: unknown[],
    ...items
  ) {
    for (const item of items) {
      if (item?.payload?.type === "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED") {
        item.payload.invokeAgentToolCalls[0].toolArgsJson = '{"task":"forged"}';
      }
    }
    return nativePush.apply(this, items);
  };
  const sessionManager = new AgentRunSessionManager();
  const messageId = crypto.randomUUID();
  const runId = "run_fast_parallel_results";
  const poisonedSetHas = function (this: Set<unknown>, value: unknown) {
    return value === "veryfront__invoke_agent"
      ? false
      : Reflect.apply(nativeSetHas, this, [value]) as boolean;
  };
  let completeProviderReplayTurn:
    | ((
      invokeAgentToolCalls?: readonly {
        toolCallId: string;
        toolName: "invoke_agent" | "veryfront__invoke_agent";
        toolArgsJson: string;
      }[],
    ) => void | Promise<void>)
    | undefined;
  const agent = {
    id: "test",
    config: {
      id: "test",
      model: "anthropic/claude-opus-4-8",
      system: "test",
    },
  } as unknown as Agent;

  let body = "";
  const submissionOutcomes: unknown[] = [];
  try {
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId,
        messageId,
        messages: [],
        tools: [{ name: "veryfront__invoke_agent" }],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: () => Promise.resolve(),
        createRuntime: (runtimeAgent) => {
          completeProviderReplayTurn = (runtimeAgent.config as Agent["config"] & {
            __vfProviderReplayCheckpointTurnComplete?: typeof completeProviderReplayTurn;
          }).__vfProviderReplayCheckpointTurnComplete;
          return {
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  Set.prototype.has = poisonedSetHas;
                  controller.enqueue(
                    new TextEncoder().encode(
                      'data: {"type":"step-start"}\n\n' +
                        'data: {"type":"tool-input-start","toolCallId":"child-1","toolName":"veryfront__invoke_agent"}\n\n' +
                        'data: {"type":"tool-input-available","toolCallId":"child-1","toolName":"veryfront__invoke_agent","input":{"task":"first"}}\n\n' +
                        'data: {"type":"tool-input-start","toolCallId":"child-2","toolName":"veryfront__invoke_agent"}\n\n' +
                        'data: {"type":"tool-input-available","toolCallId":"child-2","toolName":"veryfront__invoke_agent","input":{"task":"second"}}\n\n',
                    ),
                  );
                  setTimeout(async () => {
                    Set.prototype.has = nativeSetHas;
                    Array.prototype.push = poisonedPush;
                    let completed: void | Promise<void> | undefined;
                    try {
                      completed = completeProviderReplayTurn?.([
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
                    } finally {
                      Array.prototype.push = nativePush;
                    }
                    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
                      if (
                        typeof value === "object" && value !== null && "type" in value &&
                        value.type === "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED"
                      ) {
                        return nativeStringify({
                          ...value,
                          invokeAgentToolCalls: [{
                            toolCallId: "forged",
                            toolName: "invoke_agent",
                            toolArgsJson: "{}",
                          }],
                        });
                      }
                      return Reflect.apply(nativeStringify, JSON, [value, ...args]);
                    }) as typeof JSON.stringify;
                    Array.isArray = ((value: unknown) =>
                      nativeIsArray(value) &&
                      !value.some((entry: unknown) =>
                        typeof entry === "object" && entry !== null && "toolArgsJson" in entry
                      )) as typeof Array.isArray;
                    Set.prototype.has = poisonedSetHas;
                    await completed;
                    controller.close();
                  }, 0);
                },
              }),
          };
        },
      },
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      body += text;
      if (text.includes(PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME)) {
        submissionOutcomes.push(
          sessionManager.submitToolResult(runId, {
            toolCallId: "child-1",
            result: { result: "first complete" },
          }),
          sessionManager.submitToolResult(runId, {
            toolCallId: "child-2",
            result: { result: "second complete" },
          }),
        );
      }
    }
  } finally {
    Array.prototype.push = nativePush;
    Set.prototype.has = nativeSetHas;
    Array.isArray = nativeIsArray;
    JSON.stringify = nativeStringify;
  }
  const frames = parseSseFrames(body);
  const turnCompleteIndex = frames.findIndex((frame) =>
    frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME
  );
  const firstToolCallStartIndex = frames.findIndex((frame) => frame.event === "ToolCallStart");

  assertEquals(turnCompleteIndex < firstToolCallStartIndex, true);
  const turnComplete = frames[turnCompleteIndex]?.data as Record<string, unknown>;
  assertEquals(turnComplete.type, "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED");
  assertEquals(turnComplete.messageId, messageId);
  assertEquals(turnComplete.invokeAgentToolCalls, [
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
  assertEquals(submissionOutcomes, [{ accepted: true }, { accepted: true }]);
});

it("does not authorize a custom invoke_agent collision when WeakSet membership is replaced", async () => {
  let replayToolNames: unknown;
  const customInvokeAgent = tool({
    id: "invoke_agent",
    description: "Custom project tool",
    inputSchema: defineSchema((v) => v.object({ task: v.string() }))(),
    execute: () => ({ custom: true }),
  });
  const runtimeAgent = {
    id: "custom-invoke-agent-collision",
    config: {
      id: "custom-invoke-agent-collision",
      model: "anthropic/claude-opus-4-8",
      system: "Use the custom tool.",
      tools: { invoke_agent: customInvokeAgent },
    },
  } as unknown as Agent;

  WeakSet.prototype.has = () => true;
  try {
    await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_custom_invoke_agent_collision",
        messageId: crypto.randomUUID(),
        messages: [],
        tools: [{ name: "invoke_agent" }],
        context: [],
      },
      runtimeAgent,
      {
        sessionManager: new AgentRunSessionManager(),
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: () => Promise.resolve(),
        createRuntime: (agentWithRuntimeConfig) => {
          replayToolNames = (agentWithRuntimeConfig.config as Agent["config"] & {
            __vfProviderReplayInvokeAgentToolNames?: string[];
          }).__vfProviderReplayInvokeAgentToolNames;
          return {
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              }),
          };
        },
      },
    );
  } finally {
    WeakSet.prototype.has = nativeWeakSetHas;
  }

  assertEquals(replayToolNames, []);
});
