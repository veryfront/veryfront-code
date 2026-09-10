import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ExecutorOperation } from "../executor/channel.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorChannel } from "../executor/channel.ts";
import type { ExecutorRuntimeInstall } from "./executor-runtime-install-schema.ts";
import { createExecutorRuntimeFacades } from "./executor-runtime-facades.ts";
import { createExecutorPersistenceBroker } from "./executor-persistence-bridge.ts";
import type { ProviderReplayCheckpoint } from "../runtime/provider-replay.ts";

const binding = {
  allocationId: "facade-allocation",
  invocationId: "facade-invocation",
  generation: 1,
};
const modelId = "veryfront-cloud/openai/synthetic-model";
function installation(): ExecutorRuntimeInstall {
  return {
    version: 1,
    binding,
    root: "project",
    owner: { scopeKind: "global", serviceName: "veryfront-agent" },
    source: { type: "release", releaseId: "release-1" },
    grant: {
      agentId: "coder",
      defaultModelId: modelId,
      maxSteps: 3,
      models: [{ id: modelId, maxOutputTokens: 100, providerToolNames: [] }],
      allowedToolNames: ["read"],
      hostToolFacadeIds: ["host"],
      remoteToolSourceIds: ["remote"],
      execution: { kind: "ephemeral", projectId: null },
    },
    capabilities: { persistence: {} },
  };
}
function channels(
  sources = ["host", "remote"],
  persistenceOperations: ReadonlyMap<string, ExecutorOperation> = new Map(),
) {
  const toBroker = new TransformStream<Uint8Array, Uint8Array>();
  const toExecutor = new TransformStream<Uint8Array, Uint8Array>();
  let executions = 0;
  let writes = 0;
  const operations = new Map<string, ExecutorOperation>([
    ["persistence.initial-checkpoints", {
      mode: "stream",
      async *handle() {
        yield { type: "complete" };
      },
    }],
    ["persistence.tool-exposure-checkpoint", {
      mode: "unary",
      handle(input) {
        writes++;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("Invalid fixture request");
        }
        return { acknowledged: true, sequence: input.sequence! };
      },
    }],
    ["model.metadata", {
      mode: "unary",
      handle: () => [{
        id: modelId,
        modelId: "synthetic-model",
        provider: "openai",
        specificationVersion: "v3",
      }],
    }],
    ["tool.sources", {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        for (const sourceId of sources) yield { type: "source", sourceId };
        yield { type: "complete" };
      },
    }],
    ["tool.list", {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        yield {
          type: "tool",
          definition: {
            name: "read",
            description: "Read a synthetic value",
            parameters: { type: "object", properties: {} },
          },
        };
        yield { type: "complete" };
      },
    }],
    ["tool.execute", {
      mode: "stream",
      async *handle() {
        executions++;
        yield { type: "result", result: "synthetic-result" };
      },
    }],
  ]);
  for (const [name, operation] of persistenceOperations) operations.set(name, operation);
  const broker = createExecutorChannel({
    binding,
    operations,
    transport: { readable: toBroker.readable, writable: toExecutor.writable },
  });
  const executor = createExecutorChannel({
    binding,
    transport: { readable: toExecutor.readable, writable: toBroker.writable },
  });
  return {
    broker,
    executor,
    get executions() {
      return executions;
    },
    get writes() {
      return writes;
    },
    async close() {
      broker.close();
      executor.close();
      await Promise.all([broker.settled, executor.settled]);
    },
  };
}

it("constructs model and host/remote tool facades only for the installed IDs", async () => {
  const pair = channels();
  try {
    const facades = await createExecutorRuntimeFacades({
      input: installation(),
      channel: pair.executor,
      signal: pair.executor.signal,
    });
    assertEquals([...facades.hostTools.keys()], ["host"]);
    assertEquals([...facades.remoteToolSources.keys()], ["remote"]);
    const read = facades.hostTools.get("host")!.read!;
    assertEquals(read.inputSchemaJson, { type: "object", properties: {} });
    assertEquals(await read.execute!({}, { toolCallId: "call-1" }), "synthetic-result");
    assertEquals(pair.executions, 1);
    await facades.cleanup();
    await assertRejects(async () => {
      await read.execute!({}, { toolCallId: "late" });
    });
    assertEquals(pair.executions, 1);
  } finally {
    await pair.close();
  }
});

it("rejects an incomplete or expanded tool source grant", async () => {
  for (const sources of [["host"], ["host", "remote", "ungranted"]]) {
    const pair = channels(sources);
    try {
      await assertRejects(() =>
        createExecutorRuntimeFacades({
          input: installation(),
          channel: pair.executor,
          signal: pair.executor.signal,
        })
      );
      assertEquals(pair.executions, 0);
    } finally {
      await pair.close();
    }
  }
});

it("revokes persistence facades on runtime cleanup without closing the shared channel", async () => {
  const pair = channels();
  const input = installation();
  input.capabilities.persistence.toolExposureCheckpoint = "checkpoint";
  try {
    const facades = await createExecutorRuntimeFacades({
      input,
      channel: pair.executor,
      signal: pair.executor.signal,
    });
    const persist = facades.toolExposureCheckpoint!.persist;
    await persist({ version: 1, loadedToolNames: [] });
    await facades.cleanup();
    await assertRejects(async () => {
      await persist({ version: 1, loadedToolNames: [] });
    });
    assertEquals(pair.writes, 1);
    assertEquals(pair.executor.signal.aborted, false);
  } finally {
    await pair.close();
  }
});

it("restores a durable replay checkpoint larger than the installation envelope", async () => {
  const checkpoint: ProviderReplayCheckpoint = {
    version: 1,
    messageId: "message-large",
    provider: "anthropic",
    providerBlocks: [{
      type: "provider-block",
      provider: "anthropic",
      block: { type: "redacted_thinking", data: "x".repeat(70_000) },
    }],
    providerBlockPositions: [0],
    totalPartCount: 1,
    elapsedMs: 12.5,
  };
  const input = installation();
  input.capabilities.persistence.providerReplayCheckpoint = "replay";
  const pair = channels(
    ["host", "remote"],
    createExecutorPersistenceBroker({
      expectedBinding: binding,
      capabilityIds: input.capabilities.persistence,
      persistProviderReplayCheckpoint: () => Promise.resolve(),
      initialProviderReplayCheckpoints: [checkpoint],
    }),
  );
  try {
    const facades = await createExecutorRuntimeFacades({
      input,
      channel: pair.executor,
      signal: pair.executor.signal,
    });
    assertEquals(facades.providerReplayCheckpoint?.initial?.[0]?.messageId, "message-large");
    const data = facades.providerReplayCheckpoint?.initial?.[0]?.providerBlocks[0]?.block.data;
    assert(typeof data === "string");
    assertEquals(data.length, 70_000);
    await facades.cleanup();
  } finally {
    await pair.close();
  }
});
