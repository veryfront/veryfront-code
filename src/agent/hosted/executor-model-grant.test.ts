import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorChannel, type ExecutorOperationContext } from "../executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
  type ExecutorModelCallNormalizer,
} from "./executor-model-bridge.ts";
import { throwExecutorModelFailure } from "./executor-model-errors.ts";
import {
  createEphemeralHostedExecutorModelBroker,
  createHostedExecutorModelBroker,
} from "./executor-model-dispatch.ts";
import type { ExecutorModelGrant } from "./executor-model-grant.ts";

const modelId = "veryfront-cloud/openai/synthetic";
const tool = { type: "provider", name: "web_search", id: "openai.web_search", args: {} } as const;
const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
const prompt = [{ role: "user", content: [{ type: "text", text: "Synthetic prompt" }] }];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function grant(overrides: Partial<ExecutorModelGrant> = {}): ExecutorModelGrant {
  return {
    maxCalls: 3,
    maxConcurrentCalls: 1,
    models: new Map([[modelId, { maxOutputTokens: 32, providerTools: [tool] }]]),
    ...overrides,
  };
}

function context(signal = new AbortController().signal): ExecutorOperationContext {
  return { binding, signal, deadline: Date.now() + 5_000 };
}

function request(options: Record<string, unknown> = {}): JsonValue {
  return { modelId, options: { prompt, ...options } } as JsonValue;
}

function fixture(options: {
  grant?: ExecutorModelGrant;
  mode?: "durable" | "ephemeral";
  generate?: ModelRuntime<ModelRuntimeCallOptions>["doGenerate"];
  stream?: ModelRuntime<ModelRuntimeCallOptions>["doStream"];
  persist?: (
    event: { request?: { maxOutputTokens?: number }; messages: unknown[] },
  ) => void | Promise<void>;
} = {}) {
  const received: ModelRuntimeCallOptions[] = [];
  const input = {
    grant: options.grant ?? grant(),
    allowedModelIds: new Set(options.grant?.models.keys() ?? [modelId]),
    scope: { binding, signal: new AbortController().signal, assertActive() {} },
    resolveModelRuntime: () => ({
      provider: "veryfront-cloud",
      modelProvider: "openai",
      modelId: "synthetic",
      doGenerate: options.generate ?? ((value: ModelRuntimeCallOptions) => {
        received.push(value);
        return Promise.resolve({ content: [{ type: "text", text: "Synthetic reply" }] });
      }),
      doStream: options.stream ?? ((value: ModelRuntimeCallOptions) => {
        received.push(value);
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        });
      }),
    }),
  };
  const operations = options.mode === "ephemeral"
    ? createEphemeralHostedExecutorModelBroker({
      ...input,
      prepared: { conversationId: null, canonicalRootRun: null },
    })
    : createHostedExecutorModelBroker({ ...input, runEventSink: options.persist ?? (() => {}) });
  const generate = operations.get("model.generate")!;
  const stream = operations.get("model.stream")!;
  assert(generate.mode === "unary" && stream.mode === "stream");
  return { generate, stream, operations, received };
}

async function resourceLimit(operation: () => unknown | PromiseLike<unknown>) {
  const error = await assertRejects(
    async () => throwExecutorModelFailure(await operation()),
    Error,
  );
  assertEquals(parseProviderError(error).code, "RESOURCE_LIMIT_EXCEEDED");
}

