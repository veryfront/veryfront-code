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

function reset(): void {
  _resetRuntimeConfig();
  _resetEnvironmentConfig();
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
      expect(DEFAULT_CONFIG.dev?.port).toBe(3001);
      expect(DEFAULT_CONFIG.cache?.dir).toBe(".veryfront");
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
      const config = createRuntimeConfig(
        { dev: { port: 3000 } },
        createTestEnvironmentConfig({ port: 9000 }),
      );

      expect(config.dev?.port).toBe(9000);
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
