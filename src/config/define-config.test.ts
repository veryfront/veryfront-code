import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { expect } from "#std/expect.ts";
import { defineConfig, defineConfigWithEnv, mergeConfigs } from "./define-config.ts";
import {
  defineConfig as clientDefineConfig,
  defineConfigWithEnv as clientDefineConfigWithEnv,
  mergeConfigs as clientMergeConfigs,
} from "./define-config.client.ts";
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
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
  createTestEnvironmentConfig,
  getEnvironmentConfig,
  isEnvironmentConfigInitialized,
} from "./environment-config.ts";

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

    it("rejects malformed extension entries at the public authoring boundary", () => {
      const invalidConfig: VeryfrontConfigInput = {
        // @ts-expect-error extension entries must be materialized extensions or disable directives
        extensions: ["not-an-extension"],
      };

      expect(invalidConfig.extensions).toEqual(["not-an-extension"]);
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

  describe("client-safe exports", () => {
    it("shares pure helpers and preserves the environment factory contract", () => {
      const compatibleHelper: typeof defineConfigWithEnv = clientDefineConfigWithEnv;

      expect(clientDefineConfig).toBe(defineConfig);
      expect(clientMergeConfigs).toBe(mergeConfigs);
      expect(
        compatibleHelper(
          (nodeEnv) => clientMergeConfigs({ title: "Client" }, { description: nodeEnv }),
          { nodeEnv: "production" },
        ),
      ).toEqual({ title: "Client", description: "production" });
    });
  });

  describe("defineConfigWithEnv", () => {
    it("should use the supplied development environment", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "development" });
      const result = defineConfigWithEnv((env) => ({ title: `App-${env}` }), testEnv);
      expect(result.title).toBe("App-development");
    });

    it("reads the ambient environment when no env config is passed", () => {
      // Every standard lane pins NODE_ENV to "production", so comparing against
      // the ambient snapshot would also pass for a hardcoded "production"
      // default. Scope a non-production ambient environment and assert the
      // concrete value instead.
      const hadAmbient = isEnvironmentConfigInitialized();
      const priorAmbient = hadAmbient ? getEnvironmentConfig() : null;
      try {
        _setEnvironmentConfigForTesting({ nodeEnv: "staging" });
        const result = defineConfigWithEnv((env) => ({ title: env }));
        assertEquals(
          result.title,
          "staging",
          "omitting the env argument must read the ambient environment, not a fixed default",
        );
      } finally {
        if (priorAmbient) _setEnvironmentConfigForTesting(priorAmbient);
        else _resetEnvironmentConfig();
      }
    });

    it("should use NODE_ENV if set", () => {
      const testEnv = createTestEnvironmentConfig({ nodeEnv: "production" });
      const result = defineConfigWithEnv((env) => ({ title: `App-${env}` }), testEnv);
      expect(result.title).toBe("App-production");
    });

    it("accepts the minimal environment contract it reads", () => {
      const result = defineConfigWithEnv(
        (env) => ({ title: `App-${env}` }),
        { nodeEnv: "production" },
      );
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
});
