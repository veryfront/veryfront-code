import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(_baseDir: string): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: (path: string) => Deno.readTextFile(path),
      writeFile: (path: string, content: string) => Deno.writeTextFile(path, content),
      exists: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      mkdir: (path: string, opts?: { recursive?: boolean }) => Deno.mkdir(path, opts),
      readDir: (path: string) => Deno.readDir(path),
      stat: (path: string) => Deno.stat(path),
      remove: (path: string, opts?: { recursive?: boolean }) => Deno.remove(path, opts),
      readTextFile: (path: string) => Deno.readTextFile(path),
      writeTextFile: (path: string, content: string) => Deno.writeTextFile(path, content),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/asset-pipeline/css-optimizer/optimizer-service", () => {
  describe("CSSOptimizerService", () => {
    it("should construct with default options", () => {
      const tmpDir = "/tmp/test-css-optimizer";
      const adapter = createMockAdapter(tmpDir);
      const service = new CSSOptimizerService(adapter, tmpDir);
      const options = service.getOptions();
      assertEquals(options.enabled, true);
      assertEquals(options.minify, true);
      assertEquals(options.autoprefixer, true);
      assertEquals(options.purge, false);
      assertEquals(options.criticalCSS, false);
    });

    it("should merge user options with defaults", () => {
      const tmpDir = "/tmp/test-css-optimizer";
      const adapter = createMockAdapter(tmpDir);
      const service = new CSSOptimizerService(adapter, tmpDir, {
        minify: false,
        purge: true,
      });
      const options = service.getOptions();
      assertEquals(options.minify, false);
      assertEquals(options.purge, true);
      assertEquals(options.enabled, true); // default kept
    });

    it("should return empty stats initially", () => {
      const tmpDir = "/tmp/test-css-optimizer";
      const adapter = createMockAdapter(tmpDir);
      const service = new CSSOptimizerService(adapter, tmpDir);
      const stats = service.getStats();
      assertExists(stats);
    });

    it("should return empty map when disabled during optimize", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const adapter = createMockAdapter(tmpDir);
        const service = new CSSOptimizerService(adapter, tmpDir, { enabled: false });
        const result = await service.optimize();
        assertEquals(result.size, 0);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should provide cache manager", () => {
      const tmpDir = "/tmp/test-css-optimizer";
      const adapter = createMockAdapter(tmpDir);
      const service = new CSSOptimizerService(adapter, tmpDir);
      const cache = service.getCacheManager();
      assertExists(cache);
    });

    it("should provide purge strategy", () => {
      const tmpDir = "/tmp/test-css-optimizer";
      const adapter = createMockAdapter(tmpDir);
      const service = new CSSOptimizerService(adapter, tmpDir);
      const purge = service.getPurgeStrategy();
      assertExists(purge);
    });
  });
});
