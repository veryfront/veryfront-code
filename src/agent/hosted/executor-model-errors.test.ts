import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { defineError, snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import {
  ProviderOverloadedError,
  ProviderQuotaError,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { resolveRuntimeStreamErrorEvent } from "../runtime/chat-stream-handler.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "./executor-model-bridge.ts";

const modelId = "veryfront-cloud/openai/synthetic";
const allowedModelIds = new Set([modelId]);
const input = { prompt: [] };
const privateDetail = "Synthetic private upstream detail";

function overload() {
  return new ProviderOverloadedError({
    provider: "openai",
    status: 529,
    message: privateDetail,
    retryable: true,
    retryAfterMs: 9000,
  });
}
function model(
  overrides: Partial<ModelRuntime<ModelRuntimeCallOptions>> = {},
): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    provider: "veryfront-cloud",
    modelId: "synthetic",
    modelProvider: "openai",
    doGenerate: () => Promise.resolve({}),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    ...overrides,
  };
}

async function connected(
  runtime: ModelRuntime,
  operations?: ReadonlyMap<string, ExecutorOperation>,
) {
  const frames: string[] = [];
  const transport = () =>
    new TransformStream<Uint8Array, Uint8Array>({
      transform(value, controller) {
        frames.push(new TextDecoder().decode(value));
        controller.enqueue(value);
      },
    });
  const forward = transport();
  const backward = transport();
  const binding = {
    allocationId: "allocation-test",
    generation: 1,
    invocationId: "invocation-test",
  };
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const receiver = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations: operations ??
      createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => runtime }),
  });
  const resolver = operations
    ? undefined
    : await createExecutorModelRuntimeResolver({ channel: caller, allowedModelIds });
  return {
    caller,
    proxy: resolver?.(modelId),
    frames,
    async close() {
      caller.close();
      await receiver.closed;
    },
  };
}

function assertClassified(error: unknown, code: string, status: number) {
  assertEquals(parseProviderError(error).code, code);
  assertEquals(resolveRuntimeStreamErrorEvent(error).code, code);
  assertEquals(snapshotVeryfrontError(error)?.slug, code.toLowerCase().replaceAll("_", "-"));
  assertEquals(snapshotVeryfrontError(error)?.status, status);
  assert(error instanceof Error);
  assertEquals(error.message.includes(privateDetail), false);
  assertEquals(snapshotVeryfrontError(error)?.cause, undefined);
}

