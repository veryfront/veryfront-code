import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { clearModelProviders, findAvailableCloudModel, resolveModel } from "#veryfront/provider";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_MODEL",
  "VERYFRONT_SERVICE_LAYER",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
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

  it("resolves veryfront-cloud openai models without project ext-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.2") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves veryfront-cloud moonshotai models without project ext-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/moonshotai/kimi-k2") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves veryfront-cloud anthropic models without project ext-anthropic installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/anthropic/claude-sonnet-4-6") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves veryfront-cloud google models without project ext-google installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/google-ai-studio/gemini-2.5-flash") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves direct anthropic models through the built-in provider", () => {
    setEnv("ANTHROPIC_API_KEY", "anthropic_test_provider");

    const model = resolveModel("anthropic/claude-sonnet-4-6") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves direct google models through the built-in provider", () => {
    setEnv("GOOGLE_API_KEY", "google_test_provider");

    const model = resolveModel("google/gemini-2.5-flash") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves veryfront-cloud openai embedding models without project ext-openai installed", () => {
    setCloudBootstrap();

    const model = resolveEmbeddingModel("veryfront-cloud/openai/text-embedding-3-small") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doEmbed, "function");
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
