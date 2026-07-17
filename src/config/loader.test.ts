import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  clearConfigCache,
  getCachedConfigSync,
  getConfig,
  mergeConfigs,
  rewriteBareVeryfrontConfigImports,
  transpileConfigSourceForImport,
} from "./loader.ts";
import { createMockAdapter } from "../platform/adapters/mock.ts";
import { VeryfrontError } from "#veryfront/errors";

function setup() {
  clearConfigCache();
  return createMockAdapter();
}

describe("config/loader", () => {
  describe("transpileConfigSourceForImport", () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    it("should transpile typed config files without rewriting string literals", async () => {
      const source = `
type LocalConfig = { title: string; description: string };
const literal = "keep as const text";
const config: LocalConfig = {
  title: "Typed Project",
  description: literal as string,
};

export default config as const;
`;

      const result = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const module = await import(`data:application/javascript;base64,${btoa(result)}`) as {
        default: { title: string; description: string };
      };

      assert(!result.includes("type LocalConfig"));
      assert(!result.includes(": LocalConfig"));
      assert(result.includes('"keep as const text"'));
      assertEquals(module.default.title, "Typed Project");
      assertEquals(module.default.description, "keep as const text");
    });
  });

  describe("rewriteBareVeryfrontConfigImports", () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    it("rewrites bare veryfront specifiers to a loadable shim", () => {
      const rewritten = rewriteBareVeryfrontConfigImports(
        'import { defineConfig } from "veryfront";\nexport default defineConfig({});',
      );

      assert(!rewritten.includes('"veryfront"'), "bare specifier must be replaced");
      assert(rewritten.includes("data:text/javascript,"), "specifier must point at the shim");
    });

    it("handles single quotes and leaves other specifiers untouched", () => {
      const rewritten = rewriteBareVeryfrontConfigImports(
        "import { defineConfig } from 'veryfront';\nimport other from './local.ts';\nimport 'veryfront';",
      );

      assert(!rewritten.includes("'veryfront'"));
      assert(rewritten.includes("./local.ts"), "relative imports must stay untouched");
    });

    it("does not rewrite veryfront subpath or lookalike specifiers", () => {
      const source =
        'import { a } from "veryfront/head";\nimport { b } from "not-veryfront";\nconst s = "veryfront";';
      assertEquals(rewriteBareVeryfrontConfigImports(source), source);
    });

    it("produces a module whose defineConfig behaves as identity end to end", async () => {
      const source = [
        'import { defineConfig } from "veryfront";',
        'export default defineConfig({ projectSlug: "shimmed", title: "Shim" });',
      ].join("\n");

      const transpiled = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const rewritten = rewriteBareVeryfrontConfigImports(transpiled);
      const module = await import(`data:application/javascript;base64,${btoa(rewritten)}`) as {
        default: { projectSlug: string; title: string };
      };

      assertEquals(module.default.projectSlug, "shimmed");
      assertEquals(module.default.title, "Shim");
    });

    it("shims defineConfigWithEnv with a working environment factory", async () => {
      const source = [
        'import { defineConfigWithEnv } from "veryfront";',
        "export default defineConfigWithEnv((env) => ({ title: `env:${env}` }));",
      ].join("\n");

      const transpiled = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");
      const rewritten = rewriteBareVeryfrontConfigImports(transpiled);
      const module = await import(`data:application/javascript;base64,${btoa(rewritten)}`) as {
        default: { title: string };
      };

      assert(module.default.title.startsWith("env:"), "factory must receive an env name");
    });
  });

  describe("clearConfigCache", () => {
    it("should not throw when called on empty cache", () => {
      clearConfigCache();
    });

    it("should invalidate previously cached configs", async () => {
      const adapter = setup();

      const config1 = await getConfig("/test-project", adapter);
      assert(config1 !== null);

      const config2 = await getConfig("/test-project", adapter);
      assertEquals(config2, config1);

      clearConfigCache();
      const config3 = await getConfig("/test-project", adapter);
      assert(config3 !== null);
      assert(config3 !== config1, "Expected new object after cache clear");
    });
  });

  describe("getCachedConfigSync", () => {
    it("should return null for uncached project", () => {
      clearConfigCache();
      assertEquals(getCachedConfigSync("/nonexistent-project"), null);
    });

    it("returns the config cached for a project directory", async () => {
      const adapter = setup();
      const config = await getConfig("/cached-project", adapter);

      assertEquals(getCachedConfigSync("/cached-project"), config);
    });

    it("should return null after cache is cleared", async () => {
      const adapter = setup();

      await getConfig("/cached-project", adapter);
      clearConfigCache();

      assertEquals(getCachedConfigSync("/cached-project"), null);
    });
  });

  describe("getConfig", () => {
    it("should return default config when no config file exists", async () => {
      const adapter = setup();

      const config = await getConfig("/empty-project", adapter);
      assert(config !== null);
      assertEquals(config.title, "Veryfront App");
      assertEquals(config.description, "Built with Veryfront");
      assertEquals(config.build?.outDir, "dist");
      assertEquals(config.dev?.port, 3000);
      assertEquals(config.dev?.host, "localhost");
      assertEquals(config.dev?.open, false);
      assertEquals(config.client?.moduleResolution, "cdn");
      assertEquals(config.client?.cdn?.provider, "esm.sh");
    });

    it("should return cached config on subsequent calls", async () => {
      const adapter = setup();

      const config1 = await getConfig("/cached-test", adapter);
      const config2 = await getConfig("/cached-test", adapter);

      assertEquals(config1, config2);
    });

    it("should cache separately for different project directories", async () => {
      const adapter = setup();

      const configA = await getConfig("/project-a", adapter);
      const configB = await getConfig("/project-b", adapter);

      assert(configA !== null);
      assert(configB !== null);
      assertEquals(configA.title, "Veryfront App");
      assertEquals(configB.title, "Veryfront App");
    });

    it("should load and validate a JS config file", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-js-" });
      const configPath = `${projectDir}/veryfront.config.js`;
      const source = 'export default { title: "JS Project" };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "JS Project");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects removed integration configuration", async () => {
      const adapter = setup();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => true,
      });
      const projectDir = "/typed-integration-config";
      const configPath = "/veryfront.config.ts";
      const source = [
        'import { defineConfig } from "veryfront";',
        'export default defineConfig({ integrations: { linear: { scope: "endUser" } } });',
      ].join("\n");

      adapter.fs.files.set(configPath, source);

      await assertRejects(
        () => getConfig(projectDir, adapter),
        VeryfrontError,
        "Unknown config keys: integrations",
      );
    });

    it("should try multiple config file names", async () => {
      const adapter = setup();
      const projectDir = await Deno.makeTempDir({ prefix: "vf-config-mjs-" });
      const configPath = `${projectDir}/veryfront.config.mjs`;
      const source = 'export default { title: "MJS Project" };';

      try {
        await Deno.writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "MJS Project");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a detected config file that cannot be imported", async () => {
      const adapter = setup();
      adapter.fs.files.set(
        "/broken-project/veryfront.config.js",
        "export default {",
      );

      const error = await assertRejects(() => getConfig("/broken-project", adapter));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-parse-error");
      assertEquals(getCachedConfigSync("/broken-project"), null);
    });

    it("should produce fresh defaults per call after cache clear", async () => {
      const adapter = setup();

      const config1 = await getConfig("/fresh-test-1", adapter);
      clearConfigCache();
      const config2 = await getConfig("/fresh-test-2", adapter);

      assert(config1 !== config2, "Expected different object references for fresh defaults");
      assertEquals(config1.title, config2.title);
    });

    it("should include default resolve.importMap", async () => {
      const adapter = setup();

      const config = await getConfig("/importmap-test", adapter);
      assert(config.resolve !== undefined);
      assert(config.resolve.importMap !== undefined);
      assert(config.resolve.importMap.imports !== undefined);
    });

    it("should include default cache.render config", async () => {
      const adapter = setup();

      const config = await getConfig("/cache-test", adapter);
      assert(config.cache !== undefined);
      assertEquals(config.cache.render?.type, "memory");
      assertEquals(config.cache.render?.maxEntries, 500);
    });

    it("should include default experimental config", async () => {
      const adapter = setup();

      const config = await getConfig("/experimental-test", adapter);
      assertEquals(config.experimental?.esmLayouts, true);
    });

    it("should include default build.esbuild config", async () => {
      const adapter = setup();

      const config = await getConfig("/build-test", adapter);
      assertEquals(config.build?.trailingSlash, false);
      assertEquals(config.build?.esbuild?.worker, false);
      assert(typeof config.build?.esbuild?.wasmURL === "string");
    });

    it("should include default theme config", async () => {
      const adapter = setup();

      const config = await getConfig("/theme-test", adapter);
      assertEquals(config.theme?.colors?.primary, "#3B82F6");
    });
  });

  describe("mergeConfigs deep merge", () => {
    it("keeps default cache.render when user overrides only cache.dir", () => {
      const merged = mergeConfigs({ cache: { dir: "/custom" } });
      assertEquals(merged.cache?.dir, "/custom");
      // render sub-object must survive the partial override (regression: shallow
      // spread dropped it and crashed callers reading cache.render.type).
      assertEquals(merged.cache?.render?.type, "memory");
      assertEquals(merged.cache?.render?.maxEntries, 500);
    });

    it("keeps default build.esbuild fields when user overrides only build.outDir", () => {
      const merged = mergeConfigs({ build: { outDir: "out" } });
      assertEquals(merged.build?.outDir, "out");
      assertEquals(merged.build?.esbuild?.worker, false);
      assert(typeof merged.build?.esbuild?.wasmURL === "string");
    });

    it("keeps default theme colors when user sets an unrelated color", () => {
      const merged = mergeConfigs({ theme: { colors: { secondary: "#000000" } } });
      assertEquals(merged.theme?.colors?.primary, "#3B82F6");
      assertEquals(merged.theme?.colors?.secondary, "#000000");
    });
  });
});
