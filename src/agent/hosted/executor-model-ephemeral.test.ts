import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import { createExecutorModelRuntimeResolver } from "./executor-model-bridge.ts";
import {
  createEphemeralHostedExecutorModelBroker,
  createHostedExecutorModelBroker,
} from "./executor-model-dispatch.ts";

const modelId = "veryfront-cloud/openai/synthetic";
const allowedModelIds = new Set([modelId]);
const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
const prepared = { conversationId: null, canonicalRootRun: null };

function pair(operations: ReadonlyMap<string, ExecutorOperation>) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    caller,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

function setup() {
  const lifetime = new AbortController();
  let calls = 0;
  const options = {
    grant: {
      maxCalls: 3,
      maxConcurrentCalls: 1,
      models: new Map([[modelId, { maxOutputTokens: 32, providerTools: [] }]]),
    },
    allowedModelIds,
    scope: {
      binding,
      signal: lifetime.signal,
      assertActive() {
        lifetime.signal.throwIfAborted();
      },
    },
    resolveModelRuntime: () => ({
      modelId: "synthetic",
      provider: "veryfront-cloud",
      modelProvider: "openai",
      doGenerate() {
        calls++;
        return Promise.resolve({ content: [{ type: "text", text: "Synthetic answer" }] });
      },
      doStream() {
        calls++;
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta", delta: "Synthetic answer" });
              controller.close();
            },
          }),
        });
      },
    }),
  };
  return { options, lifetime, calls: () => calls };
}

describe("ephemeral hosted executor model dispatch", () => {
  it("supports verified non-canonical inference without appending canonical events", async () => {
    let appends = 0;
    await runWithMandatoryRunEventSink(() => {
      appends++;
    }, async () => {
      const fixture = setup();
      const channels = pair(
        createEphemeralHostedExecutorModelBroker({ ...fixture.options, prepared }),
      );
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds,
        });
        const model = resolver(modelId)!;
        await model.prepare?.();
        await model.doGenerate({ prompt: [] });
        const { stream } = await model.doStream({ prompt: [] });
        const reader = stream.getReader();
        assertEquals((await reader.read()).value, {
          type: "text-delta",
          delta: "Synthetic answer",
        });
        assertEquals((await reader.read()).done, true);
        assertEquals(fixture.calls(), 2);
        assertEquals(appends, 0);
      } finally {
        await channels.close();
      }
    });
  });

  it("refuses canonical or unverified state and keeps the durable sink mandatory", () => {
    const { options } = setup();
    for (
      const state of [
        { conversationId: "conversation-test", canonicalRootRun: null },
        { conversationId: null, canonicalRootRun: { runId: "run-test" } },
        { conversationId: null, canonicalRootRun: undefined },
      ]
    ) assertThrows(() => createEphemeralHostedExecutorModelBroker({ ...options, prepared: state }));
    assertThrows(() => createHostedExecutorModelBroker({ ...options, runEventSink: undefined }));
  });

  it("keeps allowlist, control, lifetime, and broker-mode checks in force", async () => {
    const fixture = setup();
    const channels = pair(
      createEphemeralHostedExecutorModelBroker({ ...fixture.options, prepared }),
    );
    try {
      const resolver = await createExecutorModelRuntimeResolver({
        channel: channels.caller,
        allowedModelIds,
      });
      const model = resolver(modelId)!;
      await assertRejects(
        () =>
          channels.caller.request("model.generate", {
            modelId,
            options: { prompt: [] },
            mode: "ephemeral",
          }),
        Error,
        "operation-failed",
      );
      await assertRejects(
        async () =>
          await model.doGenerate({ prompt: [], providerOptions: { openai: { messages: [] } } }),
        Error,
        "operation-failed",
      );
      assertThrows(() => resolver("veryfront-cloud/openai/other"));
      fixture.lifetime.abort();
      await assertRejects(async () => await model.doGenerate({ prompt: [] }));
      assertEquals(fixture.calls(), 0);
    } finally {
      await channels.close();
    }
  });
});
