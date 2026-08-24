import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { reset } from "#veryfront/extensions/contracts.ts";
import type { LLMProvider } from "#veryfront/extensions/llm/index.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "./resolve.ts";

function unusedModelRuntime(): ModelRuntime {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test/model",
    async doGenerate() {
      return {};
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
}

describe("embedding/resolve", () => {
  afterEach(() => {
    clearEmbeddingProviders();
    reset();
  });

  it("resolves local embeddings through the LLM provider registry", () => {
    const registry = ensureBuiltinLLMProviders();
    registry.unregister("local");
    const provider: LLMProvider = {
      id: "local",
      createModel: () => unusedModelRuntime(),
      createEmbedding(modelId) {
        return {
          specificationVersion: "v2",
          provider: "registry-local",
          modelId: `registry-local/${modelId}`,
          async doEmbed({ values }) {
            return { embeddings: values.map(() => [1]) };
          },
        };
      },
    };
    registry.register(provider);

    const embedding = resolveEmbeddingModel("local/test-embedding");

    assertEquals(embedding.provider, "registry-local");
    assertEquals(embedding.modelId, "registry-local/test-embedding");
  });
});
