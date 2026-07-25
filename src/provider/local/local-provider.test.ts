import "#veryfront/schemas/_test-setup.ts";
/**
 * Local Provider Tests
 *
 * Tests for the model catalog, local runtime adapter, and model registry integration.
 * Engine tests require @huggingface/transformers and are marked with `ignore`
 * for fast CI. Run manually with `--filter "local-engine"`.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#std/assert";
import { afterEach, describe, it } from "#std/testing/bdd";
import { DEFAULT_LOCAL_MODEL, getLocalModelIds, resolveLocalModel } from "./model-catalog.ts";
import { createLocalModel, createLocalModelRuntime } from "./model-runtime-adapter.ts";
import { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";
import {
  LOCAL_EMBEDDING_BATCH_SIZE,
  validateLocalEmbeddingBatch,
} from "./local-embedding-engine.ts";
import { clearModelProviders, ensureModelReady } from "../model-registry.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";

const RUN_LOCAL_AI_TESTS = Deno.env.get("VERYFRONT_RUN_LOCAL_AI_TESTS") === "1";
const RUN_LOCAL_AI_GPU_TESTS = Deno.env.get("VERYFRONT_RUN_LOCAL_AI_GPU_TESTS") === "1";
const RUN_LOCAL_AI_GEMMA_TESTS = Deno.env.get("VERYFRONT_RUN_LOCAL_AI_GEMMA_TESTS") === "1";
const RUN_LOCAL_AI_GEMMA_E4B_TESTS = Deno.env.get("VERYFRONT_RUN_LOCAL_AI_GEMMA_E4B_TESTS") ===
  "1";

async function runLocalSmokeTest(env: Record<string, string>): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/provider/local/_smoke-test.ts"],
    cwd: Deno.cwd(),
    env: {
      ...env,
      VF_DISABLE_LRU_INTERVAL: "1",
    },
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(
    output.success,
    true,
    `local smoke failed with code ${output.code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  );

  return `${stdout}\n${stderr}`;
}

describe("model-catalog", () => {
  it("resolves known model IDs to HuggingFace IDs", () => {
    const info = resolveLocalModel("qwen3.5-0.8b");
    assertEquals(info.hfId, "onnx-community/Qwen3.5-0.8B-ONNX");
    assertEquals(info.engine, "conditional-generation");
    assertEquals(info.modelClass, "qwen3_5");
  });

  it("rejects unknown local model IDs", () => {
    const error = assertThrows(() => resolveLocalModel("custom-org/custom-model"));
    const vfError = fromError(error);
    assertEquals(vfError?.type, "config");
    assertEquals(
      vfError?.message,
      'Unsupported local model "custom-org/custom-model". Supported local models: qwen3.5-0.8b, gemma4-e2b-it, gemma4-e4b-it.',
    );
  });

  it("has a default model set", () => {
    assertEquals(DEFAULT_LOCAL_MODEL, "qwen3.5-0.8b");
  });

  it("lists available model IDs", () => {
    const ids = getLocalModelIds();
    assertEquals(ids, [
      "qwen3.5-0.8b",
      "gemma4-e2b-it",
      "gemma4-e4b-it",
    ]);
  });
});

describe("model-runtime-adapter", () => {
  it("creates a framework model runtime", () => {
    const model = createLocalModel("qwen3.5-0.8b");
    // deno-lint-ignore no-explicit-any
    const m = model as any;
    assertEquals(m.specificationVersion, "v2");
    assertEquals(m.provider, "local");
    assertEquals(m.modelId, "local/qwen3.5-0.8b");
    assertExists(m.doGenerate);
    assertExists(m.doStream);
  });

  it("uses default model when no ID provided", () => {
    const model = createLocalModel();
    // deno-lint-ignore no-explicit-any
    assertEquals((model as any).modelId, "local/qwen3.5-0.8b");
  });

  it("sets _isVfLocalModel marker for ensureModelReady detection", () => {
    const model = createLocalModel("qwen3.5-0.8b");
    const m = model as Record<string, unknown>;
    assertEquals(m._isVfLocalModel, true);
  });

  it("omits usage when the local engine does not measure tokens", async () => {
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: () => Promise.resolve("hello"),
      generateStream: async function* () {
        yield "hel";
        yield "lo";
      },
    });
    const options = {
      prompt: [{ role: "user", content: "hello" }],
    };

    const generated = await model.doGenerate(options);
    assertEquals(Object.hasOwn(generated, "usage"), false);

    const { stream } = await model.doStream(options);
    const parts: Array<Record<string, unknown>> = [];
    for await (const part of stream) {
      parts.push(part as Record<string, unknown>);
    }
    const finish = parts.find((part) => part.type === "finish");
    assertExists(finish);
    assertEquals(Object.hasOwn(finish, "usage"), false);
  });

  it("rejects unsupported or empty local prompt content instead of dropping it", async () => {
    let generateCalls = 0;
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: () => {
        generateCalls++;
        return Promise.resolve("unused");
      },
      generateStream: async function* () {
        yield "unused";
      },
    });

    for (
      const prompt of [
        [],
        [{ role: "tool", content: "hidden result" }],
        [{ role: "user", content: [{ type: "image", text: "ignored" }] }],
        [{ role: "user", content: "" }],
      ]
    ) {
      await assertRejects(
        () => Promise.resolve(model.doGenerate({ prompt })),
        TypeError,
      );
    }
    assertEquals(generateCalls, 0);
  });

  it("fails before creating a stream when local AI is disabled", async () => {
    const prev = Deno.env.get("VERYFRONT_DISABLE_LOCAL_AI");
    Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", "1");

    try {
      // deno-lint-ignore no-explicit-any
      const model = createLocalModel("qwen3.5-0.8b") as any;
      const error = await assertRejects(() =>
        model.doStream({
          prompt: [{ role: "user", content: "hello" }],
        })
      );
      const vfError = fromError(error);
      assertEquals(vfError?.type, "no_ai_available");
    } finally {
      if (prev === undefined) Deno.env.delete("VERYFRONT_DISABLE_LOCAL_AI");
      else Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", prev);
    }
  });

  it("rejects pre-aborted generation before loading the local runtime", async () => {
    const abortController = new AbortController();
    abortController.abort(new DOMException("cancelled", "AbortError"));
    // deno-lint-ignore no-explicit-any
    const model = createLocalModel("qwen3.5-0.8b") as any;

    await assertRejects(
      () =>
        model.doGenerate({
          prompt: [{ role: "user", content: "hello" }],
          abortSignal: abortController.signal,
        }),
      DOMException,
      "cancelled",
    );
    await assertRejects(
      () =>
        model.doStream({
          prompt: [{ role: "user", content: "hello" }],
          abortSignal: abortController.signal,
        }),
      DOMException,
      "cancelled",
    );
  });

  it("rejects a caller abort even when non-streaming local generation ignores it", async () => {
    const neverSettles = new Promise<string>(() => {});
    let engineSignal: AbortSignal | undefined;
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: (_modelId, _messages, options) => {
        engineSignal = options.abortSignal;
        return neverSettles;
      },
      generateStream: async function* () {
        yield "unused";
      },
    });
    const abortController = new AbortController();
    const generation = model.doGenerate({
      prompt: [{ role: "user", content: "hello" }],
      abortSignal: abortController.signal,
    });
    const reason = new DOMException("caller stopped", "AbortError");

    abortController.abort(reason);

    const error = await Promise.resolve(generation).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    assertEquals(error, reason);
    assertEquals(engineSignal?.aborted, true);
    assertEquals(engineSignal?.reason, reason);
  });

  it("cancels promptly even when a custom local engine ignores abort", async () => {
    const neverSettles = new Promise<void>(() => {});
    let engineSignal: AbortSignal | undefined;
    let returnCalls = 0;
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: () => Promise.resolve("unused"),
      generateStream: (_modelId, _messages, options) => {
        engineSignal = options.abortSignal;
        let emitted = false;
        const iterator: AsyncIterableIterator<string> = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            if (!emitted) {
              emitted = true;
              return Promise.resolve({ done: false, value: "first" });
            }
            return neverSettles.then(() => ({ done: true, value: undefined }));
          },
          return() {
            returnCalls++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
        return iterator;
      },
    });
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: "hello" }],
    });
    const reader = stream.getReader();
    for (let index = 0; index < 4; index++) {
      assertEquals((await reader.read()).done, false);
    }
    const reason = new DOMException("consumer stopped", "AbortError");

    const cancellation = reader.cancel(reason);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let result: string;
    try {
      result = await Promise.race([
        cancellation.then(() => "canceled"),
        new Promise<string>((resolve) => {
          timeoutId = setTimeout(() => resolve("timed out"), 100);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    assertEquals(result, "canceled");
    assertEquals(engineSignal?.aborted, true);
    assertEquals(engineSignal?.reason, reason);
    assertEquals(returnCalls, 1);
  });

  it("surfaces caller abort promptly even when a custom local engine ignores it", async () => {
    const neverSettles = new Promise<void>(() => {});
    let engineSignal: AbortSignal | undefined;
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: () => Promise.resolve("unused"),
      generateStream: async function* (_modelId, _messages, options) {
        engineSignal = options.abortSignal;
        yield "first";
        await neverSettles;
      },
    });
    const abortController = new AbortController();
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: "hello" }],
      abortSignal: abortController.signal,
    });
    const reader = stream.getReader();
    for (let index = 0; index < 4; index++) {
      assertEquals((await reader.read()).done, false);
    }
    const pendingRead = reader.read();
    const reason = new DOMException("caller stopped", "AbortError");

    abortController.abort(reason);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let error: unknown;
    try {
      error = await Promise.race([
        pendingRead.then(
          () => undefined,
          (caught) => caught,
        ),
        new Promise<Error>((resolve) => {
          timeoutId = setTimeout(() => resolve(new Error("timed out")), 100);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    assertEquals(error, reason);
    assertEquals(engineSignal?.aborted, true);
    assertEquals(engineSignal?.reason, reason);
  });

  it("closes an iterator when acquisition synchronously aborts the caller", async () => {
    const abortController = new AbortController();
    const reason = new DOMException("aborted during iterator acquisition", "AbortError");
    let nextCalls = 0;
    let returnCalls = 0;
    const iterator: AsyncIterator<string> = {
      next() {
        nextCalls++;
        return new Promise<IteratorResult<string>>(() => {});
      },
      return() {
        returnCalls++;
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    const model = createLocalModelRuntime("qwen3.5-0.8b", {
      generate: () => Promise.resolve("unused"),
      generateStream: () => ({
        [Symbol.asyncIterator]() {
          abortController.abort(reason);
          return iterator;
        },
      }),
    });

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: "hello" }],
      abortSignal: abortController.signal,
    });
    const reader = stream.getReader();
    const error = await assertRejects(() => reader.read());

    assertEquals(error, reason);
    assertEquals(nextCalls, 0);
    assertEquals(returnCalls, 1);
  });
});

describe("embedding-runtime-adapter", () => {
  it("validates local embedding count, dimensions, and finite coordinates", () => {
    assertEquals(
      validateLocalEmbeddingBatch([[1, 2], [3, 4]], 2),
      {
        embeddings: [[1, 2], [3, 4]],
        dimension: 2,
      },
    );
    assertThrows(
      () => validateLocalEmbeddingBatch([[1, 2]], 2),
      TypeError,
      "unexpected number of vectors",
    );
    assertThrows(
      () => validateLocalEmbeddingBatch([[1, Number.NaN]], 1),
      TypeError,
      "invalid vector",
    );
    assertThrows(
      () => validateLocalEmbeddingBatch([[1], [2, 3]], 2),
      TypeError,
      "inconsistent vector dimensions",
    );
    assertThrows(
      () => validateLocalEmbeddingBatch([[1, 2]], 1, 3),
      TypeError,
      "inconsistent vector dimensions",
    );
  });

  it("advertises a finite local embedding batch size", () => {
    const model = createLocalEmbeddingModel();
    assertEquals(model.maxEmbeddingsPerCall, LOCAL_EMBEDDING_BATCH_SIZE);
    assertEquals(model.supportsParallelCalls, false);
  });

  it("omits usage when the local embedding engine does not measure tokens", async () => {
    const model = createLocalEmbeddingModel();
    const result = await model.doEmbed({ values: [] });

    assertEquals(result.embeddings, []);
    assertEquals(Object.hasOwn(result, "usage"), false);
  });

  it("rejects pre-aborted embedding calls before loading the local runtime", async () => {
    const abortController = new AbortController();
    abortController.abort(new DOMException("cancelled", "AbortError"));
    const model = createLocalEmbeddingModel();

    await assertRejects(
      () => model.doEmbed({ values: ["hello"], abortSignal: abortController.signal }),
      DOMException,
      "cancelled",
    );
  });
});

describe("ensureModelReady", () => {
  afterEach(() => {
    clearModelProviders();
  });

  it("is a no-op for non-local models (no _isVfLocalModel marker)", async () => {
    // A mock model without _isVfLocalModel should pass through immediately
    const mockModel = {
      specificationVersion: "v2" as const,
      provider: "openai",
      modelId: "openai/gpt-4o",
      supportedUrls: {},
      doGenerate: async () => ({}),
      doStream: async () => ({ stream: new ReadableStream() }),
    };
    // Should not throw. This returns without verifying runtime.
    // deno-lint-ignore no-explicit-any
    await ensureModelReady(mockModel as any);
  });

  it("throws no_ai_available for local models when runtime unavailable", async () => {
    const prev = Deno.env.get("VERYFRONT_DISABLE_LOCAL_AI");
    Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", "1");
    try {
      const localModel = createLocalModel("qwen3.5-0.8b");
      const error = await assertRejects(
        () => ensureModelReady(localModel),
      );
      const vfError = fromError(error);
      assertEquals(vfError?.type, "no_ai_available");
    } finally {
      if (prev === undefined) Deno.env.delete("VERYFRONT_DISABLE_LOCAL_AI");
      else Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", prev);
    }
  });
});

describe("local-engine (requires model download)", {
  // ONNX Runtime keeps file handles open. Disable Deno's leak detection.
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  // These tests actually download and run the model. Skip in CI.
  it("generateStream produces tokens", {
    ignore: !RUN_LOCAL_AI_TESTS,
  }, async () => {
    const { generateStream } = await import("./local-engine.ts");
    const tokens: string[] = [];

    for await (
      const token of generateStream("qwen3.5-0.8b", [
        { role: "user", content: "Say hello in one word." },
      ], { maxNewTokens: 20 })
    ) {
      tokens.push(token);
    }

    assertEquals(tokens.length > 0, true, "Should produce at least one token");
    const text = tokens.join("");
    assertEquals(text.length > 0, true, "Combined text should be non-empty");
  });

  it("agent runtime emits server-local inference mode with real ONNX inference", {
    ignore: !RUN_LOCAL_AI_TESTS,
  }, async () => {
    const { AgentRuntime } = await import("../../agent/runtime/index.ts");

    const runtime = new AgentRuntime("test-real-local-runtime", {
      model: "local/qwen3.5-0.8b",
      system: "Reply in one short sentence.",
    });

    const stream = await runtime.stream(
      [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "Say hello in two words." }] }],
      undefined,
      undefined,
      "local/qwen3.5-0.8b",
    );

    const decoder = new TextDecoder();
    const reader = stream.getReader();
    const events: Array<Record<string, unknown>> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          // Ignore non-JSON SSE payloads
        }
      }
    }

    const dataEvent = events.find(
      (event) => event.type === "data" && typeof event.data === "object",
    );
    assertExists(dataEvent, "Should emit an inferenceMode data event");

    const dataPayload = dataEvent?.data as { inferenceMode: string; model: string };
    assertEquals(dataPayload.inferenceMode, "server-local");
    assertEquals(dataPayload.model, "local/qwen3.5-0.8b");

    const textDelta = events.find(
      (event) =>
        event.type === "text-delta" &&
        typeof event.delta === "string" &&
        event.delta.length > 0,
    );
    assertExists(textDelta, "Should emit streamed assistant text");
  });

  it("smoke script verifies explicit WebGPU local inference in a child process", {
    ignore: !RUN_LOCAL_AI_GPU_TESTS,
  }, async () => {
    const output = await runLocalSmokeTest({
      VERYFRONT_LOCAL_AI_DEVICE: "webgpu",
    });

    assertStringIncludes(output, "Got model: local/qwen3.5-0.8b");
    assertStringIncludes(output, "Device: webgpu");
    assertStringIncludes(output, "Done! Local model inference works.");
  });

  it("smoke script verifies Gemma4 local inference in a child process", {
    ignore: !RUN_LOCAL_AI_GEMMA_TESTS,
  }, async () => {
    const output = await runLocalSmokeTest({
      VERYFRONT_LOCAL_AI_MODEL: "gemma4-e2b-it",
    });

    assertStringIncludes(output, "Got model: local/gemma4-e2b-it");
    assertStringIncludes(output, "Device: cpu");
    assertStringIncludes(output, "Done! Local model inference works.");
  });

  it("smoke script verifies Gemma4 E4B thinking inference in a child process", {
    ignore: !RUN_LOCAL_AI_GEMMA_E4B_TESTS,
  }, async () => {
    const output = await runLocalSmokeTest({
      VERYFRONT_LOCAL_AI_MODEL: "gemma4-e4b-it",
      VERYFRONT_LOCAL_AI_THINKING: "1",
      VERYFRONT_LOCAL_AI_DEVICE: "webgpu",
    });

    assertStringIncludes(output, "Got model: local/gemma4-e4b-it");
    assertStringIncludes(output, "Device: webgpu");
    assertStringIncludes(output, "Thinking: enabled");
    assertStringIncludes(output, "Done! Local model inference works.");
  });
});
