import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  getEnvironment,
  isDevelopment,
  isProduction,
  isTest,
  getBuildConfig,
  getDefineEnv,
  type Environment,
} from "./environment.ts";

describe("environment", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original environment variables
    originalEnv.VERYFRONT_ENV = Deno.env.get("VERYFRONT_ENV");
    originalEnv.NODE_ENV = Deno.env.get("NODE_ENV");
    originalEnv.DENO_ENV = Deno.env.get("DENO_ENV");

    // Clear all environment variables
    Deno.env.delete("VERYFRONT_ENV");
    Deno.env.delete("NODE_ENV");
    Deno.env.delete("DENO_ENV");
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalEnv.VERYFRONT_ENV !== undefined) {
      Deno.env.set("VERYFRONT_ENV", originalEnv.VERYFRONT_ENV);
    }
    if (originalEnv.NODE_ENV !== undefined) {
      Deno.env.set("NODE_ENV", originalEnv.NODE_ENV);
    }
    if (originalEnv.DENO_ENV !== undefined) {
      Deno.env.set("DENO_ENV", originalEnv.DENO_ENV);
    }
  });

  describe("getEnvironment", () => {
    it("should return development by default", () => {
      assertEquals(getEnvironment(), "development");
    });

    it("should prefer VERYFRONT_ENV over NODE_ENV", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      Deno.env.set("NODE_ENV", "development");
      assertEquals(getEnvironment(), "production");
    });

    it("should use NODE_ENV if VERYFRONT_ENV is not set", () => {
      Deno.env.set("NODE_ENV", "production");
      assertEquals(getEnvironment(), "production");
    });

    it("should use DENO_ENV if neither VERYFRONT_ENV nor NODE_ENV is set", () => {
      Deno.env.set("DENO_ENV", "test");
      assertEquals(getEnvironment(), "test");
    });

    it("should handle production environment", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      assertEquals(getEnvironment(), "production");
    });

    it("should handle test environment", () => {
      Deno.env.set("VERYFRONT_ENV", "test");
      assertEquals(getEnvironment(), "test");
    });

    it("should return development for invalid values", () => {
      Deno.env.set("VERYFRONT_ENV", "invalid");
      assertEquals(getEnvironment(), "development");
    });
  });

  describe("isDevelopment", () => {
    it("should return true when environment is development", () => {
      assertEquals(isDevelopment(), true);
    });

    it("should return false when environment is production", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      assertEquals(isDevelopment(), false);
    });

    it("should return false when environment is test", () => {
      Deno.env.set("VERYFRONT_ENV", "test");
      assertEquals(isDevelopment(), false);
    });
  });

  describe("isProduction", () => {
    it("should return false when environment is development", () => {
      assertEquals(isProduction(), false);
    });

    it("should return true when environment is production", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      assertEquals(isProduction(), true);
    });

    it("should return false when environment is test", () => {
      Deno.env.set("VERYFRONT_ENV", "test");
      assertEquals(isProduction(), false);
    });
  });

  describe("isTest", () => {
    it("should return false when environment is development", () => {
      assertEquals(isTest(), false);
    });

    it("should return false when environment is production", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      assertEquals(isTest(), false);
    });

    it("should return true when environment is test", () => {
      Deno.env.set("VERYFRONT_ENV", "test");
      assertEquals(isTest(), true);
    });
  });

  describe("getBuildConfig", () => {
    it("should return development config by default", () => {
      const config = getBuildConfig();
      assertEquals(config.environment, "development");
      assertEquals(config.isDevelopment, true);
      assertEquals(config.isProduction, false);
      assertEquals(config.isTest, false);
      assertEquals(config.minify, false);
      assertEquals(config.sourcemaps, "inline");
      assertEquals(config.treeShaking, false);
    });

    it("should return production config when environment is production", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      const config = getBuildConfig();
      assertEquals(config.environment, "production");
      assertEquals(config.isDevelopment, false);
      assertEquals(config.isProduction, true);
      assertEquals(config.isTest, false);
      assertEquals(config.minify, true);
      assertEquals(config.sourcemaps, false);
      assertEquals(config.treeShaking, true);
    });

    it("should return test config when environment is test", () => {
      Deno.env.set("VERYFRONT_ENV", "test");
      const config = getBuildConfig();
      assertEquals(config.environment, "test");
      assertEquals(config.isDevelopment, false);
      assertEquals(config.isProduction, false);
      assertEquals(config.isTest, true);
    });

    it("should have appropriate cache settings for development", () => {
      const config = getBuildConfig();
      assertEquals(config.cacheMaxEntries, 10);
      assertEquals(config.cacheTTLMs, 0);
    });

    it("should have appropriate cache settings for production", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      const config = getBuildConfig();
      assertEquals(config.cacheMaxEntries, 100);
      assertEquals(config.cacheTTLMs, 3600000);
    });

    it("should have target array", () => {
      const config = getBuildConfig();
      assertEquals(Array.isArray(config.target), true);
      assertEquals(config.target.length > 0, true);
    });
  });

  describe("getDefineEnv", () => {
    it("should return JSON stringified environment", () => {
      const result = getDefineEnv();
      assertEquals(typeof result, "string");
      assertEquals(result.startsWith('"'), true);
      assertEquals(result.endsWith('"'), true);
    });

    it("should return development by default", () => {
      const result = getDefineEnv();
      assertEquals(JSON.parse(result), "development");
    });

    it("should return production when set", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      const result = getDefineEnv();
      assertEquals(JSON.parse(result), "production");
    });
  });
});
