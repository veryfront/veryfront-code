import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import {
  createExecutorPersistenceBroker,
  createExecutorPersistenceFacades,
} from "./executor-persistence-bridge.ts";
import {
  executorPersistenceJson,
  executorPersistenceOperations,
  getExecutorPersistenceCapabilityIdsSchema,
} from "./executor-persistence-schema.ts";

const binding = {
  allocationId: "allocation-persistence-test",
  generation: 7,
  invocationId: "invocation-persistence-test",
};
const capabilityIds = {
  publishParentRunEvents: "parent-events-capability",
  toolExposureCheckpoint: "tool-checkpoint-capability",
  providerReplayCheckpoint: "provider-checkpoint-capability",
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function pair(operations: ReadonlyMap<string, ExecutorOperation>, maxConcurrentCalls?: number) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const executor = createExecutorChannel({
    binding,
    maxConcurrentCalls,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    executor,
    broker,
    async close() {
      executor.close();
      await broker.closed;
      await Promise.all([executor.settled, broker.settled]);
    },
  };
}

describe("executor persistence bridge", () => {
  it("keeps later writes usable after an unsent request hits channel admission", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const written: string[] = [];
    const channels = pair(
      createExecutorPersistenceBroker({
        expectedBinding: binding,
        capabilityIds: { publishParentRunEvents: "events" },
        publishParentRunEvents: async (events) => {
          written.push(events[0]!.type);
          if (written.length === 1) {
            entered.resolve();
            await release.promise;
          }
        },
      }),
      1,
    );
    const facade = createExecutorPersistenceFacades({
      channel: channels.executor,
      capabilityIds: { publishParentRunEvents: "events" },
    });
    try {
      const first = facade.publishParentRunEvents!([{ type: "FIRST" }]);
      await entered.promise;
      await assertRejects(() => facade.publishParentRunEvents!([{ type: "UNSENT" }]));
      release.resolve();
      await first;
      await facade.publishParentRunEvents!([{ type: "THIRD" }]);
      assertEquals(written, ["FIRST", "THIRD"]);
    } finally {
      release.resolve();
      await channels.close();
    }
  });

  it("persists canonical fractional checkpoint elapsed time", async () => {
    let elapsed: number | undefined;
    const channels = pair(
      createExecutorPersistenceBroker({
        expectedBinding: binding,
        capabilityIds: { providerReplayCheckpoint: "replay" },
        persistProviderReplayCheckpoint: async (checkpoint) => {
          elapsed = checkpoint.elapsedMs;
        },
      }),
    );
    const facade = createExecutorPersistenceFacades({
      channel: channels.executor,
      capabilityIds: { providerReplayCheckpoint: "replay" },
    });
    try {
      await facade.providerReplayCheckpoint!.persist({
        version: 1,
        messageId: "message-1",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "redacted_thinking", data: "synthetic" },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
        elapsedMs: 12.5,
      });
      assertEquals(elapsed, 12.5);
    } finally {
      await channels.close();
    }
  });
  it("acknowledges actual persistence in one invocation order", async () => {
    const persisted: string[] = [];
    const channels = pair(createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds,
      publishParentRunEvents: async (events) => {
        persisted.push(`events:${events[0]?.type}`);
      },
      persistToolExposureCheckpoint: async (checkpoint) => {
        persisted.push(`tools:${checkpoint.loadedToolNames.join(",")}`);
      },
      persistProviderReplayCheckpoint: async (checkpoint) => {
        persisted.push(`provider:${checkpoint.messageId}`);
      },
    }));
    try {
      const facades = createExecutorPersistenceFacades({
        channel: channels.executor,
        capabilityIds,
      });
      await Promise.all([
        facades.publishParentRunEvents?.([{ type: "STEP_STARTED" }]),
        facades.toolExposureCheckpoint?.persist({ version: 2, loadedToolNames: ["search"] }),
        facades.providerReplayCheckpoint?.persist({
          version: 1,
          messageId: "message-1",
          provider: "anthropic",
          providerBlocks: [{
            type: "provider-block",
            provider: "anthropic",
            block: { type: "redacted_thinking", data: "synthetic" },
          }],
          providerBlockPositions: [0],
          providerMessageBlockCounts: [1],
          totalPartCount: 1,
        }),
      ]);
      assertEquals(persisted, ["events:STEP_STARTED", "tools:search", "provider:message-1"]);
    } finally {
      await channels.close();
    }
  });

  it("exports strict install capability IDs and never accepts authority fields", () => {
    assertEquals(getExecutorPersistenceCapabilityIdsSchema().parse(capabilityIds), capabilityIds);
    for (const field of ["runId", "ownerId", "authToken", "url"]) {
      const result = getExecutorPersistenceCapabilityIdsSchema().safeParse({
        ...capabilityIds,
        [field]: "synthetic-secret",
      });
      assertEquals(result.success, false);
    }
    assertEquals(
      getExecutorPersistenceCapabilityIdsSchema().safeParse({
        publishParentRunEvents: "duplicate-capability",
        toolExposureCheckpoint: "duplicate-capability",
      }).success,
      false,
    );
  });

  it("does not consume sequence numbers for locally invalid or remotely unauthorized requests", async () => {
    const persisted: string[] = [];
    const operations = createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds: { publishParentRunEvents: capabilityIds.publishParentRunEvents },
      publishParentRunEvents: async (events) => {
        persisted.push(String(events[0]?.type));
      },
    });
    const operation = operations.get(executorPersistenceOperations.publishParentRunEvents);
    if (operation?.mode !== "unary") throw new Error("missing synthetic operation");
    await assertRejects(() =>
      Promise.resolve(operation.handle({
        capabilityId: "wrong-capability",
        sequence: 1,
        events: [{ type: "UNAUTHORIZED" }],
      }, {
        binding,
        signal: new AbortController().signal,
        deadline: Date.now() + 1_000,
      }))
    );

    const channels = pair(operations);
    try {
      const facades = createExecutorPersistenceFacades({
        channel: channels.executor,
        capabilityIds: { publishParentRunEvents: capabilityIds.publishParentRunEvents },
      });
      const cyclic: Record<string, unknown> = { type: "INVALID" };
      cyclic.self = cyclic;
      await assertRejects(() =>
        facades.publishParentRunEvents!(
          [cyclic] as unknown as Parameters<NonNullable<typeof facades.publishParentRunEvents>>[0],
        )
      );
      await facades.publishParentRunEvents!([{ type: "AUTHORIZED" }]);
      assertEquals(persisted, ["AUTHORIZED"]);
    } finally {
      await channels.close();
    }
  });

  it("withholds acknowledgement and channel settlement until the original write settles", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const channels = pair(createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds: { publishParentRunEvents: capabilityIds.publishParentRunEvents },
      publishParentRunEvents: async () => {
        entered.resolve();
        await release.promise;
      },
    }));
    const facades = createExecutorPersistenceFacades({
      channel: channels.executor,
      capabilityIds: { publishParentRunEvents: capabilityIds.publishParentRunEvents },
    });
    let acknowledged = false;
    const request = facades.publishParentRunEvents!([{ type: "STEP_FINISHED" }]).then(() => {
      acknowledged = true;
    });
    await entered.promise;
    await tick();
    assertEquals(acknowledged, false);

    channels.executor.close();
    await channels.broker.closed;
    let settled = false;
    void channels.broker.settled.then(() => settled = true);
    await assertRejects(() => request);
    await tick();
    assertEquals(settled, false);
    release.resolve();
    await Promise.all([channels.executor.settled, channels.broker.settled]);
    assertEquals(settled, true);
  });

  it("fails closed on incomplete capabilities and validates initial checkpoint copies", () => {
    assertThrows(() =>
      createExecutorPersistenceBroker({
        expectedBinding: binding,
        capabilityIds: { toolExposureCheckpoint: capabilityIds.toolExposureCheckpoint },
      })
    );
    assertThrows(() =>
      createExecutorPersistenceFacades({
        channel: {} as Parameters<typeof createExecutorPersistenceFacades>[0]["channel"],
        capabilityIds: {},
        initialToolExposureCheckpoint: { version: 2, loadedToolNames: ["search"] },
      })
    );
  });

  it("consumes accepted failed writes once and never retries them", async () => {
    const persisted: string[] = [];
    const operations = createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds: { publishParentRunEvents: capabilityIds.publishParentRunEvents },
      publishParentRunEvents: async (events) => {
        persisted.push(String(events[0]?.type));
        if (events[0]?.type === "FIRST") throw new Error("synthetic persistence failure");
      },
    });
    const operation = operations.get(executorPersistenceOperations.publishParentRunEvents);
    if (operation?.mode !== "unary") throw new Error("missing synthetic operation");
    const context = {
      binding,
      signal: new AbortController().signal,
      deadline: Date.now() + 1_000,
    };
    await assertRejects(() =>
      Promise.resolve(operation.handle({
        capabilityId: capabilityIds.publishParentRunEvents,
        sequence: 1,
        events: [{ type: "FIRST" }],
      }, context))
    );
    await assertRejects(() =>
      Promise.resolve(operation.handle({
        capabilityId: capabilityIds.publishParentRunEvents,
        sequence: 1,
        events: [{ type: "RETRY" }],
      }, context))
    );
    assertEquals(
      await operation.handle({
        capabilityId: capabilityIds.publishParentRunEvents,
        sequence: 2,
        events: [{ type: "NEXT" }],
      }, context),
      { acknowledged: true, sequence: 2 },
    );
    assertEquals(persisted, ["FIRST", "NEXT"]);
  });

  it("rejects malformed replay state and mismatched bindings without reserving sequence", async () => {
    let writes = 0;
    const operations = createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds: { providerReplayCheckpoint: capabilityIds.providerReplayCheckpoint },
      persistProviderReplayCheckpoint: () => {
        writes++;
      },
    });
    const operation = operations.get(executorPersistenceOperations.persistProviderReplayCheckpoint);
    if (operation?.mode !== "unary") throw new Error("missing synthetic operation");
    const checkpoint = {
      version: 1,
      messageId: "message-1",
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "redacted_thinking", data: "synthetic" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 1,
    } as const;
    await assertRejects(() =>
      Promise.resolve(operation.handle(
        executorPersistenceJson({
          capabilityId: capabilityIds.providerReplayCheckpoint,
          sequence: 1,
          checkpoint: { ...checkpoint, providerBlockPositions: [1] },
        }),
        {
          binding,
          signal: new AbortController().signal,
          deadline: Date.now() + 1_000,
        },
      ))
    );
    await assertRejects(() =>
      Promise.resolve(operation.handle(
        executorPersistenceJson({
          capabilityId: capabilityIds.providerReplayCheckpoint,
          sequence: 1,
          checkpoint,
        }),
        {
          binding: { ...binding, invocationId: "other-invocation" },
          signal: new AbortController().signal,
          deadline: Date.now() + 1_000,
        },
      ))
    );
    assertEquals(
      await operation.handle(
        executorPersistenceJson({
          capabilityId: capabilityIds.providerReplayCheckpoint,
          sequence: 1,
          checkpoint,
        }),
        {
          binding,
          signal: new AbortController().signal,
          deadline: Date.now() + 1_000,
        },
      ),
      { acknowledged: true, sequence: 1 },
    );
    assertEquals(writes, 1);
  });
});
