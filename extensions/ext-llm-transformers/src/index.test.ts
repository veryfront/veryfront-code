import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "veryfront/embedding";
import { clearModelProviders, registerModelProvider, resolveModel } from "veryfront/provider";
import extTransformers, {
  LocalEmbeddingProviderContract,
  LocalModelProviderContract,
} from "./index.ts";
import extensionPackage from "../deno.json" with { type: "json" };

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createContext(provided: Map<string, unknown>, signal?: AbortSignal) {
  return {
    config: {},
    logger,
    get: () => undefined,
    require: () => {
      throw new Error("No required contracts expected");
    },
    provide: (name: string, implementation: unknown) => {
      provided.set(name, implementation);
    },
    signal,
  };
}

Deno.test("ext-llm-transformers requires explicit activation", () => {
  assertEquals(extensionPackage.veryfront.activation, "explicit");
});

Deno.test("ext-llm-transformers registers and disposes both runtime providers", async () => {
  clearModelProviders();
  clearEmbeddingProviders();
  const provided = new Map<string, unknown>();
  const extension = extTransformers();

  try {
    await extension.setup?.(createContext(provided));

    assertEquals(resolveModel("local/qwen3.5-0.8b").executionMode, "server-local");
    assertEquals(
      resolveEmbeddingModel("local/all-MiniLM-L6-v2").provider,
      "local",
    );
    assertEquals(typeof provided.get(LocalModelProviderContract), "function");
    assertEquals(
      typeof provided.get(LocalEmbeddingProviderContract),
      "function",
    );

    await extension.teardown?.();
    assertThrows(
      () => resolveModel("local/qwen3.5-0.8b"),
      Error,
      "not registered",
    );
    assertThrows(
      () => resolveEmbeddingModel("local/all-MiniLM-L6-v2"),
      Error,
      "not registered",
    );
  } finally {
    await extension.teardown?.();
    clearModelProviders();
    clearEmbeddingProviders();
  }
});

Deno.test("ext-llm-transformers teardown preserves later provider replacements", async () => {
  clearModelProviders();
  clearEmbeddingProviders();
  const extension = extTransformers();

  try {
    await extension.setup?.(createContext(new Map()));
    registerModelProvider("local", (modelId) => ({
      specificationVersion: "v2",
      provider: "replacement",
      modelId,
      async doGenerate() {
        return {};
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    }));
    registerEmbeddingProvider("local", (modelId) => ({
      specificationVersion: "v2",
      provider: "replacement",
      modelId,
      async doEmbed({ values }) {
        return { embeddings: values.map(() => [1]) };
      },
    }));

    await extension.teardown?.();

    assertEquals(resolveModel("local/model").provider, "replacement");
    assertEquals(resolveEmbeddingModel("local/model").provider, "replacement");
  } finally {
    await extension.teardown?.();
    clearModelProviders();
    clearEmbeddingProviders();
  }
});

Deno.test("ext-llm-transformers rolls back both registrations when setup fails", async () => {
  clearModelProviders();
  clearEmbeddingProviders();
  const extension = extTransformers();
  let provideCalls = 0;

  try {
    assertThrows(
      () =>
        extension.setup?.({
          ...createContext(new Map()),
          provide() {
            provideCalls += 1;
            if (provideCalls === 2) throw new Error("contract publication failed");
          },
        }),
      Error,
      "contract publication failed",
    );
    assertThrows(() => resolveModel("local/model"), Error, "not registered");
    assertThrows(
      () => resolveEmbeddingModel("local/model"),
      Error,
      "not registered",
    );
  } finally {
    await extension.teardown?.();
    clearModelProviders();
    clearEmbeddingProviders();
  }
});

Deno.test("ext-llm-transformers fences stale runtimes during teardown", async () => {
  clearModelProviders();
  clearEmbeddingProviders();
  const provided = new Map<string, unknown>();
  const extension = extTransformers();

  try {
    await extension.setup?.(createContext(provided));
    const createModel = provided.get(LocalModelProviderContract) as
      | ((modelId: string) => ReturnType<typeof resolveModel>)
      | undefined;
    if (!createModel) throw new Error("model contract was not provided");
    const staleRuntime = createModel("qwen3.5-0.8b");

    const firstTeardown = extension.teardown?.();
    const secondTeardown = extension.teardown?.();
    assertStrictEquals(secondTeardown, firstTeardown);
    assertThrows(
      () => extension.setup?.(createContext(new Map())),
      Error,
      "teardown has not completed",
    );
    assertThrows(
      () => createModel("qwen3.5-0.8b"),
      DOMException,
      "shutting down",
    );
    await assertRejects(
      () =>
        Promise.resolve(staleRuntime.doGenerate({
          prompt: [{ role: "user", content: "hello" }],
        })),
      DOMException,
      "shutting down",
    );

    await firstTeardown;
    await extension.setup?.(createContext(new Map()));
    assertEquals(resolveModel("local/qwen3.5-0.8b").provider, "local");
  } finally {
    await extension.teardown?.();
    clearModelProviders();
    clearEmbeddingProviders();
  }
});

Deno.test("ext-llm-transformers treats context revocation as an immediate fence", async () => {
  clearModelProviders();
  clearEmbeddingProviders();
  const provided = new Map<string, unknown>();
  const contextController = new AbortController();
  const extension = extTransformers();

  try {
    await extension.setup?.(createContext(provided, contextController.signal));
    const createModel = provided.get(LocalModelProviderContract) as
      | ((modelId: string) => ReturnType<typeof resolveModel>)
      | undefined;
    const createEmbedding = provided.get(LocalEmbeddingProviderContract) as
      | ((modelId: string) => ReturnType<typeof resolveEmbeddingModel>)
      | undefined;
    if (!createModel || !createEmbedding) {
      throw new Error("runtime contracts were not provided");
    }
    const model = createModel("qwen3.5-0.8b");
    const embedding = createEmbedding("all-MiniLM-L6-v2");
    const reason = new DOMException("extension context revoked", "AbortError");

    contextController.abort(reason);

    assertStrictEquals(
      assertThrows(() => createModel("qwen3.5-0.8b")),
      reason,
    );
    assertStrictEquals(
      assertThrows(() => createEmbedding("all-MiniLM-L6-v2")),
      reason,
    );
    assertStrictEquals(
      await assertRejects(() => Promise.resolve(model.prepare?.())),
      reason,
    );
    assertStrictEquals(
      await assertRejects(() =>
        Promise.resolve(model.doGenerate({
          prompt: [{ role: "user", content: "hello" }],
        }))
      ),
      reason,
    );
    assertStrictEquals(
      await assertRejects(() => embedding.doEmbed({ values: [] })),
      reason,
    );
  } finally {
    await extension.teardown?.();
    clearModelProviders();
    clearEmbeddingProviders();
  }
});
