import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { clearModelProviders, findAvailableCloudModel, resolveModel } from "#veryfront/provider";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
import { createAIProviderRegistry } from "#veryfront/extensions/registries/ai-provider-registry.ts";

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
  beforeEach(() => {
    register(AIProviderRegistryName, createAIProviderRegistry());
  });

  afterEach(() => {
    clearCloudEnv();
    clearModelProviders();
    clearEmbeddingProviders();
    reset();
  });

  it("resolves veryfront-cloud anthropic models via the built-in provider", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/anthropic/claude-sonnet-4-6") as Record<string, unknown>;
    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("throws when resolving veryfront-cloud openai models without ext-openai installed", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveModel("veryfront-cloud/openai/gpt-5.2"),
      Error,
      "openai",
    );
  });

  it("throws when resolving veryfront-cloud moonshotai models without ext-openai installed", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveModel("veryfront-cloud/moonshotai/kimi-k2"),
      Error,
      "openai",
    );
  });

  it("throws when resolving veryfront-cloud openai embedding models without ext-openai installed", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveEmbeddingModel("veryfront-cloud/openai/text-embedding-3-small"),
      Error,
      "openai",
    );
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
