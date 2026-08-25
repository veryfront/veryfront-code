import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  AUTO_EMBEDDING_MODEL,
  normalizeEmbeddingModelConfig,
  resolveConfiguredEmbeddingModel,
} from "./model-resolution.ts";
import { VeryfrontError } from "#veryfront/errors";

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

    it("returns explicit model without resolving auto", () => {
      assertEquals(
        resolveConfiguredEmbeddingModel("custom/my-model"),
        "custom/my-model",
        "explicit model should bypass all auto-resolution",
      );
    });

    it("prefers veryfront cloud over cloud API key fallback", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      setEnv("OPENAI_API_KEY", "sk-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(),
        "veryfront-cloud/openai/text-embedding-3-small",
        "veryfront cloud should take priority over bare API keys",
      );
    });

    // NOTE: Only the `isDenoCompiled` detection itself is untestable here. It
    // is false at test time and verified by the compiled binary integration
    // tests. The branch it guards is covered by passing `compiled` explicitly.

    it("prefers a configured veryfront cloud project over API keys in a compiled binary", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      setEnv("OPENAI_API_KEY", "sk-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "veryfront-cloud/openai/text-embedding-3-small",
        "a configured veryfront cloud project must outrank a bare OPENAI_API_KEY even in a compiled binary",
      );
    });

    it("falls back to the cloud API key model in a compiled binary", () => {
      setEnv("OPENAI_API_KEY", "sk-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "openai/text-embedding-3-small",
        "a compiled binary must fall back to the cloud key instead of the unavailable local ONNX model",
      );
    });

    it("does not silently select the optional local extension", () => {
      const error = assertThrows(() => resolveConfiguredEmbeddingModel());
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "embedding-provider-unavailable");
      assertEquals(error.message, "No default embedding provider is available");
    });
  });

  describe("cloud fallback selection in a compiled binary", () => {
    it("maps OPENAI_API_KEY to the OpenAI embedding model", () => {
      setEnv("OPENAI_API_KEY", "sk-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "openai/text-embedding-3-small",
        "OPENAI_API_KEY must select the OpenAI embedding model",
      );
    });

    it("maps GOOGLE_API_KEY to the Google embedding model", () => {
      setEnv("GOOGLE_API_KEY", "google-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "google/text-embedding-004",
        "GOOGLE_API_KEY must select the Google embedding model",
      );
    });

    it("maps GOOGLE_GENERATIVE_AI_API_KEY to the Google embedding model", () => {
      setEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "google/text-embedding-004",
        "GOOGLE_GENERATIVE_AI_API_KEY must select the Google embedding model",
      );
    });

    it("prefers OpenAI when both OpenAI and Google keys are set", () => {
      setEnv("OPENAI_API_KEY", "sk-test");
      setEnv("GOOGLE_API_KEY", "google-test");

      assertEquals(
        resolveConfiguredEmbeddingModel(undefined, { compiled: true }),
        "openai/text-embedding-3-small",
        "OpenAI must win when both cloud API keys are present",
      );
    });

    it("fails when no compiled-compatible provider is available", () => {
      const error = assertThrows(() =>
        resolveConfiguredEmbeddingModel(undefined, { compiled: true })
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "embedding-provider-unavailable");
      assertEquals(error.message, "No default embedding provider is available");
    });
  });
});
