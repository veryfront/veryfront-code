import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  _resetRuntimeConfig,
  _setRuntimeConfigForTesting,
  createTestConfig,
} from "#veryfront/config/runtime-config.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider";
import { runWithProjectEnv } from "#veryfront/server/project-env";
import {
  getDefaultVeryfrontCloudEmbeddingModel,
  getDefaultVeryfrontCloudModel,
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudProjectSlug,
  isVeryfrontCloudEnabled,
} from "./resolver.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
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

  it("uses host framework env under project env overlays", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_host_token");
    setEnv("VERYFRONT_PROJECT_SLUG", "host-project");
    setEnv("VERYFRONT_DEFAULT_MODEL", "openai/gpt-5.2");

    runWithProjectEnv({ VERYFRONT_API_TOKEN: "tenant-token" }, () => {
      assertEquals(isVeryfrontCloudEnabled(), true);
      assertEquals(getVeryfrontCloudAuthToken(), "vf_host_token");
      assertEquals(getVeryfrontCloudProjectSlug(), "host-project");
      assertEquals(getDefaultVeryfrontCloudModel(), "veryfront-cloud/openai/gpt-5.2");
    });
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

  it("lets scoped cloud context override env bootstrap values", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_env_token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");

    runWithVeryfrontCloudContext(
      {
        apiBaseUrl: "https://api.staging.veryfront.org",
        apiToken: "vf_scoped_token",
        projectSlug: "scoped-project",
      },
      () => {
        assertEquals(isVeryfrontCloudEnabled(), true);
        assertEquals(getVeryfrontCloudAuthToken(), "vf_scoped_token");
        assertEquals(getVeryfrontCloudProjectSlug(), "scoped-project");
        assertEquals(getVeryfrontCloudBootstrap().apiBaseUrl, "https://api.staging.veryfront.org");
      },
    );

    assertEquals(getVeryfrontCloudAuthToken(), "vf_env_token");
    assertEquals(getVeryfrontCloudProjectSlug(), "env-project");
  });

  it("resolves the API base URL from host env without the config bridge", () => {
    const globals = globalThis as Record<string, unknown>;
    const originalBridge = globals.__vfGetApiBaseUrlEnv;
    globals.__vfGetApiBaseUrlEnv = () => {
      throw new Error("config bridge should not be called");
    };
    setEnv("VERYFRONT_API_URL", "https://api.staging.veryfront.org/graphql");

    try {
      assertEquals(
        getVeryfrontCloudBootstrap().apiBaseUrl,
        "https://api.staging.veryfront.org/api",
      );
    } finally {
      if (originalBridge === undefined) {
        delete globals.__vfGetApiBaseUrlEnv;
      } else {
        globals.__vfGetApiBaseUrlEnv = originalBridge;
      }
    }
  });

  it("treats scoped cloud context as sufficient runtime context even without projectSlug", () => {
    runWithVeryfrontCloudContext({ apiToken: "vf_scoped_token" }, () => {
      assertEquals(isVeryfrontCloudEnabled(), true);
      assertEquals(getVeryfrontCloudAuthToken(), "vf_scoped_token");
    });
  });

  it("does not treat a billing group id as cloud runtime context", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_host_token");

    runWithVeryfrontCloudContext({ billingGroupId: "evalrun_20260628_kimi" }, () => {
      assertEquals(isVeryfrontCloudEnabled(), false);
      assertEquals(getVeryfrontCloudAuthToken(), "vf_host_token");
    });
  });
});
