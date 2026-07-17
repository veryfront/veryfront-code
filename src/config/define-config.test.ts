import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  defineConfig,
  defineConfigWithEnv,
  mergeConfigs,
  validateConfig,
} from "./define-config.ts";
import {
  defineConfig as publicDefineConfig,
  defineConfigWithEnv as publicDefineConfigWithEnv,
  mergeConfigs as publicMergeConfigs,
} from "veryfront";
import {
  validateVeryfrontConfig,
  type VeryfrontConfig,
  type VeryfrontConfigInput,
} from "./schemas/index.ts";
import { createTestEnvironmentConfig } from "./environment-config.ts";

describe("define-config", () => {
  describe("defineConfig", () => {
    it("should return the same config object", () => {
      const config: VeryfrontConfig = { title: "My App", dev: { port: 3002 } };
      const result = defineConfig(config);
      expect(result).toBe(config);
      expect(result).toEqual(config);
    });

    it("should work with minimal config", () => {
      const config: VeryfrontConfig = {};
      expect(defineConfig(config)).toEqual({});
    });

    it("should preserve all config properties", () => {
      const config: VeryfrontConfig = {
        title: "Test App",
        description: "Test Description",
        dev: { port: 3003, open: true },
        build: { outDir: "dist" },
      };
      const result = defineConfig(config);
      expect(result.title).toBe("Test App");
      expect(result.description).toBe("Test Description");
      expect(result.dev?.port).toBe(3003);
      expect(result.dev?.open).toBe(true);
      expect(result.build?.outDir).toBe("dist");
    });

    it("keeps source integration restrictions typed without legacy policy fields", () => {
      const config: VeryfrontConfigInput = {
        integrations: {
          allow: {
            confluence: {},
            github: { allowedTools: ["list_repos"] },
          },
        },
      };

      expect(defineConfig(config).integrations).toEqual(config.integrations);
      expect(() =>
        validateVeryfrontConfig({
          integrations: { github: { scope: "user", tools: ["list_repos"] } },
        })
      ).toThrow("Invalid veryfront.config at integrations.allow:");

      const invalidConnector: VeryfrontConfigInput = {
        integrations: {
          allow: {
            // @ts-expect-error integration keys come from the canonical connector catalog
            definitely_not_a_connector: {},
          },
        },
      };
      expect(invalidConnector.integrations).toBeDefined();
    });
  });

  describe("public root exports", () => {
    it("exports the same config helpers used by release config loading", () => {
      const env = createTestEnvironmentConfig({ nodeEnv: "production" });
      const shared = publicDefineConfig({ title: "Release" });

      expect(publicDefineConfig).toBe(defineConfig);
      expect(publicDefineConfigWithEnv).toBe(defineConfigWithEnv);
      expect(publicMergeConfigs).toBe(mergeConfigs);
      expect(
        publicDefineConfigWithEnv(
          (nodeEnv) => publicMergeConfigs(shared, { react: { version: nodeEnv } }),
          env,
        ),
      ).toEqual({ title: "Release", react: { version: "production" } });
    });

    it("composes the canonical optional source restriction through public helpers", () => {
      const canonical: VeryfrontConfig = publicMergeConfigs(
        publicDefineConfig({
          integrations: {
            allow: { gmail: { allowedTools: ["list_emails"] } },
          },
        }),
      );

      expect(canonical.integrations).toEqual({
        allow: { gmail: { allowedTools: ["list_emails"] } },
      });
    });
  });

  describe("defineConfigWithEnv", () => {
    it("should use development as default environment", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "development" });
      const result = defineConfigWithEnv((env) => ({ title: `App-${env}` }), testEnv);
      expect(result.title).toBe("App-development");
    });

    it("should use NODE_ENV if set", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "production" });
      const result = defineConfigWithEnv((env) => ({ title: `App-${env}` }), testEnv);
      expect(result.title).toBe("App-production");
    });

    it("should allow environment-specific configuration", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "production" });
      const result = defineConfigWithEnv(
        (env) => {
          if (env === "production") return { dev: { port: 8080 } };
          return { dev: { port: 3002 } };
        },
        testEnv,
      );
      expect(result.dev?.port).toBe(8080);
    });

    it("should work with development environment", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "development" });
      const result = defineConfigWithEnv(
        (env) => {
          if (env === "production") return { dev: { port: 8080 } };
          return { dev: { port: 3002 } };
        },
        testEnv,
      );
      expect(result.dev?.port).toBe(3002);
    });

    it("should work with custom environments", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "staging" });
      const result = defineConfigWithEnv((env) => ({ title: `Staging-${env}` }), testEnv);
      expect(result.title).toBe("Staging-staging");
    });

    it("should pass full config from factory", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "test" });
      const result = defineConfigWithEnv(
        (env) => ({
          title: "Test App",
          description: `Running in ${env}`,
          dev: { port: 3004, open: false },
        }),
        testEnv,
      );
      expect(result.title).toBe("Test App");
      expect(result.description).toBe("Running in test");
      expect(result.dev?.port).toBe(3004);
      expect(result.dev?.open).toBe(false);
    });
  });

  describe("mergeConfigs", () => {
    it("should merge two configs", () => {
      const result = mergeConfigs(
        { title: "Base App" } satisfies Partial<VeryfrontConfig>,
        { description: "Added description" } satisfies Partial<VeryfrontConfig>,
      );
      expect(result.title).toBe("Base App");
      expect(result.description).toBe("Added description");
    });

    it("should override properties from left to right", () => {
      const result = mergeConfigs(
        { title: "First" } satisfies Partial<VeryfrontConfig>,
        { title: "Second" } satisfies Partial<VeryfrontConfig>,
      );
      expect(result.title).toBe("Second");
    });

    it("should merge multiple configs", () => {
      const result = mergeConfigs(
        { title: "App" } satisfies Partial<VeryfrontConfig>,
        { description: "Description" } satisfies Partial<VeryfrontConfig>,
        { dev: { port: 3005 } } satisfies Partial<VeryfrontConfig>,
      );
      expect(result.title).toBe("App");
      expect(result.description).toBe("Description");
      expect(result.dev?.port).toBe(3005);
    });

    it("should handle empty configs", () => {
      expect(mergeConfigs({}, {})).toEqual({});
    });

    it("should work with single config", () => {
      const result = mergeConfigs({ title: "Single" } satisfies Partial<VeryfrontConfig>);
      expect(result.title).toBe("Single");
    });

    it("should shallow merge nested objects", () => {
      const result = mergeConfigs(
        { dev: { port: 3006, open: true } } satisfies Partial<VeryfrontConfig>,
        { dev: { port: 3007 } } satisfies Partial<VeryfrontConfig>,
      );
      expect(result.dev?.port).toBe(3007);
      expect(result.dev?.open).toBeUndefined();
    });

    it("should preserve last value in chain of overrides", () => {
      const result = mergeConfigs(
        { title: "First" } satisfies Partial<VeryfrontConfig>,
        { title: "Second" } satisfies Partial<VeryfrontConfig>,
        { title: "Third" } satisfies Partial<VeryfrontConfig>,
      );
      expect(result.title).toBe("Third");
    });
  });

  describe("validateConfig", () => {
    it("should accept valid config", async () => {
      const config: VeryfrontConfig = { title: "Valid App", dev: { port: 3008 } };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject null config", async () => {
      await expect(validateConfig(null)).rejects.toThrow("Configuration must be an object");
    });

    it("should reject undefined config", async () => {
      await expect(validateConfig(undefined)).rejects.toThrow("Configuration must be an object");
    });

    it("should reject non-object config", async () => {
      const message = "Configuration must be an object";
      await expect(validateConfig("string")).rejects.toThrow(message);
      await expect(validateConfig(123)).rejects.toThrow(message);
      await expect(validateConfig(true)).rejects.toThrow(message);
    });

    it("should accept config without dev.port", async () => {
      const config: VeryfrontConfig = { title: "App without port" };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject invalid dev.port (too low)", async () => {
      await expect(validateConfig({ dev: { port: 0 } })).rejects.toThrow(
        "dev.port must be a number between",
      );
    });

    it("should reject invalid dev.port (too high)", async () => {
      await expect(validateConfig({ dev: { port: 99999 } })).rejects.toThrow(
        "dev.port must be a number between",
      );
    });

    it("should reject non-number dev.port", async () => {
      await expect(validateConfig({ dev: { port: "not a number" } })).rejects.toThrow(
        "dev.port must be a number between",
      );
    });

    it("should accept valid port within range", async () => {
      const config: VeryfrontConfig = { dev: { port: 3009 } };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should reject non-string build.outDir", async () => {
      await expect(validateConfig({ build: { outDir: 123 } })).rejects.toThrow(
        "build.outDir must be a string",
      );
    });

    it("should accept valid build.outDir", async () => {
      const config: VeryfrontConfig = { build: { outDir: "custom-dist" } };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    it("should accept config without build section", async () => {
      const config: VeryfrontConfig = { title: "No build config" };
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
        dev: { port: 3010, open: true },
        build: { outDir: "build" },
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });
  });
});
