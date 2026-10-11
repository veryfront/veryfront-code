import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  AgentRunEventSink,
  AgentRunModelCallContextEvent,
} from "#veryfront/runtime/model-call-context.ts";
import type { AgentRunEvent } from "#veryfront/runtime/model-call-context.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { DurableRunEventPersistenceError } from "#veryfront/agent/conversation/private-run-event.ts";
import {
  registerVeryfrontCloudModelFacts,
  type VeryfrontCloudModelFacts,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { generateText, streamText } from "#veryfront/runtime/runtime-bridge.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import {
  collectAsync,
  createGenerateModel,
  createStreamModel,
} from "#veryfront/runtime/runtime-bridge.test-helpers.ts";

function assertModelCallContextEvent(
  event: AgentRunEvent | undefined,
): asserts event is AgentRunModelCallContextEvent {
  assertEquals(event?.type, "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
}

async function withSkippedCaptureControlIteration(
  callback: () => Promise<void>,
): Promise<void> {
  const originalIterator = Array.prototype[Symbol.iterator];
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    ...descriptor,
    value: function (this: unknown[]) {
      // Yield nothing for the exact-capture control list; delegate everything else.
      if (this.length === 5 && this[2] === "providerOptions") {
        return Reflect.apply(originalIterator, [], []);
      }
      return Reflect.apply(originalIterator, this, []);
    },
  });
  try {
    await callback();
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
}

describe("runtime-bridge exact capture control intrinsic boundaries", () => {
  it("keeps stream failure observation on captured stream intrinsics after provider dispatch", async () => {
    const events: AgentRunEvent[] = [];
    const NativeReadableStream = globalThis.ReadableStream;
    const readableStreamDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ReadableStream");
    const enqueueDescriptor = Object.getOwnPropertyDescriptor(
      ReadableStreamDefaultController.prototype,
      "enqueue",
    );
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      ReadableStreamDefaultController.prototype,
      "close",
    );
    const errorDescriptor = Object.getOwnPropertyDescriptor(
      ReadableStreamDefaultController.prototype,
      "error",
    );
    const model = createStreamModel(
      "test",
      "test/post-dispatch-stream-intrinsic-mutation",
      async () => {
        const stream = new NativeReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: "text-delta", delta: "ok" });
            controller.close();
          },
        });
        Object.defineProperty(globalThis, "ReadableStream", {
          configurable: true,
          writable: true,
          value: function PoisonedReadableStream() {
            throw new Error("poisoned global ReadableStream constructor was used");
          },
        });
        Object.defineProperty(ReadableStreamDefaultController.prototype, "enqueue", {
          configurable: true,
          writable: true,
          value() {
            throw new Error("poisoned controller enqueue was used");
          },
        });
        Object.defineProperty(ReadableStreamDefaultController.prototype, "close", {
          configurable: true,
          writable: true,
          value() {
            throw new Error("poisoned controller close was used");
          },
        });
        Object.defineProperty(ReadableStreamDefaultController.prototype, "error", {
          configurable: true,
          writable: true,
          value() {
            throw new Error("poisoned controller error was used");
          },
        });
        return { stream };
      },
    );

    try {
      const chunks = await runWithMandatoryRunEventSink(
        (event) => {
          events.push(event);
        },
        () =>
          collectAsync(
            streamText({ model, messages: [{ role: "user", content: "Hello" }] }).fullStream,
          ),
      );

      assertEquals(chunks, [{ type: "text-delta", text: "ok" }]);
      assertEquals(events.map((event) => event.type), [
        "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
      ]);
    } finally {
      if (readableStreamDescriptor) {
        Object.defineProperty(globalThis, "ReadableStream", readableStreamDescriptor);
      }
      if (enqueueDescriptor) {
        Object.defineProperty(
          ReadableStreamDefaultController.prototype,
          "enqueue",
          enqueueDescriptor,
        );
      }
      if (closeDescriptor) {
        Object.defineProperty(ReadableStreamDefaultController.prototype, "close", closeDescriptor);
      }
      if (errorDescriptor) {
        Object.defineProperty(ReadableStreamDefaultController.prototype, "error", errorDescriptor);
      }
    }
  });

  it("refuses unrepresented provider controls after Array iterator replacement", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const canonicalRunId = "22222222-2222-4222-8222-222222222222";
    let dispatches = 0;
    const sink: AgentRunEventSink = (event) => {
      assertModelCallContextEvent(event);
      return {
        eventId: "9007199254740993",
        projectId,
        runId: canonicalRunId,
        modelCallId: event.modelCallId ?? "33333333-3333-4333-8333-333333333333",
      };
    };
    bindRuntimeObservationWriterCapability(
      sink,
      createRuntimeObservationWriterCapability({
        scope: { runId: "33333333-3333-4333-8333-333333333333", canonicalRunId, projectId },
      }),
    );
    const model: ModelRuntime = createGenerateModel(
      "veryfront-cloud",
      "veryfront-cloud/openai/gpt-test",
      async () => {
        dispatches += 1;
        return { content: [], finishReason: "stop", usage: {} };
      },
    );
    const facts = {
      provider: "openai",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    } satisfies VeryfrontCloudModelFacts;
    registerVeryfrontCloudModelFacts(model, () => facts);

    await withSkippedCaptureControlIteration(async () => {
      await assertRejects(
        async () =>
          await runWithMandatoryRunEventSink(
            sink,
            async () =>
              await generateText({
                model,
                messages: [{ role: "user", content: "Hello" }],
                providerOptions: { "veryfront-cloud": { extra: true } },
              }),
          ),
        DurableRunEventPersistenceError,
        "Exact model call capture does not support these provider controls: providerOptions",
      );
    });
    assertEquals(dispatches, 0);
  });
});
