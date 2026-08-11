import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for runtime environment configuration.
 * @module
 */

import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
  createTestEnvironmentConfig,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type EnvironmentConfig,
  getEnvironmentConfig,
  initEnvironmentConfig,
  isEnvironmentConfigInitialized,
  refreshEnvironmentConfig,
} from "./environment-config.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";

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

    it("keeps early snapshots immutable and uncached until environment loading completes", async () => {
      __resetEnvLoaderForTests();
      const originalWarn = logger.warn;
      const warnings: string[] = [];
      logger.warn = (message: string) => warnings.push(message);

      try {
        await withEnv({ VERYFRONT_API_TOKEN: "before-load" }, async () => {
          const first = getEnvironmentConfig();
          expect(first.apiToken).toBe("before-load");
          expect(Object.isFrozen(first)).toBe(true);
          expect(isEnvironmentConfigInitialized()).toBe(false);

          setEnv("VERYFRONT_API_TOKEN", "after-mutation");
          const second = getEnvironmentConfig();
          expect(second.apiToken).toBe("after-mutation");
          expect(second).not.toBe(first);
          expect(Object.isFrozen(second)).toBe(true);
          expect(isEnvironmentConfigInitialized()).toBe(false);
          expect(warnings).toHaveLength(0);

          const earlyInit = initEnvironmentConfig();
          expect(earlyInit.apiToken).toBe("after-mutation");
          expect(Object.isFrozen(earlyInit)).toBe(true);
          expect(isEnvironmentConfigInitialized()).toBe(false);

          markEnvLoaded();
          const loaded = getEnvironmentConfig();
          expect(loaded.apiToken).toBe("after-mutation");
          expect(Object.isFrozen(loaded)).toBe(true);
          expect(isEnvironmentConfigInitialized()).toBe(true);
          expect(getEnvironmentConfig()).toBe(loaded);
        });
      } finally {
        logger.warn = originalWarn;
      }
    });

    // Regression: a second copy of the framework can be loaded from the
    // project's own node_modules mid-request (globally installed CLI + local
    // `veryfront` dependency). That copy never runs loadEnv, so the early
    // access diagnostic fired on the user's first agent request. The advice it
    // carries ("ensure loadEnv runs before environment config access") is only
    // actionable by framework code, so it must not reach the user's console.
    it("keeps the early-access ordering diagnostic off the user-facing warn channel", async () => {
      __resetEnvLoaderForTests();
      const originalWarn = logger.warn;
      const originalDebug = logger.debug;
      const warnings: string[] = [];
      const debugMessages: string[] = [];
      logger.warn = (message: string) => warnings.push(message);
      logger.debug = (message: string) => debugMessages.push(message);

      try {
        await withEnv({ VERYFRONT_DEBUG_RUNTIME_ENV: "0" }, async () => {
          getEnvironmentConfig();
          getEnvironmentConfig();
        });
      } finally {
        logger.warn = originalWarn;
        logger.debug = originalDebug;
      }

      expect(warnings).toHaveLength(0);
      expect(debugMessages.filter((m) => m.includes("[EnvironmentConfig]"))).toHaveLength(1);
    });

    it("keeps the early-access diagnostic on warn with a stack under VERYFRONT_DEBUG_RUNTIME_ENV", async () => {
      __resetEnvLoaderForTests();
      const originalWarn = logger.warn;
      const warnings: unknown[][] = [];
      logger.warn = (...args: unknown[]) => warnings.push(args);

      try {
        await withEnv({ VERYFRONT_DEBUG_RUNTIME_ENV: "1" }, async () => {
          getEnvironmentConfig();
        });
      } finally {
        logger.warn = originalWarn;
      }

      expect(warnings).toHaveLength(1);
      const [message, details] = warnings[0] ?? [];
      expect(String(message)).toContain("[EnvironmentConfig]");
      expect(details).toHaveProperty("stack");
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
      expect(env.veryfrontEnv).toBe("test");
      expect(env.debug).toBe(false);
      expect(env.ci).toBe(false);
      expect(env.denoTesting).toBe(false);
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

    it("allows explicit test environment names without inheriting host values", async () => {
      await withEnv(
        {
          NODE_ENV: "production",
          VERYFRONT_ENV: "production",
          VERYFRONT_API_TOKEN: "host-api-token",
          OPENAI_API_KEY: "host-openai-key",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://host-collector.example",
          HOME: "/host/home",
        },
        async () => {
          _resetEnvironmentConfig();

          const defaultEnv = createTestEnvironmentConfig();
          const overriddenEnv = createTestEnvironmentConfig({
            nodeEnv: "development",
            veryfrontEnv: "preview",
          });

          expect(defaultEnv.nodeEnv).toBe("test");
          expect(defaultEnv.veryfrontEnv).toBe("test");
          expect(overriddenEnv.nodeEnv).toBe("development");
          expect(overriddenEnv.veryfrontEnv).toBe("preview");
          expect(defaultEnv.apiToken).toBeUndefined();
          expect(defaultEnv.openaiApiKey).toBeUndefined();
          expect(defaultEnv.otelEndpoint).toBeUndefined();
          expect(defaultEnv.homeDir).toBeUndefined();
        },
      );
    });
  });

  describe("_setEnvironmentConfigForTesting", () => {
    it("overrides global env", () => {
      initEnvironmentConfig();

      _setEnvironmentConfigForTesting({ debug: true, port: 8888 });

      const env = getEnvironmentConfig();
      expect(env.debug).toBe(true);
      expect(env.port).toBe(8888);
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

    it("maps every environment source to the exact config field", async () => {
      await withEnv(
        {
          NODE_ENV: "production",
          VERYFRONT_ENV: "preview",
          VERYFRONT_MODE: "hosted",
          PROXY_MODE: "1",
          VERYFRONT_DEBUG: "yes",
          CI: "true",
          DENO_TESTING: "1",
          VERYFRONT_PERF: "1",
          VERYFRONT_API_BASE_URL: "https://api-base.example",
          VERYFRONT_PUBLIC_API_BASE_URL: "https://public-api.example",
          VERYFRONT_API_URL: "https://graphql.example/graphql",
          VERYFRONT_API_TOKEN: "vf-token",
          VERYFRONT_PROJECT_SLUG: "project-slug",
          HOME: "/home/veryfront",
          XDG_CONFIG_HOME: "/config/veryfront",
          CONTINUOUS_INTEGRATION: "yes",
          SSH_CLIENT: "192.0.2.1 1234 22",
          SSH_TTY: "/dev/pts/1",
          DISPLAY: ":1",
          WAYLAND_DISPLAY: "wayland-1",
          CURSOR_SESSION: "cursor-session",
          VERYFRONT_SERVER_START_TIME: "2026-07-25T10:00:00Z",
          VCR: "record",
          VERYFRONT_EXPERIMENTAL_RSC: "1",
          REDIS_URL: "redis://cache.example:6379",
          VERYFRONT_CACHE_DIR: "/cache/veryfront",
          VF_DISABLE_LRU_INTERVAL: "1",
          APP_URL: "https://app.example",
          PORT: "4321",
          REQUEST_TIMEOUT_MS: "70000",
          VF_HTTP_FETCH_TIMEOUT: "25000",
          VF_EXTENSION_SETUP_TIMEOUT_MS: "15000",
          SSR_MAX_CONCURRENT_TRANSFORMS: "7",
          VERYFRONT_OTEL: "true",
          OTEL_SERVICE_NAME: "veryfront-test",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example",
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otel.example/traces",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otel.example/metrics",
          OTEL_TRACES_EXPORTER: "otlp",
          OTEL_METRICS_EXPORTER: "otlp",
          OTEL_EXPORTER_OTLP_HEADERS: "authorization=test",
          OTEL_METRICS_ENABLED: "yes",
          OPENAI_API_KEY: "openai-key",
          OPENAI_BASE_URL: "https://openai.example",
          ANTHROPIC_API_KEY: "anthropic-key",
          ANTHROPIC_BASE_URL: "https://anthropic.example",
          GOOGLE_API_KEY: "google-key",
          GITHUB_TOKEN: "github-token",
          GITHUB_OWNER: "veryfront",
          GITHUB_REPO: "veryfront-code",
          GITHUB_REF: "refs/heads/main",
          NO_COLOR: "",
          FORCE_COLOR: "2",
          DENO_V8_FLAGS: "--trace-gc",
          V8_MAX_OLD_SPACE_SIZE: "4096",
          VERYFRONT_VERSION: "1.2.3",
        },
        async () => {
          _resetEnvironmentConfig();
          const env = refreshEnvironmentConfig();

          expect(env).toEqual(
            {
              nodeEnv: "production",
              veryfrontEnv: "preview",
              veryfrontMode: "hosted",
              proxyMode: true,
              debug: true,
              ci: true,
              denoTesting: true,
              perfEnabled: true,
              apiBaseUrl: "https://api-base.example",
              publicApiBaseUrl: "https://public-api.example",
              apiUrl: "https://graphql.example/graphql",
              apiToken: "vf-token",
              projectSlug: "project-slug",
              homeDir: "/home/veryfront",
              xdgConfigHome: "/config/veryfront",
              continuousIntegration: true,
              sshClient: "192.0.2.1 1234 22",
              sshTty: "/dev/pts/1",
              display: ":1",
              waylandDisplay: "wayland-1",
              cursorSession: "cursor-session",
              serverStartTime: "2026-07-25T10:00:00Z",
              vcr: "record",
              experimentalRsc: true,
              redisUrl: "redis://cache.example:6379",
              cacheDir: "/cache/veryfront",
              disableLruInterval: true,
              appUrl: "https://app.example",
              port: 4321,
              portSource: "environment",
              requestTimeoutMs: 70000,
              httpFetchTimeoutMs: 25000,
              extensionSetupTimeoutMs: 15000,
              ssrMaxConcurrentTransforms: 7,
              otelEnabled: true,
              otelServiceName: "veryfront-test",
              otelEndpoint: "https://otel.example",
              otelTracesEndpoint: "https://otel.example/traces",
              otelMetricsEndpoint: "https://otel.example/metrics",
              otelTracesExporter: "otlp",
              otelMetricsExporter: "otlp",
              otelHeaders: "authorization=test",
              otelMetricsEnabled: true,
              openaiApiKey: "openai-key",
              openaiBaseUrl: "https://openai.example",
              anthropicApiKey: "anthropic-key",
              anthropicBaseUrl: "https://anthropic.example",
              googleApiKey: "google-key",
              githubToken: "github-token",
              githubOwner: "veryfront",
              githubRepo: "veryfront-code",
              githubRef: "refs/heads/main",
              noColor: true,
              forceColor: true,
              denoV8Flags: "--trace-gc",
              v8MaxOldSpaceSize: 4096,
              veryfrontVersion: "1.2.3",
            } satisfies EnvironmentConfig,
          );
        },
      );
    });

    it("uses documented fallback aliases only when primary variables are absent", async () => {
      await withEnv(
        {
          DENO_ENV: "deno-environment",
          VERYFRONT_API_URL: "https://api.example/graphql",
          USERPROFILE: "C:\\Users\\veryfront",
          VF_CACHE_DIR: "/fallback-cache",
          NEXT_PUBLIC_APP_URL: "https://fallback-app.example",
          GOOGLE_GENERATIVE_AI_API_KEY: "fallback-google-key",
          RELEASE_VERSION: "9.8.7",
        },
        async () => {
          for (
            const key of [
              "NODE_ENV",
              "VERYFRONT_ENV",
              "VERYFRONT_API_BASE_URL",
              "HOME",
              "VERYFRONT_CACHE_DIR",
              "APP_URL",
              "GOOGLE_API_KEY",
              "VERYFRONT_VERSION",
            ]
          ) {
            deleteEnv(key);
          }

          _resetEnvironmentConfig();
          const env = refreshEnvironmentConfig();
          expect(env.nodeEnv).toBe("deno-environment");
          expect(env.veryfrontEnv).toBe("deno-environment");
          expect(env.apiBaseUrl).toBe("https://api.example/api");
          expect(env.homeDir).toBe("C:\\Users\\veryfront");
          expect(env.cacheDir).toBe("/fallback-cache");
          expect(env.appUrl).toBe("https://fallback-app.example");
          expect(env.googleApiKey).toBe("fallback-google-key");
          expect(env.veryfrontVersion).toBe("9.8.7");
        },
      );
    });

    it("parses bounded integer environment values without truncation", async () => {
      await withEnv(
        {
          PORT: " 65535 ",
          REQUEST_TIMEOUT_MS: "1234",
          VF_HTTP_FETCH_TIMEOUT: "2345",
          VF_EXTENSION_SETUP_TIMEOUT_MS: "0",
          SSR_MAX_CONCURRENT_TRANSFORMS: "0",
          V8_MAX_OLD_SPACE_SIZE: "4096",
        },
        async () => {
          _resetEnvironmentConfig();
          const env = refreshEnvironmentConfig();

          expect(env.port).toBe(65535);
          expect(env.portSource).toBe("environment");
          expect(env.requestTimeoutMs).toBe(1234);
          expect(env.httpFetchTimeoutMs).toBe(2345);
          expect(env.extensionSetupTimeoutMs).toBe(0);
          expect(env.ssrMaxConcurrentTransforms).toBe(0);
          expect(env.v8MaxOldSpaceSize).toBe(4096);
        },
      );
    });

    it("falls back safely for malformed or out-of-range integer values", async () => {
      await withEnv(
        {
          PORT: "65536",
          REQUEST_TIMEOUT_MS: "30000ms",
          VF_HTTP_FETCH_TIMEOUT: "1.5",
          VF_EXTENSION_SETUP_TIMEOUT_MS: "2147483648",
          SSR_MAX_CONCURRENT_TRANSFORMS: "1e2",
          V8_MAX_OLD_SPACE_SIZE: "-1",
        },
        async () => {
          _resetEnvironmentConfig();
          const env = refreshEnvironmentConfig();

          expect(env.port).toBe(3000);
          expect(env.portSource).toBe("default");
          expect(env.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
          expect(env.httpFetchTimeoutMs).toBe(30000);
          expect(env.extensionSetupTimeoutMs).toBe(30000);
          expect(env.ssrMaxConcurrentTransforms).toBe(3);
          expect(env.v8MaxOldSpaceSize).toBeUndefined();
        },
      );
    });

    it("uses standard presence and truth-value semantics for CI and color flags", async () => {
      await withEnv(
        {
          CI: "true",
          CONTINUOUS_INTEGRATION: "0",
          NO_COLOR: "",
          FORCE_COLOR: "0",
        },
        async () => {
          _resetEnvironmentConfig();
          const env = refreshEnvironmentConfig();

          expect(env.ci).toBe(true);
          expect(env.continuousIntegration).toBe(false);
          expect(env.noColor).toBe(true);
          expect(env.forceColor).toBe(false);
        },
      );

      await withEnv({ FORCE_COLOR: "2" }, async () => {
        _resetEnvironmentConfig();
        expect(refreshEnvironmentConfig().forceColor).toBe(true);
      });
    });
  });
});
