import "#veryfront/schemas/_test-setup.ts";
/****
 * Tests for runtime configuration.
 * @module
 */

import { afterEach, beforeEach, describe, it } from "#std/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  _resetRuntimeConfig,
  _setRuntimeConfigForTesting,
  createRuntimeConfig,
  createTestConfig,
  DEFAULT_CONFIG,
  getRuntimeConfig,
  initRuntimeConfig,
  isRuntimeConfigInitialized,
  type RuntimeConfig,
  updateRuntimeConfig,
} from "./runtime-config.ts";
import { _resetEnvironmentConfig, createTestEnvironmentConfig } from "./environment-config.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";

function reset(): void {
  _resetRuntimeConfig();
  _resetEnvironmentConfig();
  __resetEnvLoaderForTests();
  markEnvLoaded();
}

describe("RuntimeConfig", () => {
  beforeEach(reset);
  afterEach(reset);

  describe("DEFAULT_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_CONFIG.title).toBe("Veryfront App");
      expect(DEFAULT_CONFIG.description).toBe("Built with Veryfront");
      expect(DEFAULT_CONFIG.experimental?.esmLayouts).toBe(true);
      expect(DEFAULT_CONFIG.build?.outDir).toBe("dist");
      expect(DEFAULT_CONFIG.dev?.port).toBe(3000);
      expect(DEFAULT_CONFIG.cache?.dir).toBe(".veryfront/cache");
    });

    it("keeps exported runtime defaults immutable", () => {
      expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.experimental)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.theme)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.theme?.colors)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.build)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.cache)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.cache?.render)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CONFIG.dev)).toBe(true);
    });
  });

  describe("createRuntimeConfig", () => {
    it("creates config with defaults", () => {
      const env = createTestEnvironmentConfig();
      const config = createRuntimeConfig({}, env);

      expect(config.title).toBe("Veryfront App");
      expect(config.runtime).toBeDefined();
      expect(config.runtime.env).toBe(env);
    });

    it("returns an immutable runtime snapshot", () => {
      const extension = {
        name: "mutable-extension",
        enabled: false as const,
        state: { ready: false },
      };
      const middleware = { handle: () => undefined };
      const fileConfig = {
        resolve: {
          importMap: {
            imports: { example: "https://example.com/module.ts" },
          },
        },
        extensions: [extension],
        middleware: { custom: [middleware] },
      };
      const config = createRuntimeConfig(fileConfig, createTestEnvironmentConfig());

      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.runtime)).toBe(true);
      expect(Object.isFrozen(config.runtime.env)).toBe(true);
      expect(Object.isFrozen(config.dev)).toBe(true);
      expect(Object.isFrozen(config.cache)).toBe(true);
      expect(Object.isFrozen(config.cache?.render)).toBe(true);
      expect(Object.isFrozen(config.observability)).toBe(true);
      expect(Object.isFrozen(config.resolve)).toBe(true);
      expect(Object.isFrozen(config.resolve?.importMap)).toBe(true);
      expect(Object.isFrozen(config.resolve?.importMap?.imports)).toBe(true);
      expect(config.resolve).not.toBe(fileConfig.resolve);
      expect(Object.isFrozen(fileConfig.resolve)).toBe(false);

      expect(Object.isFrozen(config.extensions)).toBe(true);
      expect(config.extensions?.[0]).toBe(extension);
      expect(Object.isFrozen(extension)).toBe(false);
      expect(Object.isFrozen(config.middleware?.custom)).toBe(true);
      expect(config.middleware?.custom?.[0]).toBe(middleware);
      expect(Object.isFrozen(middleware)).toBe(false);
    });

    it("snapshots a mutable environment before computing runtime flags", () => {
      const mutableEnv = {
        ...createTestEnvironmentConfig({ nodeEnv: "development" }),
      };
      const config = createRuntimeConfig({}, mutableEnv);

      mutableEnv.nodeEnv = "production";

      expect(config.runtime.env).not.toBe(mutableEnv);
      expect(config.runtime.env.nodeEnv).toBe("development");
      expect(config.runtime.isDevelopment).toBe(true);
      expect(config.runtime.isProduction).toBe(false);
    });

    it("merges file config with defaults", () => {
      const env = createTestEnvironmentConfig();
      const config = createRuntimeConfig(
        { title: "My App", projectSlug: "my-app" },
        env,
      );

      expect(config.title).toBe("My App");
      expect(config.projectSlug).toBe("my-app");
      expect(config.description).toBe("Built with Veryfront");
    });

    it("preserves nested defaults when file config overrides one field", () => {
      const config = createRuntimeConfig(
        {
          build: { outDir: "output" },
          cache: { dir: "cache" },
          theme: { colors: { secondary: "#000000" } },
        },
        createTestEnvironmentConfig(),
      );

      expect(config.build?.outDir).toBe("output");
      expect(config.build?.trailingSlash).toBe(false);
      expect(config.cache?.dir).toBe("cache");
      expect(config.cache?.render?.type).toBe("memory");
      expect(config.theme?.colors?.primary).toBe("#3B82F6");
      expect(config.theme?.colors?.secondary).toBe("#000000");
    });

    it("keeps the file port when PORT is not explicitly configured", () => {
      const env = createTestEnvironmentConfig({ port: 3001, portFromEnv: false });

      const config = createRuntimeConfig({ dev: { port: 4321 } }, env);

      expect(config.dev?.port).toBe(4321);
    });

    it("computes runtime flags correctly", () => {
      const prodConfig = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({ nodeEnv: "production" }),
      );

      expect(prodConfig.runtime.isProduction).toBe(true);
      expect(prodConfig.runtime.isDevelopment).toBe(false);
      expect(prodConfig.runtime.isTest).toBe(false);

      const devConfig = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({ nodeEnv: "development" }),
      );

      expect(devConfig.runtime.isProduction).toBe(false);
      expect(devConfig.runtime.isDevelopment).toBe(true);
      expect(devConfig.runtime.isTest).toBe(false);

      const testConfig = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({ nodeEnv: "test" }),
      );

      expect(testConfig.runtime.isProduction).toBe(false);
      expect(testConfig.runtime.isDevelopment).toBe(false);
      expect(testConfig.runtime.isTest).toBe(true);
    });

    it("detects test mode from DENO_TESTING", () => {
      const config = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({ nodeEnv: "development", denoTesting: true }),
      );

      expect(config.runtime.isTest).toBe(true);
    });

    it("env projectSlug overrides file config", () => {
      const config = createRuntimeConfig(
        { projectSlug: "file-slug" },
        createTestEnvironmentConfig({ projectSlug: "env-slug" }),
      );

      expect(config.projectSlug).toBe("env-slug");
    });

    it("env can enable experimental.rsc", () => {
      const config = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({ experimentalRsc: true }),
      );

      expect(config.experimental?.rsc).toBe(true);
    });

    it("file config experimental.rsc takes precedence", () => {
      const config = createRuntimeConfig(
        { experimental: { rsc: true } },
        createTestEnvironmentConfig({ experimentalRsc: false }),
      );

      expect(config.experimental?.rsc).toBe(true);
    });

    it("env port overrides file config", () => {
      const env = createTestEnvironmentConfig({ port: 9000, portFromEnv: true });
      const config = createRuntimeConfig(
        { dev: { port: 3000 } },
        env,
      );

      expect(config.dev?.port).toBe(9000);
    });

    it("ignores project-file observability routing in shared proxy mode", () => {
      const config = createRuntimeConfig(
        {
          observability: {
            tracing: {
              enabled: true,
              endpoint: "https://tenant-collector.example/otlp",
              serviceName: "tenant-service",
            },
            metrics: {
              enabled: true,
              endpoint: "https://tenant-metrics.example/otlp",
            },
          },
        },
        createTestEnvironmentConfig({
          proxyMode: true,
          otelEnabled: false,
          otelEndpoint: undefined,
          otelServiceName: undefined,
          otelMetricsEnabled: false,
          otelMetricsEndpoint: undefined,
        }),
      );

      expect(config.observability?.tracing?.enabled).toBe(false);
      expect(config.observability?.tracing?.endpoint).toBeUndefined();
      expect(config.observability?.tracing?.serviceName).toBeUndefined();
      expect(config.observability?.metrics?.enabled).toBe(false);
      expect(config.observability?.metrics?.endpoint).toBeUndefined();
    });

    it("keeps host OTel routing while allowing project tracing service identity", () => {
      const config = createRuntimeConfig(
        {
          projectSlug: "veryfront-ops-agent",
          observability: {
            tracing: {
              serviceName: "veryfront-ops-agent",
            },
          },
        },
        createTestEnvironmentConfig({
          proxyMode: false,
          otelEnabled: true,
          otelEndpoint: "https://platform-collector.example/otlp",
          otelServiceName: "veryfront-agent",
        }),
      );

      expect(config.observability?.tracing?.enabled).toBe(true);
      expect(config.observability?.tracing?.endpoint).toBe(
        "https://platform-collector.example/otlp",
      );
      expect(config.observability?.tracing?.serviceName).toBe("veryfront-ops-agent");
    });

    it("preserves project logging configuration outside shared proxy mode", () => {
      const config = createRuntimeConfig(
        {
          observability: {
            logging: {
              file: {
                enabled: true,
                path: "logs/application.log",
                level: "warn",
                format: "json",
              },
            },
          },
        },
        createTestEnvironmentConfig({ proxyMode: false }),
      );

      expect(config.observability?.logging?.file).toEqual({
        enabled: true,
        path: "logs/application.log",
        level: "warn",
        format: "json",
      });
    });

    it("prefers signal-specific OTel endpoints and falls back to the shared endpoint", () => {
      const signalSpecific = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({
          otelEndpoint: "https://collector.example/otlp",
          otelTracesEndpoint: "https://traces.example/otlp",
          otelMetricsEndpoint: "https://metrics.example/otlp",
        }),
      );

      expect(signalSpecific.observability?.tracing?.endpoint).toBe(
        "https://traces.example/otlp",
      );
      expect(signalSpecific.observability?.metrics?.endpoint).toBe(
        "https://metrics.example/otlp",
      );

      const shared = createRuntimeConfig(
        {},
        createTestEnvironmentConfig({
          otelEndpoint: "https://collector.example/otlp",
          otelTracesEndpoint: undefined,
          otelMetricsEndpoint: undefined,
        }),
      );

      expect(shared.observability?.tracing?.endpoint).toBe(
        "https://collector.example/otlp",
      );
      expect(shared.observability?.metrics?.endpoint).toBe(
        "https://collector.example/otlp",
      );
    });
  });

  describe("initRuntimeConfig", () => {
    it("initializes with defaults", () => {
      const config = initRuntimeConfig();

      expect(config).toBeDefined();
      expect(config.title).toBe("Veryfront App");
      expect(config.runtime).toBeDefined();
    });

    it("initializes with file config", () => {
      const config = initRuntimeConfig({ title: "Custom App" });

      expect(config.title).toBe("Custom App");
    });

    it("returns same instance on subsequent calls", () => {
      const config1 = initRuntimeConfig({ title: "First" });
      const config2 = initRuntimeConfig({ title: "Second" });

      expect(config1).toBe(config2);
      expect(config1.title).toBe("First");
    });
  });

  describe("getRuntimeConfig", () => {
    it("auto-initializes if not initialized", () => {
      expect(isRuntimeConfigInitialized()).toBe(false);

      getRuntimeConfig();

      expect(isRuntimeConfigInitialized()).toBe(true);
    });

    it("returns initialized config", () => {
      const initialized = initRuntimeConfig({ title: "Test" });

      expect(getRuntimeConfig()).toBe(initialized);
    });
  });

  describe("isRuntimeConfigInitialized", () => {
    it("returns false before initialization", () => {
      expect(isRuntimeConfigInitialized()).toBe(false);
    });

    it("returns true after initialization", () => {
      initRuntimeConfig();
      expect(isRuntimeConfigInitialized()).toBe(true);
    });

    it("returns false after reset", () => {
      initRuntimeConfig();
      _resetRuntimeConfig();
      expect(isRuntimeConfigInitialized()).toBe(false);
    });
  });

  describe("updateRuntimeConfig", () => {
    it("updates the global config", () => {
      initRuntimeConfig({ title: "Original" });
      expect(getRuntimeConfig().title).toBe("Original");

      updateRuntimeConfig({ title: "Updated" });

      expect(getRuntimeConfig().title).toBe("Updated");
    });

    it("creates new RuntimeInfo with current env", () => {
      const runtime1 = initRuntimeConfig().runtime;

      updateRuntimeConfig({ title: "New" });
      const config2 = getRuntimeConfig();

      expect(config2.runtime).not.toBe(runtime1);
      expect(config2.runtime.env).toBeDefined();
    });
  });

  describe("createTestConfig", () => {
    it("creates config with test defaults", () => {
      const config = createTestConfig();

      expect(config.runtime.isTest).toBe(true);
      expect(config.runtime.env.nodeEnv).toBe("test");
    });

    it("allows file config overrides", () => {
      const config = createTestConfig({
        title: "Test App",
        experimental: { rsc: true },
      });

      expect(config.title).toBe("Test App");
      expect(config.experimental?.rsc).toBe(true);
    });

    it("allows runtime env overrides", () => {
      const config = createTestConfig({
        runtime: { env: { debug: true, port: 4000 } },
      });

      expect(config.runtime.env.debug).toBe(true);
      expect(config.runtime.env.port).toBe(4000);
    });

    it("does not affect global singleton", () => {
      initRuntimeConfig({ title: "Global" });
      const globalConfig = getRuntimeConfig();

      const testConfig = createTestConfig({ title: "Test" });

      expect(testConfig.title).toBe("Test");
      expect(getRuntimeConfig()).toBe(globalConfig);
      expect(getRuntimeConfig().title).toBe("Global");
    });
  });

  describe("_setRuntimeConfigForTesting", () => {
    it("sets full RuntimeConfig", () => {
      _setRuntimeConfigForTesting(createTestConfig({ title: "Override" }));

      expect(getRuntimeConfig().title).toBe("Override");
    });

    it("creates config from partial overrides", () => {
      _setRuntimeConfigForTesting({ title: "Partial" });

      const config = getRuntimeConfig();
      expect(config.title).toBe("Partial");
      expect(config.runtime).toBeDefined();
    });
  });

  describe("_resetRuntimeConfig", () => {
    it("clears the singleton", () => {
      initRuntimeConfig();
      expect(isRuntimeConfigInitialized()).toBe(true);

      _resetRuntimeConfig();

      expect(isRuntimeConfigInitialized()).toBe(false);
    });
  });

  describe("type safety", () => {
    it("RuntimeConfig extends VeryfrontConfig", () => {
      const config: RuntimeConfig = createTestConfig();

      expect("title" in config).toBe(true);
      expect("experimental" in config).toBe(true);
      expect("build" in config).toBe(true);

      expect("runtime" in config).toBe(true);
      expect(config.runtime.isProduction).toBeDefined();
    });
  });
});
