import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";
import {
  createToolExecutionDataEventBridgeStream,
  type ToolExecutionDataEventPublisher,
} from "#veryfront/agent/streaming/tool-execution-data-event-bridge.ts";

for (const hooks of [false, true]) {
  describe(`private output ownership ${hooks ? "hooks" : "baseline"}`, () => {
    it("checks managed model chunks without a mutable Object.hasOwn call", async () => {
      const marker = "synthetic-private-owned-model-output";
      const modelId = "veryfront-cloud/openai/synthetic-model";
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", delta: marker });
          controller.close();
        },
      });
      const binding = { allocationId: "own-model", invocationId: "own-model", generation: 1 };
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const allowedModelIds = new Set([modelId]);
      const broker = createExecutorChannel({
        binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: createExecutorModelBroker({
          allowedModelIds,
          resolveModelRuntime: () => ({
            modelId: "synthetic-model",
            provider: "openai",
            doGenerate: () => Promise.reject(new Error("Unexpected generation")),
            doStream: () => Promise.resolve({ stream: source }),
          }),
        }),
      });
      const executor = createExecutorChannel({
        binding,
        transport: { readable: backward.readable, writable: forward.writable },
      });
      const hasOwn = Object.hasOwn;
      const descriptor = Object.getOwnPropertyDescriptor;
      let observations = 0;
      let chunks: unknown[] = [];
      try {
        const resolve = await createExecutorModelRuntimeResolver({
          channel: executor,
          allowedModelIds,
        });
        if (hooks) {
          Object.hasOwn = function (value, key) {
            if (
              value !== null && typeof value === "object" &&
              descriptor(value, "delta")?.value === marker
            ) observations++;
            return hasOwn(value, key);
          };
        }
        const result = await resolve(modelId)!.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Synthetic input" }] }],
        });
        chunks = await Array.fromAsync(result.stream);
      } finally {
        if (hooks) Object.hasOwn = hasOwn;
        executor.close();
        broker.close();
        await Promise.all([executor.settled, broker.settled]);
      }
      assertEquals(chunks, [{ type: "text-delta", delta: marker }]);
      assertEquals(observations, 0);
    });

    it("publishes named tool values without exposing the event to an own-property hook", async () => {
      const event = {
        type: "data",
        name: "synthetic",
        value: { text: "synthetic-private-owned-event" },
      };
      let baseController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const baseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          baseController = controller;
        },
      });
      let publish: ToolExecutionDataEventPublisher | undefined;
      const stream = createToolExecutionDataEventBridgeStream({
        baseStream,
        installPublisher: (next) => {
          publish = next;
        },
      });
      const hasOwn = Object.hasOwn;
      let observations = 0;
      try {
        if (hooks) {
          Object.hasOwn = function (value, key) {
            if (value === event) observations++;
            return hasOwn(value, key);
          };
        }
        publish?.(event);
      } finally {
        if (hooks) Object.hasOwn = hasOwn;
        baseController?.close();
      }
      const body = await new Response(stream).text();
      assertStringIncludes(body, '"type":"data-synthetic"');
      assertStringIncludes(body, '"text":"synthetic-private-owned-event"');
      assertEquals(observations, 0);
    });
  });
}
