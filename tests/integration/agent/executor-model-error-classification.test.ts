import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { ProviderOverloadedError } from "#veryfront/provider/runtime-loader/provider-http.ts";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";

const modelId = "veryfront-cloud/openai/synthetic";
const allowedModelIds = new Set([modelId]);
const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
function overload() {
  return new ProviderOverloadedError({
    provider: "openai",
    status: 529,
    message: "Synthetic private detail",
    retryable: true,
  });
}

describe("executor model agent error classification", () => {
  for (const mode of ["generate", "stream", "midstream"] as const) {
    it(`preserves overload through the real agent ${mode} runtime`, async () => {
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const caller = createExecutorChannel({
        binding,
        transport: { readable: backward.readable, writable: forward.writable },
      });
      const broker = createExecutorChannel({
        binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: createExecutorModelBroker({
          allowedModelIds,
          resolveModelRuntime: () => ({
            provider: "veryfront-cloud",
            modelId: "synthetic",
            modelProvider: "openai",
            doGenerate: () => Promise.reject(overload()),
            doStream() {
              if (mode !== "midstream") return Promise.reject(overload());
              let count = 0;
              return Promise.resolve({
                stream: new ReadableStream({
                  pull(controller) {
                    if (count++ === 0) {
                      controller.enqueue({ type: "text-delta", text: "Synthetic prefix" });
                    } else controller.error(overload());
                  },
                }, { highWaterMark: 0 }),
              });
            },
          }),
        }),
      });
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: caller,
          allowedModelIds,
        });
        const runtime = new AgentRuntime("synthetic-agent", {
          model: modelId,
          system: "Synthetic system",
          maxSteps: 1,
        }, { resolveModelRuntime: resolver });
        if (mode === "generate") {
          const error = await assertRejects(() => runtime.generate("Synthetic prompt"));
          assertEquals(parseProviderError(error).code, "OVERLOADED_ERROR");
          assertEquals(snapshotVeryfrontError(error)?.status, 503);
        } else {
          const stream = await runtime.stream([{
            id: "message-test",
            role: "user",
            parts: [{ type: "text", text: "Synthetic prompt" }],
            timestamp: 1,
          }]);
          const output = await new Response(stream).text();
          assert(output.includes('"code":"OVERLOADED_ERROR"'));
          assertEquals(output.includes("Synthetic private detail"), false);
        }
      } finally {
        caller.close();
        await broker.closed;
      }
    });
  }
});