describe("executor curated model failures", () => {
  for (const phase of ["prepare", "generate", "stream setup"] as const) {
    it(`preserves overload classification during ${phase}`, async () => {
      const runtime = model({
        ...(phase === "prepare" ? { prepare: () => Promise.reject(overload()) } : {}),
        ...(phase === "generate" ? { doGenerate: () => Promise.reject(overload()) } : {}),
        ...(phase === "stream setup" ? { doStream: () => Promise.reject(overload()) } : {}),
      });
      const channels = await connected(runtime);
      try {
        const error = await assertRejects(async () => {
          if (phase === "prepare") await channels.proxy!.prepare!();
          else if (phase === "generate") await channels.proxy!.doGenerate(input);
          else await channels.proxy!.doStream(input);
        });
        assertClassified(error, "OVERLOADED_ERROR", 503);
        assertEquals(channels.frames.join("").includes(privateDetail), false);
        assertEquals(channels.frames.join("").includes("retryAfterMs"), false);
      } finally {
        await channels.close();
      }
    });
  }

  it("preserves bounded credit, billing, context, and schema classifications", async () => {
    const cases = [
      {
        error: new Error(
          'Synthetic response {"slug":"insufficient-credits","error":"' + privateDetail + '"}',
        ),
        code: "INSUFFICIENT_CREDITS",
        status: 402,
      },
      {
        error: { responseBody: '{"slug":"resource-limit-exceeded"}' },
        code: "RESOURCE_LIMIT_EXCEEDED",
        status: 402,
      },
      {
        error: new Error("prompt is too long " + privateDetail),
        code: "CONTEXT_LENGTH_EXCEEDED",
        status: 413,
      },
      {
        error: new Error("invalid Veryfront schema " + privateDetail),
        code: "PROJECT_SCHEMA_ERROR",
        status: 400,
      },
      {
        error: new Error("response_format additionalProperties must be false " + privateDetail),
        code: "OUTPUT_SCHEMA_NOT_CLOSED",
        status: 400,
      },
      {
        error: new ProviderQuotaError({
          provider: "openai",
          status: 429,
          message: privateDetail,
          retryable: false,
        }),
        code: "AI_PROVIDER_BILLING_ERROR",
        status: 502,
      },
      {
        error: { type: "rate_limit_error", message: privateDetail },
        code: "RATE_LIMITED",
        status: 429,
      },
      {
        error: new Error("assistant message prefill is unsupported " + privateDetail),
        code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
        status: 400,
      },
      {
        error: { responseBody: '{"error":"AI provider spend limit reached"}' },
        code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
        status: 402,
      },
      {
        error: new Error("workspace API usage limit has been reached " + privateDetail),
        code: "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED",
        status: 502,
      },
    ];
    for (const sample of cases) {
      const channels = await connected(model({ doGenerate: () => Promise.reject(sample.error) }));
      try {
        const error = await assertRejects(async () => await channels.proxy!.doGenerate(input));
        assertClassified(error, sample.code, sample.status);
        assertEquals(channels.frames.join("").includes(privateDetail), false);
      } finally {
        await channels.close();
      }
    }
  });

  for (const fatal of ["throw", "error part", "raw envelope"] as const) {
    it(`preserves midstream ${fatal} classification and cleans up upstream`, async () => {
      let cancelled = false;
      let index = 0;
      const channels = await connected(
        model({
          doStream: () =>
            Promise.resolve({
              stream: new ReadableStream({
                pull(controller) {
                  if (index++ === 0) {
                    controller.enqueue({ type: "text-delta", delta: "Synthetic prefix" });
                  } else if (fatal === "throw") {
                    controller.error(overload());
                  } else {controller.enqueue(
                      fatal === "error part" ? { type: "error", error: overload() } : {
                        type: "raw",
                        rawValue: {
                          type: "error",
                          error: { type: "overloaded_error", message: privateDetail },
                        },
                      },
                    );}
                },
                cancel() {
                  cancelled = true;
                },
              }, { highWaterMark: 0 }),
            }),
        }),
      );
      try {
        const { stream } = await channels.proxy!.doStream(input);
        const reader = stream.getReader();
        assertEquals((await reader.read()).value, {
          type: "text-delta",
          delta: "Synthetic prefix",
        });
        const error = await assertRejects(() => reader.read());
        assertClassified(error, "OVERLOADED_ERROR", 503);
        await reader.cancel().catch(() => {});
        if (fatal !== "throw") assertEquals(cancelled, true);
        assertEquals(channels.frames.join("").includes(privateDetail), false);
      } finally {
        await channels.close();
      }
    });
  }

  it("uses fixed diagnostics for curated registry slugs and ignores unknown registered codes", async () => {
    const known = defineError({
      slug: "insufficient-credits",
      category: "AGENT",
      status: 599,
      title: privateDetail,
    }).create({ cause: privateDetail });
    const channels = await connected(model({ doGenerate: () => Promise.reject(known) }));
    try {
      const error = await assertRejects(async () => await channels.proxy!.doGenerate(input));
      assertClassified(error, "INSUFFICIENT_CREDITS", 402);
      assertEquals(channels.frames.join("").includes(privateDetail), false);
      assertEquals(channels.frames.join("").includes("599"), false);
    } finally {
      await channels.close();
    }
    const unknown = defineError({
      slug: "synthetic-unknown-failure",
      category: "AGENT",
      status: 429,
      title: privateDetail,
    }).create();
    const other = await connected(model({ doGenerate: () => Promise.reject(unknown) }));
    try {
      const error = await assertRejects(async () => await other.proxy!.doGenerate(input));
      assertEquals(parseProviderError(error).code, "EXTERNAL_SERVICE_ERROR");
      assertEquals(snapshotVeryfrontError(error), null);
      assertEquals(other.frames.join("").includes(privateDetail), false);
    } finally {
      await other.close();
    }
  });

  it("rejects unknown or extended failure envelopes instead of trusting wire diagnostics", async () => {
    const operations = new Map(
      createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => model() }),
    );
    operations.set("model.prepare", {
      mode: "unary",
      handle: () => ({ type: "failure", code: "OVERLOADED_ERROR", message: privateDetail }),
    });
    operations.set("model.generate", {
      mode: "unary",
      handle: () => ({ type: "failure", code: "SYNTHETIC_UNKNOWN", status: 403 }),
    });
    operations.set("model.stream", {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        yield { type: "failure", code: "OVERLOADED_ERROR", status: 599 };
      },
    });
    const channels = await connected(model(), operations);
    try {
      const resolver = await createExecutorModelRuntimeResolver({
        channel: channels.caller,
        allowedModelIds,
      });
      const proxy = resolver(modelId)!;
      for (
        const invoke of [
          () => proxy.prepare!(),
          () => proxy.doGenerate(input),
          () => proxy.doStream(input),
        ]
      ) {
        const error = await assertRejects(async () => await invoke());
        assertEquals(snapshotVeryfrontError(error), null);
        assertEquals(parseProviderError(error).code, "EXTERNAL_SERVICE_ERROR");
        assert(error instanceof Error);
        assertEquals(error.message.includes(privateDetail), false);
      }
    } finally {
      await channels.close();
    }
  });

  for (
    const value of [
      { type: "error", error: privateDetail },
      { type: "error", error: { type: "overloaded_error", message: privateDetail } },
      { type: "raw", rawValue: { error: privateDetail } },
      {
        type: "raw",
        rawValue: {
          type: "raw",
          rawValue: { error: { type: "overloaded_error", message: privateDetail } },
        },
      },
    ] as JsonValue[]
  ) {
    it(`keeps received ${JSON.stringify(value).includes("overloaded_error") ? "structured" : "text"} ${JSON.stringify(value).includes("rawValue") ? "raw" : "error"} chunks opaque`, async () => {
      const operations = new Map(
        createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => model() }),
      );
      operations.set("model.stream", {
        mode: "stream",
        async *handle(): AsyncGenerator<JsonValue> {
          yield { type: "start" };
          yield { type: "chunk", value };
        },
      });
      const channels = await connected(model(), operations);
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds,
        });
        const { stream } = await resolver(modelId)!.doStream(input);
        const error = await assertRejects(() => stream.getReader().read(), TypeError);
        assert(error instanceof TypeError);
        assertEquals(error.message.includes(privateDetail), false);
        assertEquals(parseProviderError(error).code, "EXTERNAL_SERVICE_ERROR");
        assertEquals(snapshotVeryfrontError(error), null);
      } finally {
        await channels.close();
      }
    });
  }

  it("classifies a received strict failure frame without trusting diagnostic chunks", async () => {
    const operations = new Map(
      createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => model() }),
    );
    operations.set("model.stream", {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        yield { type: "start" };
        yield { type: "failure", code: "OVERLOADED_ERROR" };
      },
    });
    const channels = await connected(model(), operations);
    try {
      const resolver = await createExecutorModelRuntimeResolver({
        channel: channels.caller,
        allowedModelIds,
      });
      const { stream } = await resolver(modelId)!.doStream(input);
      const error = await assertRejects(() => stream.getReader().read());
      assertClassified(error, "OVERLOADED_ERROR", 503);
    } finally {
      await channels.close();
    }
  });

  it("keeps unknown model and arbitrary channel errors opaque", async () => {
    const channels = await connected(
      model({ doGenerate: () => Promise.reject(new Error(privateDetail)) }),
    );
    try {
      const error = await assertRejects(async () => await channels.proxy!.doGenerate(input));
      assert(error instanceof Error);
      assertEquals(error.message, "Executor call operation-failed");
      assertEquals(parseProviderError(error).code, "EXTERNAL_SERVICE_ERROR");
      assertEquals(channels.frames.join("").includes(privateDetail), false);
    } finally {
      await channels.close();
    }
    const other = await connected(
      model(),
      new Map([["custom", {
        mode: "unary",
        handle() {
          throw overload();
        },
      }]]),
    );
    try {
      const error = await assertRejects(() => other.caller.request("custom", {}));
      assert(error instanceof Error);
      assertEquals(error.message, "Executor call operation-failed");
    } finally {
      await other.close();
    }
  });
});
