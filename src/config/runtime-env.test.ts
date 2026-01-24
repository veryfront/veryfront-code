/**
 * Tests for runtime environment configuration.
 * @module
 */

import { afterEach, beforeEach, describe, it } from "#std/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  _resetRuntimeEnv,
  _setRuntimeEnvForTesting,
  createTestRuntimeEnv,
  getRuntimeEnv,
  initRuntimeEnv,
  isRuntimeEnvInitialized,
  type RuntimeEnv,
} from "./runtime-env.ts";

describe("RuntimeEnv", () => {
  beforeEach(_resetRuntimeEnv);
  afterEach(_resetRuntimeEnv);

  describe("initRuntimeEnv", () => {
    it("initializes RuntimeEnv from environment", () => {
      const env = initRuntimeEnv();

      expect(env).toBeDefined();
      expect(typeof env.nodeEnv).toBe("string");
      expect(typeof env.debug).toBe("boolean");
      expect(typeof env.ci).toBe("boolean");
    });

    it("returns same instance on subsequent calls", () => {
      const env1 = initRuntimeEnv();
      const env2 = initRuntimeEnv();

      expect(env1).toBe(env2);
    });

    it("freezes the returned object", () => {
      const env = initRuntimeEnv();

      expect(Object.isFrozen(env)).toBe(true);
    });
  });

  describe("getRuntimeEnv", () => {
    it("auto-initializes if not initialized", () => {
      expect(isRuntimeEnvInitialized()).toBe(false);

      const env = getRuntimeEnv();

      expect(env).toBeDefined();
      expect(isRuntimeEnvInitialized()).toBe(true);
    });

    it("returns initialized env", () => {
      const initialized = initRuntimeEnv();
      const retrieved = getRuntimeEnv();

      expect(retrieved).toBe(initialized);
    });
  });

  describe("isRuntimeEnvInitialized", () => {
    it("returns false before initialization", () => {
      expect(isRuntimeEnvInitialized()).toBe(false);
    });

    it("returns true after initialization", () => {
      initRuntimeEnv();
      expect(isRuntimeEnvInitialized()).toBe(true);
    });

    it("returns false after reset", () => {
      initRuntimeEnv();
      _resetRuntimeEnv();
      expect(isRuntimeEnvInitialized()).toBe(false);
    });
  });

  describe("createTestRuntimeEnv", () => {
    it("creates env with test defaults", () => {
      const env = createTestRuntimeEnv();

      expect(env.nodeEnv).toBe("test");
      expect(env.debug).toBe(false);
      expect(env.ci).toBe(false);
      expect(env.denoTesting).toBe(false);
    });

    it("allows overrides", () => {
      const env = createTestRuntimeEnv({
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
      initRuntimeEnv();
      const globalEnv = getRuntimeEnv();

      const testEnv = createTestRuntimeEnv({ debug: true });

      expect(testEnv.debug).toBe(true);
      expect(getRuntimeEnv()).toBe(globalEnv);
      expect(getRuntimeEnv().debug).toBe(globalEnv.debug);
    });

    it("can override nodeEnv", () => {
      const env = createTestRuntimeEnv({ nodeEnv: "production" });

      expect(env.nodeEnv).toBe("production");
    });
  });

  describe("_setRuntimeEnvForTesting", () => {
    it("overrides global env", () => {
      initRuntimeEnv();

      _setRuntimeEnvForTesting({ debug: true, port: 8888 });

      const env = getRuntimeEnv();
      expect(env.debug).toBe(true);
      expect(env.port).toBe(8888);
    });

    it("freezes the overridden env", () => {
      _setRuntimeEnvForTesting({ debug: true });

      const env = getRuntimeEnv();
      expect(Object.isFrozen(env)).toBe(true);
    });
  });

  describe("_resetRuntimeEnv", () => {
    it("clears the singleton", () => {
      initRuntimeEnv();
      expect(isRuntimeEnvInitialized()).toBe(true);

      _resetRuntimeEnv();

      expect(isRuntimeEnvInitialized()).toBe(false);
    });
  });

  describe("test isolation pattern", () => {
    it("createTestRuntimeEnv provides isolated config for tests", () => {
      const testEnv = createTestRuntimeEnv({
        apiToken: "test-token-123",
        projectSlug: "test-project",
        ci: true,
      });

      expect(testEnv.apiToken).toBe("test-token-123");
      expect(testEnv.projectSlug).toBe("test-project");
      expect(testEnv.ci).toBe(true);
      expect(testEnv.nodeEnv).toBe("test");

      const globalEnv = getRuntimeEnv();
      expect(globalEnv.apiToken).not.toBe("test-token-123");
    });

    it("test envs are independent of each other", () => {
      const env1 = createTestRuntimeEnv({ port: 1111 });
      const env2 = createTestRuntimeEnv({ port: 2222 });

      expect(env1.port).toBe(1111);
      expect(env2.port).toBe(2222);
      expect(env1.port).toBe(1111);
    });

    it("supports CLI-specific fields", () => {
      const env = createTestRuntimeEnv({
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
      const env = createTestRuntimeEnv();

      expect(env.apiBaseUrl).toBeDefined();
      expect(typeof env.apiBaseUrl).toBe("string");
      expect(env.ssrMaxConcurrentTransforms).toBe(3);
    });

    it("handles all RuntimeEnv properties", () => {
      const env = createTestRuntimeEnv();

      const expectedProps: (keyof RuntimeEnv)[] = [
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
