import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  AUTO_EMBEDDING_MODEL,
  normalizeEmbeddingModelConfig,
  resolveConfiguredEmbeddingModel,
} from "./model-resolution.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_EMBEDDING_MODEL",
  "VERYFRONT_SERVICE_LAYER",
] as const;

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("embedding/model-resolution", () => {
  afterEach(() => {
    clearCloudEnv();
  });

  it("normalizes missing models to auto", () => {
    assertEquals(normalizeEmbeddingModelConfig(), AUTO_EMBEDDING_MODEL);
    assertEquals(normalizeEmbeddingModelConfig(" "), AUTO_EMBEDDING_MODEL);
  });

  it("uses the local default embedding model without cloud bootstrap", () => {
    assertEquals(
      resolveConfiguredEmbeddingModel(),
      "local/all-MiniLM-L6-v2",
    );
  });

  it("uses the veryfront cloud embedding default when cloud bootstrap is active", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_embedding_test");
    setEnv("VERYFRONT_PROJECT_SLUG", "embedding-test-project");

    assertEquals(
      resolveConfiguredEmbeddingModel(),
      "veryfront-cloud/openai/text-embedding-3-small",
    );
  });

  it("uses VERYFRONT_DEFAULT_EMBEDDING_MODEL as an override", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_embedding_test");
    setEnv("VERYFRONT_PROJECT_SLUG", "embedding-test-project");
    setEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL", "google/text-embedding-004");

    assertEquals(
      resolveConfiguredEmbeddingModel(),
      "veryfront-cloud/google/text-embedding-004",
    );
  });
});
