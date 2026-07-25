import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRuntimeJsonSchema } from "#veryfront/agent/runtime/runtime-tool-builder.ts";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeGenerateResult,
  ModelRuntimeStreamResult,
} from "#veryfront/provider/types.ts";
import { embed, embedMany } from "#veryfront/embedding/runtime-adapter.ts";
import { generateText, streamText } from "./runtime-bridge.ts";

const OUTER_WATCHDOG_MS = 5_000;

async function withOuterWatchdog<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Outer watchdog expired: ${label}`)),
          OUTER_WATCHDOG_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function readableFrom<T>(values: readonly T[]): ReadableStream<T> {
  let index = 0;
  return new ReadableStream<T>({
    pull(controller) {
      if (index >= values.length) {
        controller.close();
        return;
      }
      controller.enqueue(values[index++]!);
    },
  });
}

function getErrorName(value: unknown): string | undefined {
  return value && typeof value === "object" && "name" in value &&
      typeof value.name === "string"
    ? value.name
    : undefined;
}

function createGenerateModel(
  doGenerate: (options: unknown) => PromiseLike<ModelRuntimeGenerateResult>,
): ModelRuntime {
  return {
    provider: "test",
    modelId: "test/lifecycle-generate",
    specificationVersion: "v3",
    doGenerate,
    doStream: () => Promise.reject(new Error("unused doStream")),
  };
}

function createStreamModel(
  doStream: (options: unknown) => PromiseLike<ModelRuntimeStreamResult>,
  generateViaStream = false,
): ModelRuntime {
  return {
    provider: "test",
    modelId: "test/lifecycle-stream",
    specificationVersion: "v3",
    ...(generateViaStream ? { _generateViaStream: true } : {}),
    doGenerate: () => Promise.reject(new Error("unused doGenerate")),
    doStream,
  };
}

function createEmbeddingModel(
  doEmbed: EmbeddingRuntime["doEmbed"],
): EmbeddingRuntime {
  return {
    provider: "test",
    modelId: "test/lifecycle-embedding",
    specificationVersion: "v3",
    doEmbed,
  };
}

function emptyGenerateResult(): ModelRuntimeGenerateResult {
  return {
    content: [{ type: "text", text: "released for cleanup" }],
    finishReason: "stop",
  };
}

describe("runtime-bridge lifecycle", () => {
  it("aborts a stalled doGenerate call even when the model ignores the signal", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<ModelRuntimeGenerateResult>();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const model = createGenerateModel((options) => {
      receivedSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
      entered.resolve();
      return release.promise;
    });
    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      abortSignal: controller.signal,
    }));

    await entered.promise;
    controller.abort("generation cancelled");
    try {
      const error = await withOuterWatchdog(
        assertRejects(() => generation),
        "stalled doGenerate did not settle after abort",
      );
      assertEquals(getErrorName(error), "AbortError");
      assertEquals(receivedSignal, controller.signal);
    } finally {
      release.resolve(emptyGenerateResult());
      await Promise.allSettled([generation]);
    }
  });

  it("aborts generate-via-stream while doStream startup is stalled", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<ModelRuntimeStreamResult>();
    const controller = new AbortController();
    let lateStreamCancelCount = 0;
    const lateStream = new ReadableStream<unknown>({
      cancel() {
        lateStreamCancelCount++;
      },
    }, { highWaterMark: 0 });
    const model = createStreamModel(() => {
      entered.resolve();
      return release.promise;
    }, true);
    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      abortSignal: controller.signal,
    }));

    await entered.promise;
    controller.abort("stream startup cancelled");
    try {
      const error = await withOuterWatchdog(
        assertRejects(() => generation),
        "generate-via-stream startup did not settle after abort",
      );
      assertEquals(getErrorName(error), "AbortError");
    } finally {
      release.resolve({ stream: lateStream });
      await Promise.allSettled([generation]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(lateStreamCancelCount, 1);
  });

  it("aborts streamText while doStream startup is stalled", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<ModelRuntimeStreamResult>();
    const controller = new AbortController();
    let lateStreamCancelCount = 0;
    const lateStream = new ReadableStream<unknown>({
      cancel() {
        lateStreamCancelCount++;
      },
    }, { highWaterMark: 0 });
    const model = createStreamModel(() => {
      entered.resolve();
      return release.promise;
    });
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      abortSignal: controller.signal,
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();
    const next = iterator.next();

    await entered.promise;
    controller.abort("stream startup cancelled");
    try {
      const error = await withOuterWatchdog(
        assertRejects(() => next),
        "streamText startup did not settle after abort",
      );
      assertEquals(getErrorName(error), "AbortError");
    } finally {
      release.resolve({ stream: lateStream });
      await Promise.allSettled([next]);
      await iterator.return?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(lateStreamCancelCount, 1);
  });

  it("cancels a late stream when its consumer returns during startup", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<ModelRuntimeStreamResult>();
    let lateStreamCancelCount = 0;
    const lateStream = new ReadableStream<unknown>({
      cancel() {
        lateStreamCancelCount++;
      },
    }, { highWaterMark: 0 });
    const result = streamText({
      model: createStreamModel(() => {
        entered.resolve();
        return release.promise;
      }),
      messages: [{ role: "user", content: "Hello" }],
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();
    const next = iterator.next();

    await entered.promise;
    await withOuterWatchdog(
      iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
      "consumer return did not settle during stream startup",
    );
    release.resolve({ stream: lateStream });
    await Promise.allSettled([next]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(lateStreamCancelCount, 1);
  });

  it("aborts stalled embed and embedMany calls even when the model ignores the signal", async () => {
    const singleEntered = Promise.withResolvers<void>();
    const manyEntered = Promise.withResolvers<void>();
    const singleRelease = Promise.withResolvers<{ embeddings: number[][] }>();
    const manyRelease = Promise.withResolvers<{ embeddings: number[][] }>();
    const singleController = new AbortController();
    const manyController = new AbortController();
    const singleModel = createEmbeddingModel(() => {
      singleEntered.resolve();
      return singleRelease.promise;
    });
    const manyModel = createEmbeddingModel(() => {
      manyEntered.resolve();
      return manyRelease.promise;
    });
    const single = embed({
      model: singleModel,
      value: "one",
      abortSignal: singleController.signal,
    });
    const many = embedMany({
      model: manyModel,
      values: ["one", "two"],
      abortSignal: manyController.signal,
    });

    await Promise.all([singleEntered.promise, manyEntered.promise]);
    singleController.abort("single embedding cancelled");
    manyController.abort("embedding batch cancelled");
    try {
      const [singleError, manyError] = await withOuterWatchdog(
        Promise.all([
          assertRejects(() => Promise.resolve(single)),
          assertRejects(() => Promise.resolve(many)),
        ]),
        "embedding calls did not settle after abort",
      );
      assertEquals(getErrorName(singleError), "AbortError");
      assertEquals(getErrorName(manyError), "AbortError");
    } finally {
      singleRelease.resolve({ embeddings: [[1, 0]] });
      manyRelease.resolve({ embeddings: [[1, 0], [0, 1]] });
      await Promise.allSettled([single, many]);
    }
  });

  it("aborts a stalled stream read and cancels its source exactly once", async () => {
    const readEntered = Promise.withResolvers<void>();
    const controller = new AbortController();
    let sourceController: ReadableStreamDefaultController<unknown> | undefined;
    let cancelCount = 0;
    const source = new ReadableStream<unknown>({
      pull(streamController) {
        sourceController = streamController;
        readEntered.resolve();
      },
      cancel() {
        cancelCount += 1;
      },
    }, { highWaterMark: 0 });
    const result = streamText({
      model: createStreamModel(() => Promise.resolve({ stream: source })),
      messages: [{ role: "user", content: "Hello" }],
      abortSignal: controller.signal,
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();
    const next = iterator.next();

    await readEntered.promise;
    controller.abort("stream read cancelled");
    try {
      const error = await withOuterWatchdog(
        assertRejects(() => next),
        "stalled stream read did not settle after abort",
      );
      assertEquals(getErrorName(error), "AbortError");
      assertEquals(cancelCount, 1);
    } finally {
      if (cancelCount === 0) sourceController?.close();
      await Promise.allSettled([next]);
      await iterator.return?.();
    }
  });

  it("settles consumer return during hung validation and cancels the source", async () => {
    const validationEntered = Promise.withResolvers<void>();
    const validationRelease = Promise.withResolvers<{
      success: true;
      value: Record<string, never>;
    }>();
    let cancelCount = 0;
    let sourceController: ReadableStreamDefaultController<unknown> | undefined;
    const source = new ReadableStream<unknown>({
      start(controller) {
        sourceController = controller;
        controller.enqueue({
          type: "tool-call",
          toolCallId: "hung-validation",
          toolName: "search",
          input: {},
        });
      },
      cancel() {
        cancelCount += 1;
      },
    });
    const result = streamText({
      model: createStreamModel(() => Promise.resolve({ stream: source })),
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate: () => {
              validationEntered.resolve();
              return validationRelease.promise;
            },
          },
        },
      },
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();
    const next = iterator.next();

    await validationEntered.promise;
    const returned = iterator.return?.() ??
      Promise.resolve({ done: true as const, value: undefined });
    try {
      await withOuterWatchdog(
        returned,
        "consumer return did not settle while validation was pending",
      );
      assertEquals(cancelCount, 1);
    } finally {
      validationRelease.resolve({ success: true, value: {} });
      if (cancelCount === 0) sourceController?.close();
      await Promise.allSettled([next, returned]);
    }
  });

  it("lets one dual stream branch cancel while its peer continues and cleans up after both cancel", async () => {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    let sourceController: ReadableStreamDefaultController<unknown> | undefined;
    let cancelCount = 0;
    const source = new ReadableStream<unknown>({
      start(controller) {
        sourceController = controller;
        started.resolve();
      },
      cancel() {
        cancelCount += 1;
        cancelled.resolve();
      },
    });
    const result = streamText({
      model: createStreamModel(() => Promise.resolve({ stream: source })),
      messages: [{ role: "user", content: "Hello" }],
    });
    const fullIterator = result.fullStream[Symbol.asyncIterator]();
    const textIterator = result.textStream[Symbol.asyncIterator]();
    const firstFull = fullIterator.next();
    const firstText = textIterator.next();

    await started.promise;
    sourceController?.enqueue({ type: "text-delta", delta: "first" });
    assertEquals(await firstFull, {
      done: false,
      value: { type: "text-delta", text: "first" },
    });
    assertEquals(await firstText, { done: false, value: "first" });

    const textReturn = textIterator.return?.() ??
      Promise.resolve({ done: true as const, value: undefined });
    let fullReturn: PromiseLike<IteratorResult<unknown>> | undefined;
    try {
      sourceController?.enqueue({ type: "text-delta", delta: "second" });
      assertEquals(
        await withOuterWatchdog(
          fullIterator.next(),
          "full stream peer stopped after text stream cancellation",
        ),
        {
          done: false,
          value: { type: "text-delta", text: "second" },
        },
      );
      fullReturn = fullIterator.return?.() ??
        Promise.resolve({ done: true as const, value: undefined });

      await withOuterWatchdog(
        Promise.all([textReturn, fullReturn, cancelled.promise]),
        "dual stream source was not cleaned up after both branches cancelled",
      );
      assertEquals(cancelCount, 1);
    } finally {
      if (cancelCount === 0) {
        try {
          sourceController?.close();
        } catch {
          // The source may already be closed by a correct cancellation path.
        }
      }
      await Promise.allSettled([
        Promise.resolve(textReturn),
        Promise.resolve(fullReturn),
      ]);
    }
  });

  it("rejects a buffered dual-stream peer after caller abort", async () => {
    const controller = new AbortController();
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([
            { type: "text-delta", delta: "first" },
            { type: "text-delta", delta: "buffered" },
            { type: "finish", finishReason: "stop" },
          ]),
        })
      ),
      messages: [{ role: "user", content: "Hello" }],
      abortSignal: controller.signal,
    });
    const fullIterator = result.fullStream[Symbol.asyncIterator]();
    const textIterator = result.textStream[Symbol.asyncIterator]();
    const firstFull = fullIterator.next();
    const firstText = textIterator.next();

    assertEquals(await firstFull, {
      done: false,
      value: { type: "text-delta", text: "first" },
    });
    assertEquals(await firstText, { done: false, value: "first" });
    while (!(await fullIterator.next()).done) {
      // Drain the source side so the text peer contains buffered output.
    }

    controller.abort("stop buffered peer");
    const error = await assertRejects(() => textIterator.next());
    assertEquals(getErrorName(error), "AbortError");
    await textIterator.return?.();
  });

  it("throws Error stream parts from textStream", async () => {
    const providerError = new Error("provider stream failed");
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([{ type: "error", error: providerError }]),
        })
      ),
      messages: [{ role: "user", content: "Hello" }],
    });

    const error = await assertRejects(() => collectAsync(result.textStream));
    assertEquals(error, providerError);
  });

  it("wraps non-Error stream error parts before throwing them from textStream", async () => {
    const providerError = { code: "provider_failed" };
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([{ type: "error", error: providerError }]),
        })
      ),
      messages: [{ role: "user", content: "Hello" }],
    });

    const error = await assertRejects(
      () => collectAsync(result.textStream),
      Error,
      "Model stream failed",
    );
    assertEquals((error as Error).cause, providerError);
  });

  it("treats an error event as terminal for fullStream", async () => {
    const providerError = new Error("provider stream failed");
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([
            { type: "error", error: providerError },
            { type: "text-delta", delta: "must not escape" },
            { type: "finish", finishReason: "stop" },
          ]),
        })
      ),
      messages: [{ role: "user", content: "Hello" }],
    });

    assertEquals(await collectAsync(result.fullStream), [{
      type: "error",
      error: providerError,
    }]);
  });

  it("fails closed when textStream receives a malformed text delta", async () => {
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([{ type: "text-delta", delta: 42 }]),
        })
      ),
      messages: [{ role: "user", content: "Hello" }],
    });

    await assertRejects(
      () => collectAsync(result.textStream),
      TypeError,
    );
  });

  it("never accepts text, tool, or error output after a terminal stop", async () => {
    const scenarios = [
      {
        name: "text",
        part: { type: "text-delta", delta: "after finish" },
      },
      {
        name: "tool",
        part: {
          type: "tool-call",
          toolCallId: "after-finish-tool",
          toolName: "search",
          input: {},
        },
      },
      {
        name: "error",
        part: { type: "error", error: new Error("after finish error") },
      },
    ];

    const outcomes = await Promise.all(scenarios.map(async ({ name, part }) => {
      const result = streamText({
        model: createStreamModel(() =>
          Promise.resolve({
            stream: readableFrom([
              { type: "finish", finishReason: "stop" },
              part,
            ]),
          })
        ),
        messages: [{ role: "user", content: "Hello" }],
      });
      try {
        return {
          name,
          kind: "fulfilled" as const,
          parts: await collectAsync(result.fullStream),
        };
      } catch (error) {
        return { name, kind: "rejected" as const, error };
      }
    }));
    const expectedTerminalParts = JSON.stringify([{
      type: "finish",
      finishReason: "stop",
    }]);
    const acceptedPostFinishOutput = outcomes.flatMap((outcome) => {
      if (
        outcome.kind === "rejected" ||
        JSON.stringify(outcome.parts) === expectedTerminalParts
      ) {
        return [];
      }
      return [{ name: outcome.name, parts: outcome.parts }];
    });

    assertEquals(acceptedPostFinishOutput, []);
  });

  it("continues to accept a correlated deferred provider result after pause_turn", async () => {
    const inputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });
    const outputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { matches: { type: "integer" } },
      required: ["matches"],
      additionalProperties: false,
    });
    const result = streamText({
      model: createStreamModel(() =>
        Promise.resolve({
          stream: readableFrom([
            {
              type: "tool-call",
              toolCallId: "deferred-search",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
              providerExecuted: true,
            },
            { type: "finish", finishReason: "pause_turn" },
            {
              type: "tool-result",
              toolCallId: "deferred-search",
              toolName: "web_search",
              result: { matches: 2 },
              providerExecuted: true,
            },
          ]),
        })
      ),
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => inputSchema,
          outputSchema: () => outputSchema,
          supportsDeferredResults: true,
        },
      },
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-call",
        toolCallId: "deferred-search",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "tool-result",
        toolCallId: "deferred-search",
        toolName: "web_search",
        result: { matches: 2 },
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      { type: "finish", finishReason: "pause_turn" },
    ]);
  });
});
