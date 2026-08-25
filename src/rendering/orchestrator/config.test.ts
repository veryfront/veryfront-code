import "#veryfront/schemas/_test-setup.ts";
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
      const config = createMockConfig({ projectSlug: "test-project" });
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

    it("should return an absolute VERYFRONT_CACHE_DIR verbatim", () => {
      const adapter = createMockAdapter({ VERYFRONT_CACHE_DIR: "/var/cache/veryfront" });
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({}));
      assertEquals(
        cm.getCacheBaseDir(),
        "/var/cache/veryfront",
        "an absolute cache dir must not be rebased under the project",
      );
    });

    it("should fall back to VF_CACHE_DIR", () => {
      const adapter = createMockAdapter({ VF_CACHE_DIR: "/fallback-cache" });
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({}));
      assertEquals(
        cm.getCacheBaseDir(),
        "/fallback-cache",
        "VF_CACHE_DIR must still be honoured when VERYFRONT_CACHE_DIR is unset",
      );
    });

    it("should prefer VERYFRONT_CACHE_DIR over VF_CACHE_DIR", () => {
      const adapter = createMockAdapter({
        VERYFRONT_CACHE_DIR: "/primary-cache",
        VF_CACHE_DIR: "/fallback-cache",
      });
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({}));
      assertEquals(
        cm.getCacheBaseDir(),
        "/primary-cache",
        "VERYFRONT_CACHE_DIR takes precedence over the legacy VF_CACHE_DIR",
      );
    });

    it("should use config.cache.dir when no env var is set", () => {
      const adapter = createMockAdapter();
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({ cache: { dir: "cfg-cache" } }));
      assertEquals(
        cm.getCacheBaseDir(),
        "/project/cfg-cache",
        "a relative config.cache.dir resolves under the project directory",
      );
    });

    it("should prefer the env var over config.cache.dir", () => {
      const adapter = createMockAdapter({ VERYFRONT_CACHE_DIR: "/env-cache" });
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({ cache: { dir: "cfg-cache" } }));
      assertEquals(
        cm.getCacheBaseDir(),
        "/env-cache",
        "an operator env override must win over config.cache.dir",
      );
    });

    it("should recompute the cache dir when env or config changes, and reuse it otherwise", () => {
      const envVars: Record<string, string> = {};
      const adapter = createMockAdapter(envVars);
      const cm = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      setConfig(cm, createMockConfig({}));

      assertEquals(
        cm.getCacheBaseDir(),
        "/project/.veryfront/cache",
        "the default cache dir applies before any override",
      );
      assertEquals(
        cm.getCacheBaseDir(),
        "/project/.veryfront/cache",
        "a repeated call with unchanged inputs returns the same directory",
      );

      setConfig(cm, createMockConfig({ cache: { dir: "other-cache" } }));
      assertEquals(
        cm.getCacheBaseDir(),
        "/project/other-cache",
        "a changed config.cache.dir must invalidate the memo",
      );

      envVars.VERYFRONT_CACHE_DIR = "/abs/env-cache";
      assertEquals(
        cm.getCacheBaseDir(),
        "/abs/env-cache",
        "a changed VERYFRONT_CACHE_DIR must win and invalidate the memo",
      );
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
