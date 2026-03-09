import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { clearModelProviders, findAvailableCloudModel, resolveModel } from "#veryfront/provider";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_MODEL",
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

function setCloudBootstrap(): void {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_provider");
  setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
}

describe("provider/veryfront-cloud", () => {
  afterEach(() => {
    clearCloudEnv();
    clearModelProviders();
    clearEmbeddingProviders();
  });

  it("resolves veryfront-cloud openai models through the model registry", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.2") as Record<string, unknown>;

    assertExists(model.doGenerate);
    assertExists(model.doStream);
  });

  it("resolves veryfront-cloud embedding models through the embedding registry", () => {
    setCloudBootstrap();

    const model = resolveEmbeddingModel(
      "veryfront-cloud/openai/text-embedding-3-small",
    ) as Record<string, unknown>;

    assertExists(model.doEmbed);
  });

  it("prefers the default veryfront-cloud model when cloud bootstrap is active", () => {
    setCloudBootstrap();

    assertEquals(
      findAvailableCloudModel(),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("uses VERYFRONT_DEFAULT_MODEL as an override for cloud auto-upgrade", () => {
    setCloudBootstrap();
    setEnv("VERYFRONT_DEFAULT_MODEL", "openai/gpt-5.2");

    assertEquals(findAvailableCloudModel(), "veryfront-cloud/openai/gpt-5.2");
  });

  it("fails fast on malformed veryfront-cloud model IDs", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveModel("veryfront-cloud/openai"),
      Error,
      'Invalid veryfront-cloud model string: "openai"',
    );
  });

  it("rejects unsupported embedding providers for veryfront-cloud", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveEmbeddingModel("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      Error,
      'Embedding provider "anthropic" is not supported',
    );
  });
});
