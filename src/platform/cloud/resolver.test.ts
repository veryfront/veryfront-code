import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  _resetRuntimeConfig,
  _setRuntimeConfigForTesting,
  createTestConfig,
} from "#veryfront/config/runtime-config.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider";
import { runWithProjectEnv } from "#veryfront/server/project-env";
import { registerVeryfrontCloudContextProvider } from "./context-bridge.ts";
import {
  getDefaultVeryfrontCloudEmbeddingModel,
  getDefaultVeryfrontCloudModel,
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudProjectSlug,
  isVeryfrontCloudEnabled,
  resolveVeryfrontApiBaseUrlFromHostEnv,
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

  it("rejects malformed cloud model overrides", () => {
    setEnv("VERYFRONT_DEFAULT_MODEL", "provider-only");
    assertThrows(
      () => getDefaultVeryfrontCloudModel(),
      Error,
      "provider/model",
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

  it("reads scoped cloud context once for each bootstrap snapshot", () => {
    let tokenReads = 0;

    runWithVeryfrontCloudContext(
      {
        apiBaseUrl: "https://api.staging.veryfront.org",
        get apiToken() {
          tokenReads++;
          return "vf_scoped_token";
        },
        projectSlug: "scoped-project",
      },
      () => {
        assertEquals(getVeryfrontCloudBootstrap(), {
          apiBaseUrl: "https://api.staging.veryfront.org",
          apiToken: "vf_scoped_token",
          projectSlug: "scoped-project",
          serviceLayer: undefined,
          hasRequestContext: true,
          usesVeryfrontFs: false,
        });
        assertEquals(tokenReads, 1);
      },
    );
  });

  it("keeps concurrent scoped cloud contexts isolated through the platform bridge", async () => {
    let releaseFirst!: () => void;
    let markFirstReady!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      markFirstReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runWithVeryfrontCloudContext(
      { apiToken: "vf_first_token", projectSlug: "first-project" },
      async () => {
        markFirstReady();
        await release;
        return getVeryfrontCloudBootstrap();
      },
    );

    await firstReady;
    const second = await runWithVeryfrontCloudContext(
      { apiToken: "vf_second_token", projectSlug: "second-project" },
      async () => getVeryfrontCloudBootstrap(),
    );
    releaseFirst();
    const firstResult = await first;

    assertEquals(firstResult.apiToken, "vf_first_token");
    assertEquals(firstResult.projectSlug, "first-project");
    assertEquals(second.apiToken, "vf_second_token");
    assertEquals(second.projectSlug, "second-project");
  });

  it("lets the provider entrypoint restore its registered context accessor", () => {
    registerVeryfrontCloudContextProvider(() => ({
      apiToken: "vf_stale_token",
      projectSlug: "stale-project",
    }));

    runWithVeryfrontCloudContext(
      { apiToken: "vf_current_token", projectSlug: "current-project" },
      () => {
        assertEquals(getVeryfrontCloudAuthToken(), "vf_current_token");
        assertEquals(getVeryfrontCloudProjectSlug(), "current-project");
      },
    );
  });

  it("does not add a platform-to-provider production import edge", async () => {
    const sources = await Promise.all([
      Deno.readTextFile(new URL("./resolver.ts", import.meta.url)),
      Deno.readTextFile(new URL("./context-bridge.ts", import.meta.url)),
    ]);

    for (const source of sources) {
      const importSpecifiers = [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)]
        .map((match) => match[1] ?? "");
      assertEquals(
        importSpecifiers.some((specifier) => /(?:^|\/)(?:provider|config)(?:\/|$)/.test(specifier)),
        false,
      );
      assertEquals(source.includes("__vfGetRuntimeConfig"), false);
      assertEquals(source.includes("__vfIsRuntimeConfigInitialized"), false);
    }
  });

  it("does not observe scoped context when the provider layer is absent", async () => {
    const script = [
      'const resolver = await import("./src/platform/cloud/resolver.ts");',
      "console.log(JSON.stringify(resolver.getVeryfrontCloudBootstrap()));",
    ].join("\n");
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      clearEnv: true,
      cwd: new URL("../../../", import.meta.url),
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stderr),
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(result.stdout).trim()),
      {
        apiBaseUrl: "https://api.veryfront.com",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      },
    );
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

  it("normalizes API base URL host env values", () => {
    setEnv("VERYFRONT_API_URL", " https://api.staging.veryfront.org/graphql/ ");
    assertEquals(
      resolveVeryfrontApiBaseUrlFromHostEnv(),
      "https://api.staging.veryfront.org/api",
    );

    setEnv("VERYFRONT_API_BASE_URL", " http://veryfront-api.veryfront-staging.svc/ ");
    assertEquals(
      resolveVeryfrontApiBaseUrlFromHostEnv(),
      "http://veryfront-api.veryfront-staging.svc",
    );

    setEnv("VERYFRONT_API_BASE_URL", "HTTPS://EXAMPLE.COM:443/path with space/");
    assertEquals(
      resolveVeryfrontApiBaseUrlFromHostEnv(),
      "https://example.com/path%20with%20space",
    );
  });

  it("rejects unsafe API base URLs without exposing credentials", () => {
    setEnv("VERYFRONT_API_BASE_URL", "https://private-user:PRIVATE_URL_CANARY@example.test/api");
    assertThrows(
      () => resolveVeryfrontApiBaseUrlFromHostEnv(),
      Error,
      "must not include credentials",
    );
    try {
      resolveVeryfrontApiBaseUrlFromHostEnv();
    } catch (error) {
      assert(error instanceof Error);
      assertEquals(error.message.includes("PRIVATE_URL_CANARY"), false);
    }

    setEnv("VERYFRONT_API_BASE_URL", "file:///private/socket");
    assertThrows(
      () => resolveVeryfrontApiBaseUrlFromHostEnv(),
      Error,
      "HTTP or HTTPS",
    );

    setEnv("VERYFRONT_API_BASE_URL", "https://example.test/api?token=PRIVATE_QUERY_CANARY");
    assertThrows(
      () => resolveVeryfrontApiBaseUrlFromHostEnv(),
      Error,
      "query string or fragment",
    );
  });

  it("rejects unknown service-layer modes", () => {
    setEnv("VERYFRONT_SERVICE_LAYER", "cluod");
    assertThrows(() => isVeryfrontCloudEnabled(), Error, "local or cloud");
  });

  it("trims selected credentials without falling back past an explicit empty value", () => {
    setEnv("VERYFRONT_API_TOKEN", "   ");
    setEnv("VERYFRONT_PROJECT_SLUG", " demo-project ");
    _setRuntimeConfigForTesting(createTestConfig({
      fs: { type: "veryfront-api", veryfront: { apiToken: "vf_runtime_token" } },
    }));

    assertEquals(getVeryfrontCloudAuthToken(), "");
    assertEquals(getVeryfrontCloudProjectSlug(), "demo-project");
    assertEquals(isVeryfrontCloudEnabled(), false);
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
