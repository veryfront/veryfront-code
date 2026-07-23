import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for runtime environment configuration.
 * @module
 */

import { afterEach, beforeEach, describe, it } from "#std/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
  createTestEnvironmentConfig,
  type EnvironmentConfig,
  getEnvironmentConfig,
  initEnvironmentConfig,
  isEnvironmentConfigInitialized,
  refreshEnvironmentConfig,
} from "./environment-config.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { DEFAULT_PORT } from "./defaults.ts";

function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

describe("EnvironmentConfig", () => {
  beforeEach(_resetEnvironmentConfig);
  beforeEach(markEnvLoaded);
  afterEach(() => {
    __resetEnvLoaderForTests();
    _resetEnvironmentConfig();
  });

  describe("initEnvironmentConfig", () => {
    it("initializes EnvironmentConfig from environment", () => {
      const env = initEnvironmentConfig();

      expect(env).toBeDefined();
      expect(typeof env.nodeEnv).toBe("string");
      expect(typeof env.debug).toBe("boolean");
      expect(typeof env.ci).toBe("boolean");
    });

    it("returns same instance on subsequent calls", () => {
      const env1 = initEnvironmentConfig();
      const env2 = initEnvironmentConfig();

      expect(env1).toBe(env2);
    });

    it("freezes the returned object", () => {
      const env = initEnvironmentConfig();

      expect(Object.isFrozen(env)).toBe(true);
    });
  });

  describe("getEnvironmentConfig", () => {
    it("auto-initializes if not initialized", () => {
      expect(isEnvironmentConfigInitialized()).toBe(false);

      const env = getEnvironmentConfig();

      expect(env).toBeDefined();
      expect(isEnvironmentConfigInitialized()).toBe(true);
    });

    it("returns initialized env", () => {
      const initialized = initEnvironmentConfig();
      const retrieved = getEnvironmentConfig();

      expect(retrieved).toBe(initialized);
    });

    it("returns an immutable uncached snapshot before environment loading", () => {
      __resetEnvLoaderForTests();
      _resetEnvironmentConfig();

      const env = getEnvironmentConfig();

      expect(Object.isFrozen(env)).toBe(true);
      expect(isEnvironmentConfigInitialized()).toBe(false);
    });
  });

  describe("isEnvironmentConfigInitialized", () => {
    it("returns false before initialization", () => {
      expect(isEnvironmentConfigInitialized()).toBe(false);
    });

    it("returns true after initialization", () => {
      initEnvironmentConfig();
      expect(isEnvironmentConfigInitialized()).toBe(true);
    });

    it("returns false after reset", () => {
      initEnvironmentConfig();
      _resetEnvironmentConfig();
      expect(isEnvironmentConfigInitialized()).toBe(false);
    });
  });

  describe("createTestEnvironmentConfig", () => {
    it("creates env with test defaults", () => {
      const env = createTestEnvironmentConfig();

      expect(env.nodeEnv).toBe("test");
      expect(env.debug).toBe(false);
      expect(env.ci).toBe(false);
      expect(env.denoTesting).toBe(false);
      expect(Object.isFrozen(env)).toBe(true);
    });

    it("allows overrides", () => {
      const env = createTestEnvironmentConfig({
        debug: true,
        experimentalRsc: true,
        port: 9999,
      });

      expect(env.debug).toBe(true);
      expect(env.experimentalRsc).toBe(true);
      expect(env.port).toBe(9999);
      expect(env.nodeEnv).toBe("test");
    });

    it("does not affect global singleton", () => {
      initEnvironmentConfig();
      const globalEnv = getEnvironmentConfig();

      const testEnv = createTestEnvironmentConfig({ debug: true });

      expect(testEnv.debug).toBe(true);
      expect(getEnvironmentConfig()).toBe(globalEnv);
      expect(getEnvironmentConfig().debug).toBe(globalEnv.debug);
    });

    it("can override nodeEnv", () => {
      const env = createTestEnvironmentConfig({ nodeEnv: "production" });

      expect(env.nodeEnv).toBe("production");
    });
  });

  describe("_setEnvironmentConfigForTesting", () => {
    it("overrides global env", () => {
      initEnvironmentConfig();

      _setEnvironmentConfigForTesting({ debug: true, port: 8888 });

      const env = getEnvironmentConfig();
      expect(env.debug).toBe(true);
      expect(env.port).toBe(8888);
      expect(env.portFromEnv).toBe(true);
    });

    it("freezes the overridden env", () => {
      _setEnvironmentConfigForTesting({ debug: true });

      const env = getEnvironmentConfig();
      expect(Object.isFrozen(env)).toBe(true);
    });
  });

  describe("_resetEnvironmentConfig", () => {
    it("clears the singleton", () => {
      initEnvironmentConfig();
      expect(isEnvironmentConfigInitialized()).toBe(true);

      _resetEnvironmentConfig();

      expect(isEnvironmentConfigInitialized()).toBe(false);
    });
  });

  describe("test isolation pattern", () => {
    it("createTestEnvironmentConfig provides isolated config for tests", () => {
      const testEnv = createTestEnvironmentConfig({
        apiToken: "test-token-123",
        projectSlug: "test-project",
        ci: true,
      });

      expect(testEnv.apiToken).toBe("test-token-123");
      expect(testEnv.projectSlug).toBe("test-project");
      expect(testEnv.ci).toBe(true);
      expect(testEnv.nodeEnv).toBe("test");

      const globalEnv = getEnvironmentConfig();
      expect(globalEnv.apiToken).not.toBe("test-token-123");
    });

    it("test envs are independent of each other", () => {
      const env1 = createTestEnvironmentConfig({ port: 1111 });
      const env2 = createTestEnvironmentConfig({ port: 2222 });

      expect(env1.port).toBe(1111);
      expect(env2.port).toBe(2222);
      expect(env1.port).toBe(1111);
    });

    it("supports CLI-specific fields", () => {
      const env = createTestEnvironmentConfig({
        homeDir: "/home/test",
        xdgConfigHome: "/home/test/.config",
        sshClient: "192.168.1.1 12345 22",
        cursorSession: "test-session",
      });

      expect(env.homeDir).toBe("/home/test");
      expect(env.xdgConfigHome).toBe("/home/test/.config");
      expect(env.sshClient).toBe("192.168.1.1 12345 22");
      expect(env.cursorSession).toBe("test-session");
    });
  });

  describe("environment variable parsing", () => {
    it("has expected default values", () => {
      const env = createTestEnvironmentConfig();

      expect(env.apiBaseUrl).toBeDefined();
      expect(typeof env.apiBaseUrl).toBe("string");
      expect(env.ssrMaxConcurrentTransforms).toBe(3);
    });

    it("handles all EnvironmentConfig properties", () => {
      const env = createTestEnvironmentConfig();

      const expectedProps: (keyof EnvironmentConfig)[] = [
        "nodeEnv",
        "veryfrontEnv",
        "veryfrontMode",
        "proxyMode",
        "debug",
        "ci",
        "denoTesting",
        "perfEnabled",
        "apiBaseUrl",
        "publicApiBaseUrl",
        "apiUrl",
        "apiToken",
        "projectSlug",
        "homeDir",
        "xdgConfigHome",
        "continuousIntegration",
        "sshClient",
        "sshTty",
        "display",
        "waylandDisplay",
        "cursorSession",
        "serverStartTime",
        "vcr",
        "experimentalRsc",
        "redisUrl",
        "cacheDir",
        "disableLruInterval",
        "appUrl",
        "port",
        "requestTimeoutMs",
        "httpFetchTimeoutMs",
        "extensionSetupTimeoutMs",
        "ssrMaxConcurrentTransforms",
        "otelEnabled",
        "otelServiceName",
        "otelEndpoint",
        "otelTracesEndpoint",
        "otelMetricsEndpoint",
        "otelTracesExporter",
        "otelMetricsExporter",
        "otelHeaders",
        "otelTracesHeaders",
        "otelMetricsHeaders",
        "otelMetricsEnabled",
        "openaiApiKey",
        "openaiBaseUrl",
        "anthropicApiKey",
        "anthropicBaseUrl",
        "googleApiKey",
        "githubToken",
        "githubOwner",
        "githubRepo",
        "githubRef",
        "noColor",
        "forceColor",
        "denoV8Flags",
        "v8MaxOldSpaceSize",
        "veryfrontVersion",
      ];

      for (const prop of expectedProps) {
        expect(prop in env).toBe(true);
      }
    });

    it("rejects partial, fractional, non-positive, and invalid port values", () => {
      const invalidPositiveIntegers = [
        "12px",
        "1.5",
        "0",
        "-1",
        "1e3",
        "0x10",
        "+42",
        " 42 ",
      ];

      withEnvironment(
        {
          PORT: undefined,
          REQUEST_TIMEOUT_MS: undefined,
          VF_HTTP_FETCH_TIMEOUT: undefined,
          VF_EXTENSION_SETUP_TIMEOUT_MS: undefined,
          SSR_MAX_CONCURRENT_TRANSFORMS: undefined,
          V8_MAX_OLD_SPACE_SIZE: undefined,
        },
        () => {
          for (const value of invalidPositiveIntegers) {
            Deno.env.set("PORT", value);
            Deno.env.set("REQUEST_TIMEOUT_MS", value);
            Deno.env.set("VF_HTTP_FETCH_TIMEOUT", value);
            Deno.env.set("VF_EXTENSION_SETUP_TIMEOUT_MS", value);
            Deno.env.set("SSR_MAX_CONCURRENT_TRANSFORMS", value);
            Deno.env.set("V8_MAX_OLD_SPACE_SIZE", value);

            const env = refreshEnvironmentConfig();
            expect(env.port).toBe(DEFAULT_PORT);
            expect(env.requestTimeoutMs).toBe(30_000);
            expect(env.httpFetchTimeoutMs).toBe(30_000);
            expect(env.extensionSetupTimeoutMs).toBe(30_000);
            expect(env.ssrMaxConcurrentTransforms).toBe(3);
            expect(env.v8MaxOldSpaceSize).toBeUndefined();
          }

          Deno.env.set("PORT", "65536");
          expect(refreshEnvironmentConfig().port).toBe(DEFAULT_PORT);
        },
      );
    });

    it("accepts conventional truthy flags and respects NO_COLOR presence", () => {
      withEnvironment(
        {
          CI: "true",
          PROXY_MODE: "true",
          DENO_TESTING: "yes",
          VERYFRONT_PERF: "true",
          VERYFRONT_EXPERIMENTAL_RSC: "yes",
          VF_DISABLE_LRU_INTERVAL: "true",
          NO_COLOR: "",
          FORCE_COLOR: "0",
        },
        () => {
          const env = refreshEnvironmentConfig();
          expect(env.ci).toBe(true);
          expect(env.proxyMode).toBe(true);
          expect(env.denoTesting).toBe(true);
          expect(env.perfEnabled).toBe(true);
          expect(env.experimentalRsc).toBe(true);
          expect(env.disableLruInterval).toBe(true);
          expect(env.noColor).toBe(true);
          expect(env.forceColor).toBe(false);
        },
      );
    });

    it("records whether PORT was explicitly configured", () => {
      withEnvironment({ PORT: undefined }, () => {
        expect("portFromEnv" in refreshEnvironmentConfig()).toBe(true);
        expect(
          (refreshEnvironmentConfig() as EnvironmentConfig & { portFromEnv: boolean }).portFromEnv,
        )
          .toBe(false);

        Deno.env.set("PORT", "4321");
        const configured = refreshEnvironmentConfig() as EnvironmentConfig & {
          portFromEnv: boolean;
        };
        expect(configured.port).toBe(4321);
        expect(configured.portFromEnv).toBe(true);
      });
    });

    it("captures generic and signal-specific OpenTelemetry headers", () => {
      withEnvironment(
        {
          OTEL_EXPORTER_OTLP_HEADERS: "x-shared=<TOKEN>",
          OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-traces=<TOKEN>",
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-metrics=<TOKEN>",
        },
        () => {
          const env = refreshEnvironmentConfig();
          expect(env.otelHeaders).toBe("x-shared=<TOKEN>");
          expect(
            (env as EnvironmentConfig & { otelTracesHeaders?: string }).otelTracesHeaders,
          ).toBe("x-traces=<TOKEN>");
          expect(
            (env as EnvironmentConfig & { otelMetricsHeaders?: string }).otelMetricsHeaders,
          ).toBe("x-metrics=<TOKEN>");
        },
      );
    });

    it("does not retain project-scoped secrets in the process snapshot", () => {
      withEnvironment(
        {
          VERYFRONT_API_BASE_URL: "https://host.example.test/api",
          VERYFRONT_API_TOKEN: "<HOST_TOKEN>",
          OPENAI_API_KEY: "<HOST_OPENAI_KEY>",
          GITHUB_TOKEN: "<HOST_GITHUB_TOKEN>",
        },
        () => {
          const env = runWithProjectEnv(
            {
              VERYFRONT_API_BASE_URL: "https://tenant.example.test/api",
              VERYFRONT_API_TOKEN: "<PROJECT_TOKEN>",
              OPENAI_API_KEY: "<PROJECT_OPENAI_KEY>",
              GITHUB_TOKEN: "<PROJECT_GITHUB_TOKEN>",
            },
            refreshEnvironmentConfig,
          );

          expect(env.apiBaseUrl).toBe("https://host.example.test/api");
          expect(env.apiToken).toBe("<HOST_TOKEN>");
          expect(env.openaiApiKey).toBe("<HOST_OPENAI_KEY>");
          expect(env.githubToken).toBe("<HOST_GITHUB_TOKEN>");
        },
      );
    });
  });
});
