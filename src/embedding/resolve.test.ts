import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "./resolve.ts";

describe("embedding provider resolution", () => {
  afterEach(() => {
    clearEmbeddingProviders();
  });

  it("rejects malformed provider registrations", () => {
    const factory = (() => ({ doEmbed: () => Promise.resolve({ embeddings: [] }) })) as never;

    assertThrows(
      () => registerEmbeddingProvider("", factory),
      Error,
      "provider name must not be empty",
    );
    assertThrows(
      () => registerEmbeddingProvider("bad/name", factory),
      Error,
      "provider name must not contain '/'",
    );
    assertThrows(
      () => registerEmbeddingProvider("test", undefined as never),
      Error,
      "provider factory must be a function",
    );
  });

  it("rejects malformed model identifiers without echoing their value", () => {
    const model = `test/${"<TOKEN>".repeat(100)}`;
    const error = assertThrows(
      () => resolveEmbeddingModel(model),
      Error,
      "Embedding model identifier exceeds 512 characters",
    );

    assertEquals(error.message.includes("<TOKEN>"), false);

    const missingProvider = assertThrows(
      () => resolveEmbeddingModel("private-token-value"),
      Error,
      'must use "provider/model" format',
    );
    assertEquals(missingProvider.message.includes("private-token-value"), false);
  });

  it("rejects factories that return an invalid runtime", () => {
    registerEmbeddingProvider("test", () => ({}) as never);

    assertThrows(
      () => resolveEmbeddingModel("test/model"),
      Error,
      "Embedding provider returned an invalid runtime",
    );
  });
});
