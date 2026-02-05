import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EnvironmentConfig } from "./environment-config.ts";
import {
  getAnthropicEnvConfig,
  getApiBaseUrlEnv,
  getApiTokenEnv,
  getCacheDirEnv,
  getDisableLruIntervalEnv,
  getEnvironmentFromEnv,
  getForceColorEnv,
  getGithubEnvConfig,
  getGoogleGenAIEnvConfig,
  getNoColorEnv,
  getOpenAIEnvConfig,
  getOtelMetricsConfig,
  getOtelTracingConfig,
  getRedisUrlEnv,
  getSsrMaxConcurrentTransformsEnv,
  getV8FlagsEnv,
  getVeryfrontVersion,
  isCiEnv,
  isDebugEnvEnabled,
  isDenoTestingEnv,
  isPerfEnabledEnv,
  isRscExperimentalEnabled,
} from "./env.ts";

function createMockEnv(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    nodeEnv: "test",
    veryfrontEnv: "",
    veryfrontMode: "",
    debug: false,
    ci: false,
    denoTesting: false,
    perfEnabled: false,
    apiBaseUrl: "http://localhost:4000",
    apiUrl: undefined,
    apiToken: undefined,
    projectSlug: undefined,
    homeDir: undefined,
    xdgConfigHome: undefined,
    continuousIntegration: false,
    sshClient: undefined,
    sshTty: undefined,
    display: undefined,
    waylandDisplay: undefined,
    cursorSession: undefined,
    serverStartTime: undefined,
    vcr: undefined,
    experimentalRsc: false,
    redisUrl: undefined,
    cacheDir: undefined,
    disableLruInterval: false,
    appUrl: undefined,
    port: 3000,
    requestTimeoutMs: undefined,
    httpFetchTimeoutMs: undefined,
    ssrMaxConcurrentTransforms: 3,
    otelEnabled: false,
    otelServiceName: undefined,
    otelEndpoint: undefined,
    otelTracesEndpoint: undefined,
    otelMetricsEndpoint: undefined,
    otelTracesExporter: undefined,
    otelMetricsExporter: undefined,
    otelHeaders: undefined,
    otelMetricsEnabled: false,
    openaiApiKey: undefined,
    openaiBaseUrl: undefined,
    anthropicApiKey: undefined,
    anthropicBaseUrl: undefined,
    googleApiKey: undefined,
    githubToken: undefined,
    githubOwner: undefined,
    githubRepo: undefined,
    githubRef: undefined,
    noColor: false,
    forceColor: false,
    veryfrontVersion: undefined,
    denoV8Flags: "",
    v8MaxOldSpaceSize: undefined,
    ...overrides,
  };
}

