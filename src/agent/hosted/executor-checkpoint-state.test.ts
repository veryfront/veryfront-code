import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ProviderReplayCheckpoint } from "../runtime/provider-replay.ts";
import { createExecutorChannel } from "../executor/channel.ts";
import {
  copyExecutorReplayCheckpoints,
  createExecutorCheckpointStateOperations,
  executorInitialCheckpointsOperation,
  readExecutorInitialCheckpoints,
} from "./executor-checkpoint-state.ts";

const binding = {
  allocationId: "checkpoint-allocation",
  invocationId: "checkpoint-invocation",
  generation: 1,
};
function checkpoint(id: string, size: number): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: id,
    provider: "anthropic",
    providerBlocks: [{
      type: "provider-block",
      provider: "anthropic",
      block: { type: "redacted_thinking", data: "x".repeat(size) },
    }],
    providerBlockPositions: [0],
    totalPartCount: 1,
    elapsedMs: 12.5,
  };
}

it("streams a checkpoint delivery larger than one channel frame and retains every anchor", async () => {
  const checkpoints = Array.from(
    { length: 6 },
    (_, index) => checkpoint(`message-${index}`, 200_000),
  );
  const operations = createExecutorCheckpointStateOperations({
    expectedBinding: binding,
    capabilityIds: { providerReplayCheckpoint: "replay" },
    initialProviderReplayCheckpoints: checkpoints,
  });
  const toBroker = new TransformStream<Uint8Array, Uint8Array>();
  const toExecutor = new TransformStream<Uint8Array, Uint8Array>();
  const broker = createExecutorChannel({
    binding,
    operations,
    transport: { readable: toBroker.readable, writable: toExecutor.writable },
  });
  const executor = createExecutorChannel({
    binding,
    transport: { readable: toExecutor.readable, writable: toBroker.writable },
  });
  try {
    const restored = await readExecutorInitialCheckpoints({
      channel: executor,
      capabilityIds: { providerReplayCheckpoint: "replay" },
    });
    assertEquals(
      restored.initialProviderReplayCheckpoints?.map((value) => value.messageId),
      checkpoints.map((value) => value.messageId),
    );
    assertEquals(
      copyExecutorReplayCheckpoints(restored.initialProviderReplayCheckpoints!).length,
      6,
    );
    await assertRejects(() =>
      readExecutorInitialCheckpoints({
        channel: executor,
        capabilityIds: { providerReplayCheckpoint: "replay" },
      })
    );
  } finally {
    broker.close();
    executor.close();
    await Promise.all([broker.settled, executor.settled]);
  }
});

it("rejects wrong binding and capability before consuming a snapshot grant", async () => {
  const operation = createExecutorCheckpointStateOperations({
    expectedBinding: binding,
    capabilityIds: { providerReplayCheckpoint: "replay" },
    initialProviderReplayCheckpoints: [checkpoint("message", 10)],
  }).get(executorInitialCheckpointsOperation)!;
  if (operation.mode !== "stream") throw new Error("Missing fixture stream");
  const handle = operation.handle;
  const context = { binding, signal: new AbortController().signal, deadline: Date.now() + 10_000 };
  async function consume(value: JsonValue, bound = binding) {
    const frames: JsonValue[] = [];
    for await (const frame of handle(value, { ...context, binding: bound })) {
      frames.push(frame);
    }
    return frames;
  }
  await assertRejects(() => consume({ kind: "provider-replay", capabilityId: "other" }));
  await assertRejects(() =>
    consume({ kind: "provider-replay", capabilityId: "replay" }, { ...binding, generation: 2 })
  );
  await assertRejects(() =>
    consume({ kind: "provider-replay", capabilityId: "replay", runId: "other" })
  );
  assertEquals((await consume({ kind: "provider-replay", capabilityId: "replay" })).length, 2);
  await assertRejects(() => consume({ kind: "provider-replay", capabilityId: "replay" }));
});

it("rejects duplicate anchors and missing grants instead of silently dropping state", () => {
  assertThrows(() => copyExecutorReplayCheckpoints([checkpoint("same", 1), checkpoint("same", 2)]));
  assertThrows(() =>
    copyExecutorReplayCheckpoints(
      Array.from({ length: 101 }, (_, index) => checkpoint(String(index), 1)),
    )
  );
  assertThrows(() =>
    createExecutorCheckpointStateOperations({
      expectedBinding: binding,
      capabilityIds: {},
      initialProviderReplayCheckpoints: [checkpoint("message", 1)],
    })
  );
});
