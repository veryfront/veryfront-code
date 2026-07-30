import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  AUTO_EMBEDDING_MODEL,
  normalizeEmbeddingModelConfig,
  resolveConfiguredEmbeddingModel,
} from "./model-resolution.ts";

const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_EMBEDDING_MODEL",
  "VERYFRONT_SERVICE_LAYER",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("embedding/model-resolution", () => {
  afterEach(() => {
    clearEnv();
  });

  describe("normalizeEmbeddingModelConfig", () => {
    it("normalizes missing models to auto", () => {
      assertEquals(normalizeEmbeddingModelConfig(), AUTO_EMBEDDING_MODEL);
      assertEquals(normalizeEmbeddingModelConfig(undefined), AUTO_EMBEDDING_MODEL);
    });

    it("normalizes whitespace-only to auto", () => {
      assertEquals(normalizeEmbeddingModelConfig(" "), AUTO_EMBEDDING_MODEL);
      assertEquals(normalizeEmbeddingModelConfig("  \t  "), AUTO_EMBEDDING_MODEL);
    });

    it("normalizes empty string to auto", () => {
      assertEquals(normalizeEmbeddingModelConfig(""), AUTO_EMBEDDING_MODEL);
    });

    it("preserves explicitly configured model", () => {
      assertEquals(
        normalizeEmbeddingModelConfig("openai/text-embedding-3-large"),
        "openai/text-embedding-3-large",
      );
    });

    it("trims whitespace from configured model", () => {
      assertEquals(
        normalizeEmbeddingModelConfig("  openai/text-embedding-3-small  "),
        "openai/text-embedding-3-small",
      );
    });
  });

  describe("resolveConfiguredEmbeddingModel", () => {
    it("requires explicit composition without cloud bootstrap", () => {
      assertThrows(
        () => resolveConfiguredEmbeddingModel(),
        Error,
        "Configure an explicit",
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
      setEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL", "google/gemini-embedding-2");

      assertEquals(
        resolveConfiguredEmbeddingModel(),
        "veryfront-cloud/google/gemini-embedding-2",
      );
    });

    it("returns explicit model without resolving auto", () => {
      assertEquals(
        resolveConfiguredEmbeddingModel("custom/my-model"),
        "custom/my-model",
        "explicit model should bypass all auto-resolution",
      );
    });

    it("prefers veryfront cloud over unrelated direct credentials", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      setEnv("OPENAI_API_KEY", "sk-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(),
        "veryfront-cloud/openai/text-embedding-3-small",
        "veryfront cloud should take priority over bare API keys",
      );
    });

    it("does not probe direct provider credentials for an implicit model", () => {
      setEnv("OPENAI_API_KEY", "openai-test-key");
      setEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google-test-key");

      assertThrows(
        () => resolveConfiguredEmbeddingModel(),
        Error,
        "register that embedding provider during application composition",
      );
    });
  });
});
