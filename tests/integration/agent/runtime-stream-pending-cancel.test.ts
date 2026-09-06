import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/index.ts";
import { resolveRuntimeExecutionErrorEvent } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { streamText } from "#veryfront/runtime/runtime-bridge.ts";
import { collectAsync, createStreamModel } from "#veryfront/runtime/runtime-bridge.test-helpers.ts";

async function withLifecycleMode<T>(
  mode: "legacy" | "active",
  run: () => Promise<T>,
): Promise<T> {
  const previous = Deno.env.get("VF_STREAM_LIFECYCLE_MODE");
  Deno.env.set("VF_STREAM_LIFECYCLE_MODE", mode);
  try {
    return await run();
  } finally {
    if (previous === undefined) Deno.env.delete("VF_STREAM_LIFECYCLE_MODE");
    else Deno.env.set("VF_STREAM_LIFECYCLE_MODE", previous);
  }
}

describe("agent runtime pending provider cancellation", () => {
  for (const mode of ["legacy", "active"] as const) {
    for (const cancellationResult of ["resolves", "rejects"] as const) {
      it(`delivers a ${mode} provider error part before pending cancellation ${cancellationResult}`, async () => {
        await withLifecycleMode(mode, async () => {
          let cancelCalls = 0;
          let settleCancellation!: () => void;
          const cancellation = new Promise<void>((resolve, reject) => {
            settleCancellation = cancellationResult === "resolves"
              ? resolve
              : () => reject(new Error("private provider cleanup failure"));
          });
          const providerStream = new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "error",
                error: new Error("provider returned 429"),
              });
              controller.enqueue({ type: "finish", finishReason: "stop", totalUsage: null });
            },
            cancel() {
              cancelCalls += 1;
              return cancellation;
            },
          });
          const model: ModelRuntime = {
            provider: "hosted",
            modelId: `hosted/pending-provider-cancel-${mode}-${cancellationResult}`,
            doGenerate: () => Promise.reject(new Error("generate must not be called")),
            doStream: () => Promise.resolve({ stream: providerStream }),
          };
          const runtimeAgent = agent({
            model: model.modelId,
            system: "Pending provider cancellation test",
            resolveModelTransport: async () => ({ model }),
          });
          const result = await runtimeAgent.stream({ input: "Hello" });
          const bodyPromise = result.toDataStreamResponse().text();
          let timeout: number | undefined;

          try {
            const outcome = await Promise.race([
              bodyPromise.then((body) => ({ kind: "body" as const, body })),
              new Promise<{ kind: "timeout" }>((resolve) => {
                timeout = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
              }),
            ]);

            assertEquals(
              outcome.kind,
              "body",
              "terminal delivery must not wait for provider cleanup",
            );
            if (outcome.kind !== "body") return;

            assertStringIncludes(outcome.body, '"code":"RATE_LIMITED"');
            assertEquals(outcome.body.includes('"type":"message-finish"'), false);
            assertEquals(cancelCalls, 1);
          } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            settleCancellation();
            await bodyPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          assertEquals(providerStream.locked, false);
        });
      });
    }
  }
});

describe("runtime bridge text stream pending provider cancellation", () => {
  it("delivers a provider error before text stream cancellation settles", async () => {
    let cancelCalls = 0;
    let settleCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      settleCancellation = resolve;
    });
    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "error",
          error: new Error("provider returned 429"),
        });
        controller.enqueue({ type: "finish", finishReason: "stop", totalUsage: null });
      },
      cancel() {
        cancelCalls += 1;
        return cancellation;
      },
    });
    const model = createStreamModel(
      "hosted",
      "hosted/pending-text-stream-cancel",
      async () => ({ stream: providerStream }),
    );
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });
    const errorPromise = collectAsync(result.textStream).then(
      () => ({ kind: "fulfilled" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    let timeout: number | undefined;

    try {
      const outcome = await Promise.race([
        errorPromise,
        new Promise<{ kind: "timeout" }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
        }),
      ]);

      assertEquals(outcome.kind, "error", "text terminal must not wait for provider cleanup");
      if (outcome.kind !== "error") return;

      assertEquals(resolveRuntimeExecutionErrorEvent(outcome.error), {
        type: "error",
        error: "Too many requests. Please wait a moment and try again.",
        code: "RATE_LIMITED",
      });
      assertEquals(cancelCalls, 1);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      settleCancellation();
      await errorPromise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(providerStream.locked, false);
  });
});