describe("config/env", () => {
  describe("getDisableLruIntervalEnv", () => {
    it("should return false by default", () => {
      assertEquals(getDisableLruIntervalEnv(createMockEnv()), false);
    });

    it("should return true when set", () => {
      assertEquals(getDisableLruIntervalEnv(createMockEnv({ disableLruInterval: true })), true);
    });
  });

  describe("getApiBaseUrlEnv", () => {
    it("should return the api base url", () => {
      assertEquals(
        getApiBaseUrlEnv(createMockEnv({ apiBaseUrl: "https://api.example.com" })),
        "https://api.example.com",
      );
    });
  });

  describe("getSsrMaxConcurrentTransformsEnv", () => {
    it("should return env value when set", () => {
      assertEquals(
        getSsrMaxConcurrentTransformsEnv(50, createMockEnv({ ssrMaxConcurrentTransforms: 10 })),
        10,
      );
    });

    it("should return default when env value is 0", () => {
      assertEquals(
        getSsrMaxConcurrentTransformsEnv(50, createMockEnv({ ssrMaxConcurrentTransforms: 0 })),
        50,
      );
    });
  });

  describe("getRedisUrlEnv", () => {
    it("should return undefined by default", () => {
      assertEquals(getRedisUrlEnv(createMockEnv()), undefined);
    });

    it("should return url when set", () => {
      assertEquals(
        getRedisUrlEnv(createMockEnv({ redisUrl: "redis://localhost:6379" })),
        "redis://localhost:6379",
      );
    });
  });

  describe("getV8FlagsEnv", () => {
    it("should return empty string by default", () => {
      assertEquals(getV8FlagsEnv(createMockEnv()), "");
    });

    it("should return flags when set", () => {
      assertEquals(
        getV8FlagsEnv(createMockEnv({ denoV8Flags: "--max-old-space-size=4096" })),
        "--max-old-space-size=4096",
      );
    });
  });

  describe("getCacheDirEnv", () => {
    it("should return undefined by default", () => {
      assertEquals(getCacheDirEnv(createMockEnv()), undefined);
    });

    it("should return path when set", () => {
      assertEquals(getCacheDirEnv(createMockEnv({ cacheDir: "/tmp/cache" })), "/tmp/cache");
    });
  });

  describe("isPerfEnabledEnv", () => {
    it("should return false by default", () => {
      assertEquals(isPerfEnabledEnv(createMockEnv()), false);
    });

    it("should return true when enabled", () => {
      assertEquals(isPerfEnabledEnv(createMockEnv({ perfEnabled: true })), true);
    });
  });

  describe("getGithubEnvConfig", () => {
    it("should return empty config by default", () => {
      const config = getGithubEnvConfig(createMockEnv());
      assertEquals(config.token, undefined);
      assertEquals(config.owner, undefined);
      assertEquals(config.repo, undefined);
      assertEquals(config.ref, undefined);
    });

    it("should return populated config", () => {
      const config = getGithubEnvConfig(
        createMockEnv({
          githubToken: "ghp_test",
          githubOwner: "org",
          githubRepo: "repo",
          githubRef: "main",
        }),
      );
      assertEquals(config.token, "ghp_test");
      assertEquals(config.owner, "org");
      assertEquals(config.repo, "repo");
      assertEquals(config.ref, "main");
    });
  });

  describe("getApiTokenEnv", () => {
    it("should return undefined by default", () => {
      assertEquals(getApiTokenEnv(createMockEnv()), undefined);
    });

    it("should return token when set", () => {
      assertEquals(getApiTokenEnv(createMockEnv({ apiToken: "vf_test" })), "vf_test");
    });
  });

  describe("getOpenAIEnvConfig", () => {
    it("should return empty config by default", () => {
      const config = getOpenAIEnvConfig(createMockEnv());
      assertEquals(config.apiKey, undefined);
      assertEquals(config.baseURL, undefined);
      assertEquals(config.organizationId, undefined);
    });

    it("should return populated config", () => {
      const config = getOpenAIEnvConfig(
        createMockEnv({ openaiApiKey: "sk-test", openaiBaseUrl: "https://api.openai.com" }),
      );
      assertEquals(config.apiKey, "sk-test");
      assertEquals(config.baseURL, "https://api.openai.com");
    });
  });

  describe("getAnthropicEnvConfig", () => {
    it("should return populated config", () => {
      const config = getAnthropicEnvConfig(
        createMockEnv({
          anthropicApiKey: "sk-ant-test",
          anthropicBaseUrl: "https://api.anthropic.com",
        }),
      );
      assertEquals(config.apiKey, "sk-ant-test");
      assertEquals(config.baseURL, "https://api.anthropic.com");
    });
  });

  describe("getGoogleGenAIEnvConfig", () => {
    it("should return api key when set", () => {
      const config = getGoogleGenAIEnvConfig(createMockEnv({ googleApiKey: "AIza-test" }));
      assertEquals(config.apiKey, "AIza-test");
    });
  });

  describe("isDebugEnvEnabled", () => {
    it("should return false by default", () => {
      assertEquals(isDebugEnvEnabled(createMockEnv()), false);
    });

    it("should return true when debug enabled", () => {
      assertEquals(isDebugEnvEnabled(createMockEnv({ debug: true })), true);
    });
  });

  describe("isCiEnv", () => {
    it("should return false by default", () => {
      assertEquals(isCiEnv(createMockEnv()), false);
    });

    it("should return true in CI", () => {
      assertEquals(isCiEnv(createMockEnv({ ci: true })), true);
    });
  });

  describe("isDenoTestingEnv", () => {
    it("should return false by default", () => {
      assertEquals(isDenoTestingEnv(createMockEnv()), false);
    });

    it("should return true when testing", () => {
      assertEquals(isDenoTestingEnv(createMockEnv({ denoTesting: true })), true);
    });
  });

  describe("getNoColorEnv", () => {
    it("should return undefined by default", () => {
      assertEquals(getNoColorEnv(createMockEnv()), undefined);
    });

    it("should return '1' when noColor is true", () => {
      assertEquals(getNoColorEnv(createMockEnv({ noColor: true })), "1");
    });
  });

  describe("getForceColorEnv", () => {
    it("should return undefined by default", () => {
      assertEquals(getForceColorEnv(createMockEnv()), undefined);
    });

    it("should return '1' when forceColor is true", () => {
      assertEquals(getForceColorEnv(createMockEnv({ forceColor: true })), "1");
    });
  });

  describe("isRscExperimentalEnabled", () => {
    it("should return false by default", () => {
      assertEquals(isRscExperimentalEnabled(createMockEnv()), false);
    });

    it("should return true when enabled", () => {
      assertEquals(isRscExperimentalEnabled(createMockEnv({ experimentalRsc: true })), true);
    });
  });

  describe("getVeryfrontVersion", () => {
    it("should return undefined by default", () => {
      assertEquals(getVeryfrontVersion(createMockEnv()), undefined);
    });

    it("should return version when set", () => {
      assertEquals(getVeryfrontVersion(createMockEnv({ veryfrontVersion: "1.2.3" })), "1.2.3");
    });
  });

  describe("getEnvironmentFromEnv", () => {
    it("should return veryfrontEnv when set", () => {
      assertEquals(getEnvironmentFromEnv(createMockEnv({ veryfrontEnv: "staging" })), "staging");
    });

    it("should fall back to nodeEnv when veryfrontEnv is empty", () => {
      assertEquals(
        getEnvironmentFromEnv(createMockEnv({ veryfrontEnv: "", nodeEnv: "production" })),
        "production",
      );
    });
  });

  describe("getOtelTracingConfig", () => {
    it("should return disabled config by default", () => {
      const config = getOtelTracingConfig(createMockEnv());
      assertEquals(config.enabledFlag, undefined);
      assertEquals(config.veryfrontFlag, undefined);
    });

    it("should return enabled config with flags", () => {
      const config = getOtelTracingConfig(
        createMockEnv({
          otelEnabled: true,
          otelServiceName: "my-svc",
          otelEndpoint: "http://localhost:4318",
          otelTracesExporter: "otlp",
        }),
      );
      assertEquals(config.enabledFlag, "true");
      assertEquals(config.veryfrontFlag, "1");
      assertEquals(config.serviceName, "my-svc");
      assertEquals(config.endpoint, "http://localhost:4318");
      assertEquals(config.exporter, "otlp");
    });
  });

  describe("getOtelMetricsConfig", () => {
    it("should return disabled config by default", () => {
      const config = getOtelMetricsConfig(createMockEnv());
      assertEquals(config.enabledFlag, undefined);
    });

    it("should return enabled config", () => {
      const config = getOtelMetricsConfig(
        createMockEnv({
          otelMetricsEnabled: true,
          otelEndpoint: "http://localhost:4318",
          otelMetricsEndpoint: "http://metrics:4318",
          otelMetricsExporter: "otlp",
        }),
      );
      assertEquals(config.enabledFlag, "1");
      assertEquals(config.endpoint, "http://localhost:4318");
      assertEquals(config.metricsEndpoint, "http://metrics:4318");
      assertEquals(config.exporter, "otlp");
    });
  });
});
