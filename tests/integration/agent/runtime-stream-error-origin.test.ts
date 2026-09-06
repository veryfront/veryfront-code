import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent, runWithRunEventSink } from "#veryfront/agent/index.ts";
import type { Agent } from "#veryfront/agent/types.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { defineError } from "#veryfront/errors";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createSSECollector } from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import {
  createRuntimeStreamSource,
  createStreamState,
  processStream,
  resolveRuntimeExecutionErrorEvent,
  withRuntimeProviderStreamErrorProvenance,
} from "#veryfront/agent/runtime/chat-stream-handler.ts";

const PROVIDER_FAILURES = [
  {
    message: "provider capacity exceeded",
    expected: {
      type: "error",
      code: "OVERLOADED_ERROR",
      error: "The LLM provider is currently overloaded",
    },
  },
  {
    message: "provider returned 429",
    expected: {
      type: "error",
      code: "RATE_LIMITED",
      error: "Too many requests. Please wait a moment and try again.",
    },
  },
] as const;

const PRIVATE_PROVIDER_ERROR = defineError({
  slug: "provider-private-runtime-test",
  category: "GENERAL",
  title: "Provider private runtime test",
  status: 500,
});

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

async function captureFailure(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function streamBody(
  runtimeAgent: Agent<never>,
  onFinish?: () => void,
): Promise<string> {
  const result = await runtimeAgent.stream({
    input: "Hello",
    ...(onFinish ? { onFinish } : {}),
  });
  return await result.toDataStreamResponse().text();
}

describe("agent runtime stream error provenance", () => {
  it("preserves private-field model receivers while adding provenance", async () => {
    class PrivateFieldModel implements ModelRuntime {
      readonly [key: string]: unknown;
      readonly #modelId = "hosted/private-field-provenance";
      #streamCalls = 0;

      get modelId(): string {
        return this.#modelId;
      }

      get provider(): string {
        return "hosted";
      }

      doGenerate() {
        return Promise.reject(new Error("generate must not be called"));
      }

      doStream() {
        this.#streamCalls += 1;
        return Promise.resolve({ stream: new ReadableStream() });
      }

      get streamCalls(): number {
        return this.#streamCalls;
      }
    }

    const model = new PrivateFieldModel();
    Object.defineProperty(model, "doStream", {
      configurable: false,
      value: model.doStream.bind(model),
      writable: false,
    });
    const wrapped = withRuntimeProviderStreamErrorProvenance(model);

    assertEquals(wrapped.modelId, model.modelId);
    await wrapped.doStream({});
    assertEquals(model.streamCalls, 1);
  });

  it("releases provider reader locks after completion, failure, and cancellation", async () => {
    const completedSource = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const failedSource = new ReadableStream({
      start(controller) {
        controller.error(new Error("private provider read failure"));
      },
    });
    let cancelCount = 0;
    let cancelReason: unknown;
    const cancelledSource = new ReadableStream({
      cancel(reason) {
        cancelCount += 1;
        cancelReason = reason;
      },
    });
    const sources = [completedSource, failedSource, cancelledSource];
    let call = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/provider-reader-release",
      doGenerate: () => Promise.reject(new Error("generate must not be called")),
      doStream: () => Promise.resolve({ stream: sources[call++]! }),
    };
    const wrapped = withRuntimeProviderStreamErrorProvenance(model);

    const completedReader = (await wrapped.doStream({})).stream.getReader();
    assertEquals((await completedReader.read()).done, true);
    completedReader.releaseLock();
    assertEquals(completedSource.locked, false);

    const failedReader = (await wrapped.doStream({})).stream.getReader();
    await captureFailure(async () => {
      await failedReader.read();
    });
    failedReader.releaseLock();
    assertEquals(failedSource.locked, false);

    const cancelledReader = (await wrapped.doStream({})).stream.getReader();
    await cancelledReader.cancel("consumer stopped");
    cancelledReader.releaseLock();
    assertEquals(cancelledSource.locked, false);
    assertEquals(cancelCount, 1);
    assertEquals(cancelReason, "consumer stopped");
  });

  it("does not read ahead of a provider stream consumer", async () => {
    let providerPulls = 0;
    const providerStream = new ReadableStream(
      {
        pull() {
          providerPulls += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/provider-backpressure",
      doGenerate: () => Promise.reject(new Error("generate must not be called")),
      doStream: () => Promise.resolve({ stream: providerStream }),
    };

    const wrapped = await withRuntimeProviderStreamErrorProvenance(model).doStream({});
    await Promise.resolve();
    assertEquals(providerPulls, 0);

    const reader = wrapped.stream.getReader();
    const read = reader.read();
    await Promise.resolve();
    assertEquals(providerPulls, 1);
    await reader.cancel("consumer stopped");
    assertEquals((await read).done, true);
    reader.releaseLock();
    assertEquals(providerStream.locked, false);
  });

  it("keeps ignoring a late provider body-read failure after a completed legacy step", async () => {
    await withLifecycleMode("legacy", async () => {
      let pullCount = 0;
      const model: ModelRuntime = {
        provider: "hosted",
        modelId: "hosted/late-provider-read",
        doGenerate: () => Promise.reject(new Error("generate must not be called")),
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              pull(controller) {
                pullCount += 1;
                if (pullCount === 1) {
                  controller.enqueue({ type: "text-delta", text: "done" });
                } else if (pullCount === 2) {
                  controller.enqueue({ type: "finish", finishReason: "stop", totalUsage: null });
                } else {
                  controller.error(new Error("error reading a body from connection"));
                }
              },
            }),
          }),
      };
      const runtimeAgent = agent({
        model: model.modelId,
        system: "Late body read provenance test",
        resolveModelTransport: async () => ({ model }),
      });

      const body = await streamBody(runtimeAgent);

      assertStringIncludes(body, '"delta":"done"');
      assertEquals(body.includes('"type":"error"'), false);
    });
  });

  it("contains hostile application errors without consulting Proxy hooks", () => {
    const applicationError = new Proxy(new Error("original fallback"), {
      getPrototypeOf() {
        throw new Error("hostile getPrototypeOf");
      },
    });

    assertEquals(resolveRuntimeExecutionErrorEvent(applicationError), {
      type: "error",
      error: "Unknown error",
    });
  });

  for (const mode of ["legacy", "active"] as const) {
    it(`does not classify ${mode} middleware application failures as provider errors`, async () => {
      await withLifecycleMode(mode, async () => {
        const model = scriptedModel([{ text: "must not run" }], {
          modelId: `hosted/middleware-error-origin-${mode}`,
          only: "stream",
        });
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Middleware error provenance test",
          middleware: [async () => {
            throw new Error("database capacity exceeded");
          }],
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent);

        assertStringIncludes(body, '"error":"database capacity exceeded"');
        assertEquals(body.includes("OVERLOADED_ERROR"), false);
        assertEquals(model.callCount, 0);
      });
    });

    it(`does not classify ${mode} completion callback failures as provider errors`, async () => {
      await withLifecycleMode(mode, async () => {
        const model = scriptedModel([{ text: "done" }], {
          modelId: `hosted/on-finish-error-origin-${mode}`,
          only: "stream",
        });
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Completion callback error provenance test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent, () => {
          throw new Error("job 429 persistence failed");
        });

        assertStringIncludes(body, '"error":"job 429 persistence failed"');
        assertEquals(body.includes("RATE_LIMITED"), false);
        assertEquals(model.callCount, 1);
      });
    });

    it(`does not classify ${mode} run-event sink failures as provider errors`, async () => {
      await withLifecycleMode(mode, async () => {
        const model = scriptedModel([{ text: "must not run" }], {
          modelId: `hosted/run-event-error-origin-${mode}`,
          only: "stream",
        });
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Run-event error provenance test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await runWithRunEventSink(
          () => Promise.reject(new Error("database capacity exceeded")),
          () => streamBody(runtimeAgent),
        );

        assertStringIncludes(body, '"error":"database capacity exceeded"');
        assertEquals(body.includes("OVERLOADED_ERROR"), false);
        assertEquals(model.callCount, 0);
      });
    });

    it(`does not classify ${mode} source-open application failures as provider errors`, async () => {
      const { controller, encoder } = createSSECollector();
      const failure = await captureFailure(() =>
        processStream(
          createRuntimeStreamSource(() => {
            throw new Error(PROVIDER_FAILURES[0].message);
          }),
          createStreamState(),
          controller,
          encoder,
          "provider-error",
          { streamLifecycleMode: mode },
        )
      );

      assertEquals(resolveRuntimeExecutionErrorEvent(failure), {
        type: "error",
        error: PROVIDER_FAILURES[0].message,
      });
    });

    it(`preserves ${mode} attachment validation failures before provider dispatch`, async () => {
      await withLifecycleMode(mode, async () => {
        const model = scriptedModel([{ text: "must not run" }], {
          modelId: `hosted/attachment-error-origin-${mode}`,
          only: "stream",
        });
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Attachment validation provenance test",
          resolveModelTransport: async () => ({ model }),
        });

        const result = await runtimeAgent.stream({
          messages: [{
            id: "attachment-message",
            role: "user",
            parts: [{
              type: "file",
              filename: "capacity.png",
              mediaType: "image/png",
              url: "http://localhost/file",
            }],
          }],
        });
        const body = await result.toDataStreamResponse().text();

        assertStringIncludes(body, 'Attachment \\"capacity.png\\" cannot be sent to the model');
        assertEquals(body.includes("OVERLOADED_ERROR"), false);
        assertEquals(model.callCount, 0);
      });
    });

    it(`preserves ${mode} doStream rejection as a provider failure`, async () => {
      await withLifecycleMode(mode, async () => {
        for (const providerFailure of PROVIDER_FAILURES) {
          const model: ModelRuntime = {
            provider: "hosted",
            modelId: `hosted/provider-rejection-${mode}`,
            doGenerate: () => Promise.reject(new Error("generate must not be called")),
            doStream: () => Promise.reject(new Error(providerFailure.message)),
          };
          const runtimeAgent = agent({
            model: model.modelId,
            system: "Provider rejection provenance test",
            resolveModelTransport: async () => ({ model }),
          });

          const body = await streamBody(runtimeAgent);

          assertStringIncludes(body, `"error":"${providerFailure.expected.error}"`);
          assertStringIncludes(body, `"code":"${providerFailure.expected.code}"`);
        }
      });
    });

    it(`redacts unknown ${mode} provider rejection details`, async () => {
      await withLifecycleMode(mode, async () => {
        const privateMarker = `private-provider-token-${mode}`;
        const model: ModelRuntime = {
          provider: "hosted",
          modelId: `hosted/provider-private-rejection-${mode}`,
          doGenerate: () => Promise.reject(new Error("generate must not be called")),
          doStream: () => Promise.reject(new Error(privateMarker)),
        };
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Provider rejection privacy test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent);

        assertStringIncludes(body, '"error":"Provider stream failed"');
        assertEquals(body.includes(privateMarker), false);
        assertEquals(body.includes('"code"'), false);
      });
    });

    it(`redacts ${mode} provider-owned VeryfrontError details`, async () => {
      await withLifecycleMode(mode, async () => {
        const privateMarker = `private-provider-veryfront-error-${mode}`;
        const model: ModelRuntime = {
          provider: "hosted",
          modelId: `hosted/provider-private-veryfront-error-${mode}`,
          doGenerate: () => Promise.reject(new Error("generate must not be called")),
          doStream: () => Promise.reject(PRIVATE_PROVIDER_ERROR.create({ detail: privateMarker })),
        };
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Provider VeryfrontError privacy test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent);

        assertStringIncludes(body, '"error":"Provider stream failed"');
        assertEquals(body.includes(privateMarker), false);
        assertEquals(body.includes('"code"'), false);
      });
    });

    it(`redacts ${mode} provider-part normalization failures`, async () => {
      await withLifecycleMode(mode, async () => {
        const privateMarker = `private-provider-part-${mode}`;
        const providerPart = Object.defineProperty({}, "type", {
          enumerable: true,
          get() {
            throw new Error(privateMarker);
          },
        });
        const model: ModelRuntime = {
          provider: "hosted",
          modelId: `hosted/provider-part-private-${mode}`,
          doGenerate: () => Promise.reject(new Error("generate must not be called")),
          doStream: () =>
            Promise.resolve({
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue(providerPart);
                  controller.close();
                },
              }),
            }),
        };
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Provider part privacy test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent);

        assertStringIncludes(body, '"error":"Provider stream failed"');
        assertEquals(body.includes(privateMarker), false);
        assertEquals(body.includes('"code"'), false);
      });
    });

    it(`redacts ${mode} provider-part decoder failures`, async () => {
      await withLifecycleMode(mode, async () => {
        const privateMarker = `private-provider-decoder-${mode}`;
        const providerPart = Object.defineProperty({ type: "text-delta" }, "text", {
          enumerable: true,
          get() {
            throw new Error(privateMarker);
          },
        });
        const model: ModelRuntime = {
          provider: "hosted",
          modelId: `hosted/provider-decoder-private-${mode}`,
          doGenerate: () => Promise.reject(new Error("generate must not be called")),
          doStream: () =>
            Promise.resolve({
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue(providerPart);
                  controller.close();
                },
              }),
            }),
        };
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Provider decoder privacy test",
          resolveModelTransport: async () => ({ model }),
        });

        const body = await streamBody(runtimeAgent);

        assertStringIncludes(body, '"error":"Provider stream failed"');
        assertEquals(body.includes(privateMarker), false);
        assertEquals(body.includes('"code"'), false);
      });
    });

    it(`preserves ${mode} provider-stream rejection as a provider failure`, async () => {
      await withLifecycleMode(mode, async () => {
        for (const providerFailure of PROVIDER_FAILURES) {
          const model: ModelRuntime = {
            provider: "hosted",
            modelId: `hosted/provider-stream-rejection-${mode}`,
            doGenerate: () => Promise.reject(new Error("generate must not be called")),
            doStream: () =>
              Promise.resolve({
                stream: new ReadableStream({
                  start(controller) {
                    controller.error(new Error(providerFailure.message));
                  },
                }),
              }),
          };
          const runtimeAgent = agent({
            model: model.modelId,
            system: "Provider stream rejection provenance test",
            resolveModelTransport: async () => ({ model }),
          });

          const body = await streamBody(runtimeAgent);

          assertStringIncludes(body, `"error":"${providerFailure.expected.error}"`);
          assertStringIncludes(body, `"code":"${providerFailure.expected.code}"`);
        }
      });
    });
  }
});
