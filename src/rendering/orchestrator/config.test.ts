import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

function createMockAdapter(envVars: Record<string, string> = {}): RuntimeAdapter {
  return {
    fs: {
      readFile: async () => "",
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
    },
    env: {
      get: (key: string) => envVars[key],
    },
  } as unknown as RuntimeAdapter;
}

function createMockConfig(overrides: Partial<VeryfrontConfig> = {}): VeryfrontConfig {
  return {
    ...overrides,
  } as VeryfrontConfig;
}

describe("rendering/orchestrator/config", () => {
  describe("ConfigurationManager constructor", () => {
    it("should store projectDir, mode, and adapter", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertEquals(cm.getProjectDir(), "/project");
      assertEquals(cm.getMode(), "production");
      assertEquals(cm.getAdapter(), adapter);
    });

    it("should accept development mode", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/dev",
        mode: "development",
        adapter,
      });
      assertEquals(cm.getMode(), "development");
    });
  });

  describe("getConfig before initialize", () => {
    it("should throw when config not initialized and no preloaded config", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertThrows(() => cm.getConfig(), Error);
    });
  });

  describe("getConfig with preloaded config", () => {
    it("should throw before initialize even with preloaded config", () => {
      const adapter = createMockAdapter();
      const config = createMockConfig({ name: "test-project" });
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
        config,
      });
      assertThrows(() => cm.getConfig(), Error);
    });
  });

  describe("getProjectCacheKey", () => {
    it("should return null before initialize", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertEquals(cm.getProjectCacheKey(), null);
    });
  });

  describe("getCacheBaseDir", () => {
    function setConfig(cm: ConfigurationManager, config: VeryfrontConfig): void {
      // deno-lint-ignore no-explicit-any
      (cm as any).config = config;
    }

    it("should return default cache dir when no env or config override", () => {
      const adapter = createMockAdapter();
      const config = createMockConfig({});
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, config);
      const result = cm.getCacheBaseDir();
      assertEquals(result, "/project/.veryfront/cache");
    });

    it("should use VERYFRONT_CACHE_DIR env var (relative)", () => {
      const adapter = createMockAdapter({ VERYFRONT_CACHE_DIR: "my-cache" });
      const config = createMockConfig({});
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, config);
      assertEquals(cm.getCacheBaseDir(), "/project/my-cache");
    });

    it("should cache the result and return same value on repeated calls", () => {
      const adapter = createMockAdapter();
      const config = createMockConfig({});
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, config);
      const r1 = cm.getCacheBaseDir();
      const r2 = cm.getCacheBaseDir();
      assertEquals(r1, r2);
    });
  });

  describe("isDebugMode", () => {
    it("should return false when no debug env vars set", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertEquals(cm.isDebugMode(), false);
    });
  });

  describe("getProjectDir", () => {
    it("should return the project directory", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/my/project",
        mode: "development",
        adapter,
      });
      assertEquals(cm.getProjectDir(), "/my/project");
    });
  });

  describe("getMode", () => {
    it("should return production mode", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertEquals(cm.getMode(), "production");
    });

    it("should return development mode", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "development",
        adapter,
      });
      assertEquals(cm.getMode(), "development");
    });
  });

  describe("getAdapter", () => {
    it("should return the adapter instance", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      assertEquals(cm.getAdapter(), adapter);
    });
  });
});
