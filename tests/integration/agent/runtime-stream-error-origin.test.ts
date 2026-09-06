import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent, runWithRunEventSink } from "#veryfront/agent/index.ts";
import type { Agent } from "#veryfront/agent/types.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
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

    it(`preserves ${mode} source-open provider failures`, async () => {
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

      assertEquals(resolveRuntimeExecutionErrorEvent(failure), PROVIDER_FAILURES[0].expected);
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
