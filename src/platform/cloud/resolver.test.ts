import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  _resetRuntimeConfig,
  _setRuntimeConfigForTesting,
  createTestConfig,
} from "#veryfront/config/runtime-config.ts";
import {
  getDefaultVeryfrontCloudEmbeddingModel,
  getDefaultVeryfrontCloudModel,
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudProjectSlug,
  isVeryfrontCloudEnabled,
} from "./resolver.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "VERYFRONT_DEFAULT_MODEL",
  "VERYFRONT_DEFAULT_EMBEDDING_MODEL",
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

describe("platform/cloud/resolver", () => {
  afterEach(() => {
    clearCloudEnv();
    _resetRuntimeConfig();
  });

  it("keeps cloud mode disabled by default", () => {
    assertEquals(isVeryfrontCloudEnabled(), false);
  });

  it("enables cloud mode from local bootstrap env vars", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_local");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(isVeryfrontCloudEnabled(), true);
    assertEquals(getVeryfrontCloudAuthToken(), "vf_test_local");
    assertEquals(getVeryfrontCloudProjectSlug(), "demo-project");
  });

  it("lets VERYFRONT_SERVICE_LAYER=cloud force cloud mode with a token", () => {
    setEnv("VERYFRONT_SERVICE_LAYER", "cloud");
    setEnv("VERYFRONT_API_TOKEN", "vf_test_forced");

    assertEquals(isVeryfrontCloudEnabled(), true);
  });

  it("lets VERYFRONT_SERVICE_LAYER=local disable cloud mode even with bootstrap", () => {
    setEnv("VERYFRONT_SERVICE_LAYER", "local");
    setEnv("VERYFRONT_API_TOKEN", "vf_test_local");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(isVeryfrontCloudEnabled(), false);
  });

  it("falls back to runtime config projectSlug when env vars omit it", () => {
    _setRuntimeConfigForTesting(createTestConfig({ projectSlug: "config-project" }));
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");

    assertEquals(isVeryfrontCloudEnabled(), true);
  });

  it("normalizes default cloud model overrides without requiring the prefix", () => {
    setEnv("VERYFRONT_DEFAULT_MODEL", "openai/gpt-5.2");
    setEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL", "openai/text-embedding-3-small");

    assertEquals(getDefaultVeryfrontCloudModel(), "veryfront-cloud/openai/gpt-5.2");
    assertEquals(
      getDefaultVeryfrontCloudEmbeddingModel(),
      "veryfront-cloud/openai/text-embedding-3-small",
    );
  });
});
