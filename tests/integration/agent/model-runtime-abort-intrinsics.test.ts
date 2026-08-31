import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortGuard,
  createModelRuntimeResolverAbortScope,
  registerModelRuntimeResolverRevoker,
  revokeModelRuntimeResolver,
} from "#veryfront/agent/runtime/model-transport.ts";

function createModel(modelId: string): ModelRuntime {
  return {
    provider: "test",
    modelId,
    async doGenerate() {
      return {
        content: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream<unknown>() };
    },
  };
}

describe("run-scoped model cancellation intrinsics", () => {
  it("uses the captured ReadableStream constructor for signed inference", async () => {
    const model = scriptedModel([
      { parts: [{ type: "text-delta", text: "complete" }] },
    ], { modelId: "veryfront-cloud/openai/captured-stream-model", only: "stream" });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "captured-stream-runtime",
      {
        model: "veryfront-cloud/openai/captured-stream-model",
        system: "captured stream constructor test",
        maxSteps: 1,
      },
      { resolveModelRuntime: resolver },
    );
    const NativeReadableStream = ReadableStream;
    const streamDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ReadableStream");
    assert(streamDescriptor, "ReadableStream must have a global property descriptor");
    let replacementCalls = 0;
    let stream: ReadableStream<Uint8Array> | undefined;

    try {
      class RetainedReadableStream {
        constructor() {
          replacementCalls++;
        }
      }
      Object.defineProperty(globalThis, "ReadableStream", {
        ...streamDescriptor,
        value: RetainedReadableStream,
      });
      stream = await runtime.stream([{
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      }]);
    } finally {
      Object.defineProperty(globalThis, "ReadableStream", streamDescriptor);
    }

    try {
      assert(stream instanceof NativeReadableStream);
      await new Response(stream).arrayBuffer();
      assertEquals(replacementCalls, 0);
      assertEquals(resolverActive, false);
    } finally {
      revokeModelRuntimeResolver(resolver);
    }
  });

  it("revokes stream authority when Promise.prototype.catch is replaced", async () => {
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "veryfront-cloud/openai/patched-promise-model", only: "stream" });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "patched-promise-runtime",
      {
        model: "veryfront-cloud/openai/patched-promise-model",
        system: "patched promise lease test",
        maxSteps: 1,
      },
      { resolveModelRuntime: resolver },
    );
    const stream = await runtime.stream([{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    }]);
    const reader = stream.getReader();
    const first = await reader.read();
    assertEquals(first.done, false, "the model call must be in flight before cancelling");
    await waitFor(
      () => model.calls[0]?.abortSignal !== undefined,
      { message: "the model call must expose its abort signal before cancelling" },
    );
    const catchDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "catch");
    assert(catchDescriptor, "Promise.prototype.catch must have a property descriptor");

    try {
      Object.defineProperty(Promise.prototype, "catch", {
        ...catchDescriptor,
        value: () => {
          throw new Error("project replaced Promise.prototype.catch");
        },
      });
      await reader.cancel(new DOMException("client disconnected", "AbortError"));
    } finally {
      Object.defineProperty(Promise.prototype, "catch", catchDescriptor);
    }

    assertEquals(resolverActive, false);
  });

  it("revokes a pre-aborted generation through the captured getter", () => {
    const abortController = new AbortController();
    abortController.abort(new DOMException("caller aborted", "AbortError"));
    let resolverActive = true;
    const resolver = () => resolverActive ? createModel("veryfront-cloud/openai/test") : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const abortedDescriptor = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "aborted",
    );
    assert(abortedDescriptor, "AbortSignal.aborted must have a property descriptor");

    let guard: ReturnType<typeof createModelRuntimeResolverAbortGuard> | undefined;
    try {
      Object.defineProperty(AbortSignal.prototype, "aborted", {
        ...abortedDescriptor,
        get: () => false,
      });
      guard = createModelRuntimeResolverAbortGuard(resolver, abortController.signal);
    } finally {
      Object.defineProperty(AbortSignal.prototype, "aborted", abortedDescriptor);
    }

    try {
      assertEquals(resolverActive, false);
    } finally {
      guard?.dispose();
    }
  });

  it("cannot suppress generation abort revocation by replacing event listeners", async () => {
    const modelStarted = Promise.withResolvers<void>();
    const modelStopped = Promise.withResolvers<never>();
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    const model: ModelRuntime = {
      provider: "test",
      modelId: "veryfront-cloud/openai/patched-event-target-model",
      doGenerate() {
        modelStarted.resolve();
        return modelStopped.promise;
      },
      doStream() {
        throw new Error("Expected generation path");
      },
    };
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "patched-event-target-runtime",
      {
        model: "veryfront-cloud/openai/patched-event-target-model",
        system: "patched event target lease test",
        maxSteps: 1,
      },
      { resolveModelRuntime: resolver },
    );
    const abortController = new AbortController();
    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    let generation: Promise<unknown> | undefined;

    try {
      EventTarget.prototype.addEventListener = () => {};
      generation = assertRejects(
        async () =>
          await runtime.generate(
            "Hello",
            undefined,
            undefined,
            undefined,
            abortController.signal,
          ),
        Error,
        "stop patched event target model",
      );
      await modelStarted.promise;
    } finally {
      EventTarget.prototype.addEventListener = nativeAddEventListener;
    }

    abortController.abort(new DOMException("caller aborted", "AbortError"));

    try {
      assertEquals(resolverActive, false);
    } finally {
      modelStopped.reject(new Error("stop patched event target model"));
      await generation;
    }
  });

  it("keeps cancellation on framework intrinsics after AbortController is replaced", () => {
    const nativeAbortController = AbortController;
    const upstreamController = new nativeAbortController();
    let resolverActive = true;
    const resolver = () => resolverActive ? createModel("veryfront-cloud/openai/test") : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AbortController");
    assert(globalDescriptor, "AbortController must have a global property descriptor");

    let scope: ReturnType<typeof createModelRuntimeResolverAbortScope> | undefined;
    try {
      class SuppressedAbortController extends nativeAbortController {
        override abort(): void {}
      }
      Object.defineProperty(globalThis, "AbortController", {
        ...globalDescriptor,
        value: SuppressedAbortController,
      });
      scope = createModelRuntimeResolverAbortScope(resolver, upstreamController.signal);
    } finally {
      Object.defineProperty(globalThis, "AbortController", globalDescriptor);
    }

    const reason = new DOMException("caller aborted", "AbortError");
    upstreamController.abort(reason);

    try {
      assertEquals(resolverActive, false);
      assertEquals(scope.signal.aborted, true);
      assertStrictEquals(scope.signal.reason, reason);
    } finally {
      scope.dispose();
    }
  });
});
