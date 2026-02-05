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
  getEnvironmentConfig,
  initEnvironmentConfig,
  isEnvironmentConfigInitialized,
  type EnvironmentConfig,
} from "./environment-config.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";

describe("EnvironmentConfig", () => {
  beforeEach(_resetEnvironmentConfig);
  beforeEach(markEnvLoaded);
  afterEach(() => {
    __resetEnvLoaderForTests();
    _resetEnvironmentConfig();
  });

  describe("initEnvironmentConfig", () => {
    it("initializes RuntimeEnv from environment", () => {
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
  });

  describe("isRuntimeEnvInitialized", () => {
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

  describe("_setRuntimeEnvForTesting", () => {
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

    it("handles all RuntimeEnv properties", () => {
      const env = createTestEnvironmentConfig();

      const expectedProps: (keyof EnvironmentConfig)[] = [
        "nodeEnv",
        "veryfrontEnv",
        "veryfrontMode",
        "debug",
        "ci",
        "denoTesting",
        "perfEnabled",
        "apiBaseUrl",
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
        "ssrMaxConcurrentTransforms",
        "otelEnabled",
        "otelServiceName",
        "otelEndpoint",
        "otelTracesEndpoint",
        "otelMetricsEndpoint",
        "otelTracesExporter",
        "otelMetricsExporter",
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
  });
});
