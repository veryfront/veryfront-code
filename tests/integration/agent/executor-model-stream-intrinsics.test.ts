import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";

describe("managed model private stream construction", () => {
  for (const probe of ["stream constructor", "own-property check"]) {
    it(`keeps model output out of a replaced ${probe}`, async () => {
      const marker = "synthetic-private-managed-model-output";
      const modelId = "veryfront-cloud/openai/synthetic-model";
      const NativeReadableStream = ReadableStream;
      const hasOwn = Object.hasOwn;
      const source = new NativeReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", delta: marker });
          controller.close();
        },
      });
      const binding = { allocationId: "model-stream", invocationId: "model-stream", generation: 1 };
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const allowedModelIds = new Set([modelId]);
      const broker = createExecutorChannel({
        binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: createExecutorModelBroker({
          allowedModelIds,
          resolveModelRuntime: () => ({
            specificationVersion: "v3",
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
      let observations = 0;
      let chunks: unknown[] = [];
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: executor,
          allowedModelIds,
        });
        if (probe === "own-property check") {
          Object.hasOwn = (value, property) => {
            if ((value as { delta?: unknown })?.delta === marker) observations++;
            return hasOwn(value, property);
          };
        } else {globalThis.ReadableStream = new Proxy(NativeReadableStream, {
            construct(target, args) {
              const underlying = args[0] as UnderlyingDefaultSource<unknown>;
              const pull = underlying.pull;
              const wrapped = {
                ...underlying,
                pull(controller: ReadableStreamDefaultController<unknown>) {
                  const facade = {
                    enqueue(chunk: unknown) {
                      if (JSON.stringify(chunk)?.includes(marker)) observations++;
                      controller.enqueue(chunk);
                    },
                    close: () => controller.close(),
                    error: (error: unknown) => controller.error(error),
                    get desiredSize() {
                      return controller.desiredSize;
                    },
                  };
                  return pull === undefined ? undefined : Reflect.apply(pull, underlying, [facade]);
                },
              };
              return Reflect.construct(target, [wrapped, args[1]]);
            },
          });}
        const result = await resolver(modelId)!.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Synthetic input" }] }],
        });
        chunks = await Array.fromAsync(result.stream);
      } finally {
        globalThis.ReadableStream = NativeReadableStream;
        Object.hasOwn = hasOwn;
        executor.close();
        broker.close();
        await Promise.all([executor.settled, broker.settled]);
      }
      assertEquals(chunks, [{ type: "text-delta", delta: marker }]);
      assertEquals(observations, 0);
    });
  }
});
