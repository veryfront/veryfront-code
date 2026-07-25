import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "./resolve.ts";

function testRuntime(provider: string, modelId: string): EmbeddingRuntime {
  return {
    specificationVersion: "v2",
    provider,
    modelId,
    async doEmbed({ values }) {
      return {
        embeddings: values.map(() => [1]),
        usage: { tokens: 0 },
        warnings: [],
      };
    },
  };
}

describe("embedding provider resolution", () => {
  afterEach(() => {
    clearEmbeddingProviders();
    try {
      deleteEnv("GOOGLE_API_KEY");
    } catch {
      // expected: env may already be unset
    }
  });

  it("isolates custom providers by project source scope", () => {
    const main = { projectId: "project-a", mode: "preview" as const, versionId: "main" };
    const feature = {
      projectId: "project-a",
      mode: "preview" as const,
      versionId: "feature",
    };

    runWithCacheKeyContext(main, () => {
      registerEmbeddingProvider("tenant", (id) => testRuntime("main", id));
    });
    runWithCacheKeyContext(feature, () => {
      registerEmbeddingProvider("tenant", (id) => testRuntime("feature", id));
    });

    assertEquals(
      runWithCacheKeyContext(main, () => resolveEmbeddingModel("tenant/model").provider),
      "main",
    );
    assertEquals(
      runWithCacheKeyContext(feature, () => resolveEmbeddingModel("tenant/model").provider),
      "feature",
    );
    assertThrows(
      () => resolveEmbeddingModel("tenant/model"),
      Error,
      'provider "tenant" not registered',
    );

    runWithCacheKeyContext(main, clearEmbeddingProviders);
    assertThrows(
      () =>
        runWithCacheKeyContext(
          main,
          () => resolveEmbeddingModel("tenant/model"),
        ),
      Error,
      'provider "tenant" not registered',
    );
    assertEquals(
      runWithCacheKeyContext(feature, () => resolveEmbeddingModel("tenant/model").provider),
      "feature",
    );
    runWithCacheKeyContext(feature, clearEmbeddingProviders);
  });

  it("initializes the built-in Google embedding provider on direct use", () => {
    setEnv("GOOGLE_API_KEY", "google-test-key");

    const runtime = resolveEmbeddingModel("google/gemini-embedding-2");

    assertEquals(runtime.provider, "google");
    assertEquals(typeof runtime.doEmbed, "function");
  });

  it("retains bootstrap registrations as project-wide defaults", () => {
    registerEmbeddingProvider("bootstrap", (id) => testRuntime("bootstrap", id));
    const project = {
      projectId: "project-a",
      mode: "preview" as const,
      versionId: "feature",
    };

    assertEquals(
      runWithCacheKeyContext(
        project,
        () => resolveEmbeddingModel("bootstrap/model").provider,
      ),
      "bootstrap",
    );

    runWithCacheKeyContext(project, () => {
      registerEmbeddingProvider("bootstrap", (id) => testRuntime("project", id));
    });
    assertEquals(
      runWithCacheKeyContext(
        project,
        () => resolveEmbeddingModel("bootstrap/model").provider,
      ),
      "project",
    );
    runWithCacheKeyContext(project, clearEmbeddingProviders);
  });

  it("rejects malformed custom provider registrations", () => {
    assertThrows(
      () => registerEmbeddingProvider(null as never, () => testRuntime("test", "model")),
      TypeError,
      "non-empty string",
    );
    assertThrows(
      () => registerEmbeddingProvider(" ", () => testRuntime("test", "model")),
      TypeError,
      "non-empty",
    );
    assertThrows(
      () => registerEmbeddingProvider("bad/name", () => testRuntime("test", "model")),
      TypeError,
      "without slashes",
    );
    assertThrows(
      () => resolveEmbeddingModel(null as never),
      TypeError,
      "provider/model",
    );
  });
});
