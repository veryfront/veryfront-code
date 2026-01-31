import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getBuildConfig,
  getDefineEnv,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTest,
} from "./environment.ts";
import type { BuildEnvironmentConfig } from "./environment.ts";

const VALID_ENVS = ["development", "production", "test"] as const;

describe("build/config/environment", () => {
  // Note: These tests depend on the current VERYFRONT_ENV or NODE_ENV.
  // In test runner, the environment may be "test" or "development".

  describe("getEnvironment", () => {
    it("should return a valid environment string", () => {
      const env = getEnvironment();
      assertEquals(
        VALID_ENVS.includes(env),
        true,
        `Expected valid environment, got: ${env}`,
      );
    });
  });

  describe("isDevelopment / isProduction / isTest", () => {
    it("should return booleans", () => {
      assertEquals(typeof isDevelopment(), "boolean");
      assertEquals(typeof isProduction(), "boolean");
      assertEquals(typeof isTest(), "boolean");
    });

    it("exactly one should be true", () => {
      const count = [isDevelopment(), isProduction(), isTest()].filter(Boolean)
        .length;
      assertEquals(count, 1, "Exactly one environment flag should be true");
    });
  });

  describe("getBuildConfig", () => {
    it("should return a complete config object", () => {
      const config: BuildEnvironmentConfig = getBuildConfig();
      assertEquals(typeof config.environment, "string");
      assertEquals(typeof config.isDevelopment, "boolean");
      assertEquals(typeof config.isProduction, "boolean");
      assertEquals(typeof config.isTest, "boolean");
      assertEquals(typeof config.cacheMaxEntries, "number");
      assertEquals(typeof config.cacheTTLMs, "number");
      assertEquals(typeof config.minify, "boolean");
      assertEquals(typeof config.treeShaking, "boolean");
      assertEquals(Array.isArray(config.target), true);
    });

    it("should have consistent environment flags", () => {
      const config = getBuildConfig();
      const { environment } = config;
      assertEquals(config.isDevelopment, environment === "development");
      assertEquals(config.isProduction, environment === "production");
      assertEquals(config.isTest, environment === "test");
    });

    it("should have production settings when environment is production", () => {
      const config = getBuildConfig();
      if (!config.isProduction) return;

      assertEquals(config.minify, true);
      assertEquals(config.treeShaking, true);
      assertEquals(config.cacheMaxEntries, 100);
      assertEquals(config.cacheTTLMs, 3600000);
      assertEquals(config.target, ["es2020"]);
    });

    it("should have development settings when environment is development", () => {
      const config = getBuildConfig();
      if (!config.isDevelopment) return;

      assertEquals(config.minify, false);
      assertEquals(config.sourcemaps, "inline");
      assertEquals(config.treeShaking, false);
      assertEquals(config.cacheMaxEntries, 10);
      assertEquals(config.cacheTTLMs, 0);
      assertEquals(config.target, ["esnext"]);
    });
  });

  describe("getDefineEnv", () => {
    it("should return a JSON-encoded environment string", () => {
      const result = getDefineEnv();
      assertEquals(typeof result, "string");

      const parsed = JSON.parse(result);
      assertEquals(
        VALID_ENVS.includes(parsed),
        true,
        `Expected valid JSON-encoded environment, got: ${result}`,
      );
    });
  });
});
