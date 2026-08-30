import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
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

it("rejects a checkpoint that the durable event boundary cannot accept", () => {
  const state = createProviderReplayCheckpointEmissionState({ messageId: MESSAGE_ID });
  const error = assertThrows(() =>
    captureProviderReplayCheckpoint(
      state,
      metadata([{
        type: "thinking",
        thinking: "",
        signature: "x".repeat(256 * 1024),
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
    } as AgentConfig & RuntimeToolFilterConfig;

    const assistant = agent(config);
    if (mode === "generate") {
      await assistant.generate({ input: "Look it up" });
    } else {
      await (await assistant.stream({ input: "Look it up" })).toDataStreamResponse().text();
    }

    assertEquals(operations.indexOf("persist:done") < operations.indexOf("model:2"), true);
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

  await assertRejects(
    () => agent(config).generate({ input: "Answer" }),
    Error,
    "provider replay checkpoint persistence is required",
  );
  assertEquals(model.callCount, 1);
});
