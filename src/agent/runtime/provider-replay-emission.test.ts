import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent, type AgentConfig } from "#veryfront/agent";
import { VeryfrontError } from "#veryfront/errors";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "#veryfront/agent/conversation/run-event-limits.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import {
  captureProviderReplayCheckpoint,
  createProviderReplayCheckpointEmissionState,
  type ProviderReplayCheckpoint,
} from "./provider-replay.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

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

describe("provider replay checkpoint emission", () => {
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
});
