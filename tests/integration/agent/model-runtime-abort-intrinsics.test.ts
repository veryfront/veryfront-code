import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortScope,
  registerModelRuntimeResolverRevoker,
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
