/**
 * Runtime Detection Tests
 *
 * These tests verify the cross-runtime detection utilities work correctly.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isBrowserEnvironment,
  isBun,
  isCloudflare,
  isDeno,
  isDenoCompiled,
  isNode,
  isNodeRuntime,
  isServerEnvironment,
  testDenoCompiledDetection,
} from "./runtime.ts";

describe("Runtime Detection", () => {
  describe("runtime constants", () => {
    it("should export boolean constants", () => {
      assertEquals(typeof isDeno, "boolean");
      assertEquals(typeof isNode, "boolean");
      assertEquals(typeof isBun, "boolean");
      assertEquals(typeof isCloudflare, "boolean");
    });

    it("should have exactly one main runtime active (excluding Cloudflare)", () => {
      const activeCount = [isDeno, isNode, isBun].filter(Boolean).length;
      assertEquals(activeCount, 1, "Exactly one main runtime should be detected");
    });
  });

  describe("isDeno", () => {
    it("should correctly detect Deno runtime", () => {
      if (!isDeno) return;
      assertEquals(isNode, false);
      assertEquals(isBun, false);
    });
  });

  describe("isNode", () => {
    it("should correctly detect Node.js runtime", () => {
      if (!isNode) return;
      assertEquals(isDeno, false);
      assertEquals(isBun, false);
    });
  });

  describe("isBun", () => {
    it("should correctly detect Bun runtime", () => {
      if (!isBun) return;
      assertEquals(isDeno, false);
      assertEquals(isNode, false);
    });
  });

  describe("isNodeRuntime function", () => {
    it("should return same result as isNode constant", () => {
      assertEquals(isNodeRuntime(), isNode);
    });

    it("should be callable as a function", () => {
      assertEquals(typeof isNodeRuntime(), "boolean");
    });
  });

  describe("isDenoCompiled", () => {
    it("should export isDenoCompiled constant", () => {
      assertEquals(typeof isDenoCompiled, "boolean");
    });
  });

  describe("testDenoCompiledDetection (binary name detection)", () => {
    it("should NOT detect standard Deno runtime (binary named 'deno')", () => {
      const denoPaths = [
        "/home/user/.deno/bin/deno",
        "/usr/bin/deno",
        "/opt/homebrew/bin/deno",
        "C:\\Users\\dev\\.deno\\bin\\deno.exe",
      ];

      for (const path of denoPaths) {
        assertEquals(
          testDenoCompiledDetection(path),
          false,
          `${path} should NOT be detected as compiled`,
        );
      }
    });

    it("should detect compiled binary named 'veryfront' (production case)", () => {
      assertEquals(
        testDenoCompiledDetection("/app/veryfront"),
        true,
        "veryfront binary should be detected as compiled",
      );
    });

    it("should detect any custom-named compiled binary", () => {
      const compiledPaths = [
        "/usr/local/bin/myapp",
        "/app/renderer",
        "/home/user/projects/server",
        "C:\\Program Files\\myapp\\server.exe",
      ];

      for (const path of compiledPaths) {
        assertEquals(
          testDenoCompiledDetection(path),
          true,
          `${path} should be detected as compiled`,
        );
      }
    });

    it("should detect compiled binary in folder with 'deno' in path", () => {
      assertEquals(
        testDenoCompiledDetection("/home/user/projects/deno-myproject/server"),
        true,
        "Binary in deno-* folder should still be detected as compiled",
      );
    });

    it("should detect compiled binary with 'deno-' prefix in name", () => {
      assertEquals(
        testDenoCompiledDetection("/usr/local/bin/deno-fresh"),
        true,
        "Binary named deno-fresh should be detected as compiled",
      );
    });

    it("should detect compiled binary in .deno folder", () => {
      assertEquals(
        testDenoCompiledDetection("/var/lib/deno/compiled/myapp"),
        true,
        "Compiled app in deno folder should be detected",
      );
    });

    it("should handle undefined/null/empty gracefully", () => {
      assertEquals(testDenoCompiledDetection(undefined as unknown as string), false);
      assertEquals(testDenoCompiledDetection(null as unknown as string), false);
      assertEquals(testDenoCompiledDetection(""), false);
    });

    it("should handle Windows paths correctly", () => {
      assertEquals(
        testDenoCompiledDetection("C:\\Users\\dev\\.deno\\bin\\deno.exe"),
        false,
        "Windows deno.exe should NOT be compiled",
      );
      assertEquals(
        testDenoCompiledDetection("C:\\Program Files\\MyApp\\server.exe"),
        true,
        "Windows compiled app should be detected",
      );
    });
  });

  describe("isServerEnvironment / isBrowserEnvironment", () => {
    it("isServerEnvironment should return true in test environment", () => {
      assertEquals(isServerEnvironment(), true);
    });

    it("isBrowserEnvironment should return false in test environment", () => {
      assertEquals(isBrowserEnvironment(), false);
    });
  });

  describe("runtime constants in Deno test environment", () => {
    it("isDeno should be true", () => {
      assertEquals(isDeno, true);
    });

    it("isBun should be false", () => {
      assertEquals(isBun, false);
    });

    it("isNode should be false", () => {
      assertEquals(isNode, false);
    });

    it("isCloudflare should be false", () => {
      assertEquals(isCloudflare, false);
    });

    it("isNodeRuntime() should return false", () => {
      assertEquals(isNodeRuntime(), false);
    });
  });

  describe("integration: HTTP import caching decision", () => {
    it("should detect production binary 'veryfront' as compiled (enables HTTP caching)", () => {
      const isCompiled = testDenoCompiledDetection("/app/veryfront");
      assertEquals(isCompiled, true, "Production binary should be detected as compiled");

      const isDeno = true;
      const canDoNativeHttpImports = isDeno && !isCompiled;
      assertEquals(
        canDoNativeHttpImports,
        false,
        "Compiled binary should NOT be able to do native HTTP imports",
      );
    });

    it("should detect standard Deno as NOT compiled (skips HTTP caching)", () => {
      const isCompiled = testDenoCompiledDetection("/home/user/.deno/bin/deno");
      assertEquals(isCompiled, false, "Standard Deno should NOT be detected as compiled");

      const isDeno = true;
      const canDoNativeHttpImports = isDeno && !isCompiled;
      assertEquals(
        canDoNativeHttpImports,
        true,
        "Standard Deno CAN do native HTTP imports",
      );
    });
  });
});
