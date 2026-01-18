import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  defineConfig,
  defineConfigWithEnv,
  mergeConfigs,
  validateConfig,
} from "./define-config.ts";
import type { VeryfrontConfig } from "./types.ts";
import { deleteEnv, getEnv, setEnv } from "../platform/compat/process.ts";

describe("define-config", () => {
  describe("defineConfig", () => {
    it("should return the same config object", () => {
      const config: VeryfrontConfig = {
        title: "My App",
        dev: {
          port: 3002,
        },
      };
      const result = defineConfig(config);
      expect(result).toBe(config);
      expect(result).toEqual(config);
    });

    it("should work with minimal config", () => {
      const config: VeryfrontConfig = {};
      const result = defineConfig(config);
      expect(result).toEqual({});
    });

    it("should preserve all config properties", () => {
      const config: VeryfrontConfig = {
        title: "Test App",
        description: "Test Description",
        dev: {
          port: 3003,
          open: true,
        },
        build: {
          outDir: "dist",
        },
      };
      const result = defineConfig(config);
      expect(result.title).toBe("Test App");
      expect(result.description).toBe("Test Description");
      expect(result.dev?.port).toBe(3003);
      expect(result.dev?.open).toBe(true);
      expect(result.build?.outDir).toBe("dist");
    });
  });

  describe("defineConfigWithEnv", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = getEnv("NODE_ENV");
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        setEnv("NODE_ENV", originalEnv);
      } else {
        deleteEnv("NODE_ENV");
      }
    });

    it("should use development as default environment", () => {
      deleteEnv("NODE_ENV");
      const result = defineConfigWithEnv((env) => ({
        title: `App-${env}`,
      }));
      expect(result.title).toBe("App-development");
    });

    it("should use NODE_ENV if set", () => {
      setEnv("NODE_ENV", "production");
      const result = defineConfigWithEnv((env) => ({
        title: `App-${env}`,
      }));
      expect(result.title).toBe("App-production");
    });

    it("should allow environment-specific configuration", () => {
      setEnv("NODE_ENV", "production");
      const result = defineConfigWithEnv((env) => ({
        dev: {
          port: env === "production" ? 8080 : 3002,
        },
      }));
      expect(result.dev?.port).toBe(8080);
    });

    it("should work with development environment", () => {
      setEnv("NODE_ENV", "development");
      const result = defineConfigWithEnv((env) => ({
        dev: {
          port: env === "production" ? 8080 : 3002,
        },
      }));
      expect(result.dev?.port).toBe(3002);
    });

    it("should work with custom environments", () => {
      setEnv("NODE_ENV", "staging");
      const result = defineConfigWithEnv((env) => ({
        title: `Staging-${env}`,
      }));
      expect(result.title).toBe("Staging-staging");
    });

    it("should pass full config from factory", () => {
      setEnv("NODE_ENV", "test");
      const result = defineConfigWithEnv((env) => ({
        title: "Test App",
        description: `Running in ${env}`,
        dev: {
          port: 3004,
          open: false,
        },
      }));
      expect(result.title).toBe("Test App");
      expect(result.description).toBe("Running in test");
      expect(result.dev?.port).toBe(3004);
      expect(result.dev?.open).toBe(false);
    });
  });

  describe("mergeConfigs", () => {
    it("should merge two configs", () => {
      const config1: Partial<VeryfrontConfig> = {
        title: "Base App",
      };
      const config2: Partial<VeryfrontConfig> = {
        description: "Added description",
      };
      const result = mergeConfigs(config1, config2);
      expect(result.title).toBe("Base App");
      expect(result.description).toBe("Added description");
    });

    it("should override properties from left to right", () => {
      const config1: Partial<VeryfrontConfig> = {
        title: "First",
      };
      const config2: Partial<VeryfrontConfig> = {
        title: "Second",
      };
      const result = mergeConfigs(config1, config2);
      expect(result.title).toBe("Second");
    });

    it("should merge multiple configs", () => {
      const config1: Partial<VeryfrontConfig> = {
        title: "App",
      };
      const config2: Partial<VeryfrontConfig> = {
        description: "Description",
      };
      const config3: Partial<VeryfrontConfig> = {
        dev: { port: 3005 },
      };
      const result = mergeConfigs(config1, config2, config3);
      expect(result.title).toBe("App");
      expect(result.description).toBe("Description");
      expect(result.dev?.port).toBe(3005);
    });

    it("should handle empty configs", () => {
      const result = mergeConfigs({}, {});
      expect(result).toEqual({});
    });

    it("should work with single config", () => {
      const config: Partial<VeryfrontConfig> = {
        title: "Single",
      };
      const result = mergeConfigs(config);
      expect(result.title).toBe("Single");
    });

    it("should shallow merge nested objects", () => {
      const config1: Partial<VeryfrontConfig> = {
        dev: {
          port: 3006,
          open: true,
        },
      };
      const config2: Partial<VeryfrontConfig> = {
        dev: {
          port: 3007,
        },
      };
      const result = mergeConfigs(config1, config2);
      expect(result.dev?.port).toBe(3007);
      expect(result.dev?.open).toBeUndefined();
    });

    it("should preserve last value in chain of overrides", () => {
      const config1: Partial<VeryfrontConfig> = { title: "First" };
      const config2: Partial<VeryfrontConfig> = { title: "Second" };
      const config3: Partial<VeryfrontConfig> = { title: "Third" };
      const result = mergeConfigs(config1, config2, config3);
      expect(result.title).toBe("Third");
    });
  });

  describe("validateConfig", () => {
    it("should accept valid config", async () => {
      const config: VeryfrontConfig = {
        title: "Valid App",
        dev: {
          port: 3008,
        },
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject null config", async () => {
      await expect(validateConfig(null)).rejects.toThrow("Configuration must be an object");
    });

    it("should reject undefined config", async () => {
      await expect(validateConfig(undefined)).rejects.toThrow("Configuration must be an object");
    });

    it("should reject non-object config", async () => {
      await expect(validateConfig("string")).rejects.toThrow("Configuration must be an object");
      await expect(validateConfig(123)).rejects.toThrow("Configuration must be an object");
      await expect(validateConfig(true)).rejects.toThrow("Configuration must be an object");
    });

    it("should accept config without dev.port", async () => {
      const config: VeryfrontConfig = {
        title: "App without port",
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject invalid dev.port (too low)", async () => {
      const config = {
        dev: {
          port: 0,
        },
      };
      await expect(validateConfig(config)).rejects.toThrow("dev.port must be a number between");
    });

    it("should reject invalid dev.port (too high)", async () => {
      const config = {
        dev: {
          port: 99999,
        },
      };
      await expect(validateConfig(config)).rejects.toThrow("dev.port must be a number between");
    });

    it("should reject non-number dev.port", async () => {
      const config = {
        dev: {
          port: "not a number",
        },
      };
      await expect(validateConfig(config)).rejects.toThrow("dev.port must be a number between");
    });

    it("should accept valid port within range", async () => {
      const config: VeryfrontConfig = {
        dev: {
          port: 3009,
        },
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject non-string build.outDir", async () => {
      const config = {
        build: {
          outDir: 123,
        },
      };
      await expect(validateConfig(config)).rejects.toThrow("build.outDir must be a string");
    });

    it("should accept valid build.outDir", async () => {
      const config: VeryfrontConfig = {
        build: {
          outDir: "custom-dist",
        },
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should accept config without build section", async () => {
      const config: VeryfrontConfig = {
        title: "No build config",
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should accept empty config object", async () => {
      const config: VeryfrontConfig = {};
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should accept config with multiple valid sections", async () => {
      const config: VeryfrontConfig = {
        title: "Complete App",
        description: "Full config",
        dev: {
          port: 3010,
          open: true,
        },
        build: {
          outDir: "build",
        },
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });
  });
});
