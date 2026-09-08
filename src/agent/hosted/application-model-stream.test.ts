import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel } from "../executor/channel.ts";
import { createExecutorModelBroker } from "./executor-model-bridge.ts";
import { scopeApplicationModelStream } from "./application-model-stream.ts";

const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
const modelId = "veryfront-cloud/openai/synthetic";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("application model stream ownership", () => {
  for (const preAborted of [false, true]) {
    it(`finalizes an ${preAborted ? "already aborted" : "idle aborted"} stream only after upstream cancellation`, async () => {
      const owner = new AbortController();
      const cleanup = Promise.withResolvers<void>();
      const cancelStarted = Promise.withResolvers<void>();
      let disposals = 0;
      const source = new ReadableStream({
        cancel() {
          cancelStarted.resolve();
          return cleanup.promise;
        },
      }, { highWaterMark: 0 });
      if (preAborted) owner.abort();
      const stream = scopeApplicationModelStream(
        source,
        {
          signal: owner.signal,
          dispose() {
            disposals++;
          },
        },
        () => owner.signal.throwIfAborted(),
        (fn) => fn(),
      );
      const reader = stream.getReader();
      let closed = false;
      const closure = reader.closed.catch(() => {
        closed = true;
      });
      try {
        if (!preAborted) owner.abort();
        await cancelStarted.promise;
        await tick();
        assertEquals(closed, false);
        assertEquals(disposals, 0);
        assertEquals(source.locked, true);
        cleanup.resolve();
        await tick();
        assertEquals(closed, true);
        await closure;
        assertEquals(disposals, 1);
        assertEquals(source.locked, false);
      } finally {
        cleanup.resolve();
        await reader.cancel().catch(() => {});
      }
    });
  }

  for (const stuck of [false, true]) {
    it(`${stuck ? "fences" : "retains"} channel admission while original upstream cancellation is pending`, async () => {
      const cleanup = Promise.withResolvers<void>();
      const cancelStarted = Promise.withResolvers<void>();
      let disposals = 0;
      const source = new ReadableStream({
        cancel() {
          cancelStarted.resolve();
          return cleanup.promise;
        },
      }, { highWaterMark: 0 });
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const caller = createExecutorChannel({
        binding,
        maxConcurrentCalls: 1,
        transport: { readable: backward.readable, writable: forward.writable },
      });
      const broker = createExecutorChannel({
        binding,
        maxConcurrentCalls: 1,
        cancellationTimeoutMs: stuck ? 20 : 5000,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: createExecutorModelBroker({
          allowedModelIds: new Set([modelId]),
          resolveModelRuntime: () => ({
            doGenerate: () => Promise.resolve({}),
            doStream(options: { abortSignal: AbortSignal }) {
              return Promise.resolve({
                stream: scopeApplicationModelStream(
                  source,
                  {
                    signal: options.abortSignal,
                    dispose() {
                      disposals++;
                    },
                  },
                  () => options.abortSignal.throwIfAborted(),
                  (fn) => fn(),
                ),
              });
            },
          }),
        }),
      });
      let returning: Promise<unknown> | undefined;
      try {
        const abort = new AbortController();
        const iterator = caller.stream("model.stream", { modelId, options: { prompt: [] } }, {
          signal: abort.signal,
        });
        await iterator.next();
        abort.abort();
        await assertRejects(() => iterator.next(), Error, "cancelled");
        await cancelStarted.promise;
        let returned = false;
        returning = iterator.return!().then(() => {
          returned = true;
        });
        void returning.catch(() => {});
        await tick();
        assertEquals(returned, false);
        assertEquals(disposals, 0);
        await assertRejects(
          () => caller.request("model.metadata", {}),
          Error,
          "concurrent call limit",
        );
        if (stuck) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          assertEquals(broker.signal.aborted, true);
          assertEquals(
            (await broker.closed).message,
            "Executor handler cancellation deadline exceeded",
          );
          await assertRejects(async () => await returning);
        } else {
          cleanup.resolve();
          await returning;
          assertEquals(disposals, 1);
          assertEquals(source.locked, false);
          await caller.request("model.metadata", {});
        }
      } finally {
        cleanup.resolve();
        await returning?.catch(() => {});
        caller.close();
        await broker.closed;
        await tick();
      }
    });
  }
});