describe("hosted executor model grant", () => {
  it("captures synchronous normalization and isolates normalized options from audit mutation", async () => {
    let normalized: ModelRuntimeCallOptions | undefined;
    let dispatched: ModelRuntimeCallOptions | undefined;
    const options = {
      allowedModelIds: new Set([modelId]),
      resolveModelRuntime: () => ({
        provider: "veryfront-cloud",
        modelProvider: "anthropic",
        modelId: "actual-model",
        runtimeCapabilities: { toolCalling: true },
        doGenerate(value: ModelRuntimeCallOptions) {
          dispatched = value;
          return Promise.resolve({});
        },
        doStream() {
          throw new Error("unused");
        },
      }),
      normalizeModelCall: ((request) => {
        assertEquals(request.model.modelProvider, "anthropic");
        request.model.runtimeCapabilities!.toolCalling = false;
        normalized = { ...request.options, maxOutputTokens: 16 };
        return normalized;
      }) satisfies ExecutorModelCallNormalizer,
      beforeModelDispatch(request: Parameters<ExecutorModelCallNormalizer>[0]) {
        assertEquals(request.model.runtimeCapabilities?.toolCalling, true);
        assertEquals(request.options.maxOutputTokens, 16);
        normalized!.maxOutputTokens = 999;
        request.options.maxOutputTokens = 888;
      },
    };
    const operations = createExecutorModelBroker(options);
    options.normalizeModelCall = () => {
      throw new Error("Replacement must not run");
    };
    const generate = operations.get("model.generate")!;
    assert(generate.mode === "unary");
    await generate.handle(request(), context());
    assertEquals(dispatched?.maxOutputTokens, 16);
  });

  it("refuses invalid normalization and aborts before audit or provider dispatch", async () => {
    for (const invalid of [true, false]) {
      let audits = 0;
      let dispatches = 0;
      const controller = new AbortController();
      const operations = createExecutorModelBroker({
        allowedModelIds: new Set([modelId]),
        resolveModelRuntime: () => ({
          provider: "veryfront-cloud",
          modelProvider: "openai",
          modelId: "synthetic",
          doGenerate() {
            dispatches++;
            return Promise.resolve({});
          },
          doStream() {
            throw new Error("unused");
          },
        }),
        normalizeModelCall(call) {
          if (invalid) return { ...call.options, maxOutputTokens: 0 };
          controller.abort();
          return { ...call.options, maxOutputTokens: 16 };
        },
        beforeModelDispatch() {
          audits++;
        },
      });
      const generate = operations.get("model.generate")!;
      assert(generate.mode === "unary");
      await assertRejects(
        async () => await generate.handle(request(), context(controller.signal)),
        Error,
      );
      assertEquals(audits, 0);
      assertEquals(dispatches, 0);
    }
  });
  it("reconstructs resource limits across the invocation channel for generate and stream", async () => {
    const fixtureOperations = fixture({ grant: grant({ maxCalls: 1 }) }).operations;
    const forward = new TransformStream<Uint8Array, Uint8Array>();
    const backward = new TransformStream<Uint8Array, Uint8Array>();
    const caller = createExecutorChannel({
      binding,
      transport: { readable: backward.readable, writable: forward.writable },
    });
    const broker = createExecutorChannel({
      binding,
      operations: fixtureOperations,
      transport: { readable: forward.readable, writable: backward.writable },
    });
    try {
      const resolve = await createExecutorModelRuntimeResolver({
        channel: caller,
        allowedModelIds: new Set([modelId]),
      });
      const model = resolve(modelId)!;
      await resourceLimit(() => model.doGenerate({ prompt: [], maxOutputTokens: 33 }));
      await resourceLimit(() => model.doStream({ prompt: [], maxOutputTokens: 33 }));
      await model.doGenerate({ prompt: [] });
      await resourceLimit(() => model.doGenerate({ prompt: [] }));
      await resourceLimit(() => model.doStream({ prompt: [] }));
    } finally {
      caller.close();
      broker.close();
      await Promise.all([caller.closed, broker.closed]);
    }
  });

  it("shares the invocation call counter across allowed model IDs", async () => {
    const other = "veryfront-cloud/openai/other";
    const policy = { maxOutputTokens: 32, providerTools: [] };
    const { generate } = fixture({
      grant: grant({ maxCalls: 1, models: new Map([[modelId, policy], [other, policy]]) }),
    });
    await generate.handle(request(), context());
    await resourceLimit(() =>
      generate.handle({ modelId: other, options: { prompt: [] } }, context())
    );
  });
  for (const mode of ["durable", "ephemeral"] as const) {
    it(`counts admitted calls across generate and stream in ${mode} mode`, async () => {
      const { generate, stream } = fixture({ mode, grant: grant({ maxCalls: 2 }) });
      await generate.handle(request(), context());
      const output = stream.handle(request(), context())[Symbol.asyncIterator]();
      while (!(await output.next()).done) { /* Consume the admitted stream. */ }
      await resourceLimit(() => generate.handle(request(), context()));
    });
  }

  it("applies the granted output default before audit and protects the provider snapshot", async () => {
    let audited: number | undefined;
    const { generate, received } = fixture({
      persist(event) {
        audited = event.request?.maxOutputTokens;
        event.request!.maxOutputTokens = 999;
        event.messages.length = 0;
      },
    });
    await generate.handle(request(), context());
    assertEquals(audited, 32);
    assertEquals(received[0]!.maxOutputTokens, 32);
    assertEquals<unknown>(received[0]!.prompt, prompt);
    await resourceLimit(() => generate.handle(request({ maxOutputTokens: 33 }), context()));
  });

  it("reserves before asynchronous and reentrant audit calls", async () => {
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    let reentrant: Promise<void> | undefined;
    let first = true;
    const { generate } = fixture({
      persist() {
        if (first) {
          first = false;
          reentrant = resourceLimit(() => generate.handle(request(), context()));
        }
        entered.resolve();
        return persisted.promise;
      },
    });
    const pending = generate.handle(request(), context());
    try {
      await entered.promise;
      await reentrant;
      await resourceLimit(() => generate.handle(request(), context()));
    } finally {
      persisted.resolve();
      await pending;
    }
  });

  it("counts admitted provider failures and audit failures without refunding calls", async () => {
    for (const failure of ["provider", "audit"] as const) {
      const { generate } = fixture({
        grant: grant({ maxCalls: 1 }),
        ...(failure === "provider"
          ? { generate: () => Promise.reject(new Error("Synthetic failure")) }
          : { persist: () => Promise.reject(new Error("Synthetic failure")) }),
      });
      await assertRejects(async () => await generate.handle(request(), context()), Error);
      await resourceLimit(() => generate.handle(request(), context()));
    }
  });

  it("keeps concurrency occupied while cancelled generation remains unsettled", async () => {
    const started = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const controller = new AbortController();
    let calls = 0;
    const { generate } = fixture({
      generate: async () => {
        if (++calls > 1) return { content: [] };
        started.resolve();
        await cleanup.promise;
        throw new Error("Synthetic cancellation cleanup");
      },
    });
    const pending = Promise.resolve(generate.handle(request(), context(controller.signal)));
    void pending.catch(() => {});
    try {
      await started.promise;
      controller.abort();
      await resourceLimit(() => generate.handle(request(), context()));
    } finally {
      cleanup.resolve();
      await pending.catch(() => {});
    }
    await generate.handle(request(), context());
    await generate.handle(request(), context());
    await resourceLimit(() => generate.handle(request(), context()));
  });

  it("joins original audit cleanup before releasing a cancelled call slot", async () => {
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    const controller = new AbortController();
    let audits = 0;
    const { generate, received } = fixture({
      persist() {
        if (++audits > 1) return;
        entered.resolve();
        return persisted.promise;
      },
    });
    const pending = Promise.resolve(generate.handle(request(), context(controller.signal)));
    void pending.catch(() => {});
    try {
      await entered.promise;
      controller.abort();
      await tick();
      await resourceLimit(() => generate.handle(request(), context()));
      assertEquals(received.length, 0);
    } finally {
      persisted.resolve();
      await pending.catch(() => {});
    }
    await generate.handle(request(), context());
    assertEquals(received.length, 1);
  });

  it("keeps concurrency occupied until the original stream cancellation settles", async () => {
    const cleanup = Promise.withResolvers<void>();
    const cancelling = Promise.withResolvers<void>();
    const controller = new AbortController();
    const { generate, stream, received } = fixture({
      stream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            cancel() {
              cancelling.resolve();
              return cleanup.promise;
            },
          }, { highWaterMark: 0 }),
        }),
    });
    const iterator = stream.handle(request(), context(controller.signal))[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    void pending.catch(() => {});
    controller.abort();
    try {
      await cancelling.promise;
      await tick();
      await resourceLimit(() => generate.handle(request(), context()));
    } finally {
      cleanup.resolve();
      await pending.catch(() => {});
      await iterator.return?.().catch(() => {});
    }
    await generate.handle(request(), context());
    assertEquals(received.length, 1);
  });

  it("pins the copied model policy and exact provider tool descriptors", async () => {
    const mutableArgs = { searchContextSize: "low" };
    const mutableTool = {
      type: "provider",
      name: "web_search",
      id: "openai.web_search",
      args: mutableArgs,
    } as const;
    const allowedTool = { ...mutableTool, args: { ...mutableArgs } };
    const policy = { maxOutputTokens: 32, providerTools: [mutableTool] };
    const configured = grant({ models: new Map([[modelId, policy]]) });
    const { generate, received } = fixture({ grant: configured });
    policy.maxOutputTokens = 999;
    policy.providerTools.length = 0;
    mutableArgs.searchContextSize = "high";
    await generate.handle(request({ tools: [allowedTool] }), context());
    assertEquals(received[0]!.maxOutputTokens, 32);
    for (
      const changed of [
        { ...allowedTool, id: "openai.other" },
        { ...allowedTool, name: "other" },
        { ...allowedTool, args: { searchContextSize: "high" } },
        {
          ...allowedTool,
          args: {
            searchContextSize: "low",
            url: "https://example.com",
            authorization: "synthetic",
          },
        },
      ]
    ) {
      await assertRejects(
        async () => await generate.handle(request({ tools: [changed] }), context()),
        Error,
      );
    }
    await assertRejects(
      async () => await generate.handle(request({ tools: [allowedTool, allowedTool] }), context()),
      Error,
    );
    await assertRejects(
      async () =>
        await generate.handle(
          { modelId: "veryfront-cloud/openai/other", options: { prompt } },
          context(),
        ),
      Error,
    );
    assertEquals(received.length, 1);
  });

  it("requires an exact grant for every allowed model and positive safe integer limits", () => {
    for (
      const invalid of [
        undefined,
        grant({ maxCalls: 0 }),
        grant({ maxConcurrentCalls: 1.5 }),
        grant({ models: new Map() }),
        grant({ models: new Map([[modelId, { maxOutputTokens: 0, providerTools: [] }]]) }),
      ]
    ) {
      assertThrows(() =>
        createEphemeralHostedExecutorModelBroker({
          grant: invalid!,
          allowedModelIds: new Set([modelId]),
          scope: { binding, signal: new AbortController().signal, assertActive() {} },
          prepared: { conversationId: null, canonicalRootRun: null },
          resolveModelRuntime: () => undefined,
        }), TypeError);
    }
  });
});
