/**
 * Runtime Detection Tests
 *
 * These tests verify the cross-runtime detection utilities work correctly.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isBun,
  isCloudflare,
  isDeno,
  isDenoCompiled,
  isNode,
  isNodeRuntime,
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
    // The most robust detection method: check if the binary name is "deno"/"deno.exe".
    // If NOT, it's a compiled binary. This works regardless of installation path.

    it("should NOT detect standard Deno runtime (binary named 'deno')", () => {
      const denoPaths = [
        "/home/user/.deno/bin/deno",
        "/usr/bin/deno",
        "/opt/homebrew/bin/deno",
        "C:\\Users\\dev\\.deno\\bin\\deno.exe",
      ];
      for (const path of denoPaths) {
        const result = testDenoCompiledDetection(path);
        assertEquals(result, false, `${path} should NOT be detected as compiled`);
      }
    });

    it("should detect compiled binary named 'veryfront' (production case)", () => {
      const result = testDenoCompiledDetection("/app/veryfront");
      assertEquals(result, true, "veryfront binary should be detected as compiled");
    });

    it("should detect any custom-named compiled binary", () => {
      const compiledPaths = [
        "/usr/local/bin/myapp",
        "/app/renderer",
        "/home/user/projects/server",
        "C:\\Program Files\\myapp\\server.exe",
      ];
      for (const path of compiledPaths) {
        const result = testDenoCompiledDetection(path);
        assertEquals(result, true, `${path} should be detected as compiled`);
      }
    });

    it("should detect compiled binary in folder with 'deno' in path", () => {
      // This was a bug in the old path-based detection
      const result = testDenoCompiledDetection("/home/user/projects/deno-myproject/server");
      assertEquals(result, true, "Binary in deno-* folder should still be detected as compiled");
    });

    it("should detect compiled binary with 'deno-' prefix in name", () => {
      // e.g., someone compiles their app as "deno-fresh"
      const result = testDenoCompiledDetection("/usr/local/bin/deno-fresh");
      assertEquals(result, true, "Binary named deno-fresh should be detected as compiled");
    });

    it("should detect compiled binary in .deno folder", () => {
      // Compiled app placed in .deno folder (unusual but valid)
      const result = testDenoCompiledDetection("/var/lib/deno/compiled/myapp");
      assertEquals(result, true, "Compiled app in deno folder should be detected");
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

  describe("integration: HTTP import caching decision", () => {
    // This test validates the fix for the production bug where esm.sh imports failed
    // because isDenoCompiled was incorrectly returning false for compiled binaries.
    //
    // The http-cache.ts and loader.ts use this logic:
    //   const canDoNativeHttpImports = isDeno && !isDenoCompiled;
    //   if (canDoNativeHttpImports) return code; // skip caching
    //
    // When isDenoCompiled is TRUE (compiled binary), canDoNativeHttpImports is FALSE,
    // so HTTP imports ARE cached to local files (correct behavior).

    it("should detect production binary 'veryfront' as compiled (enables HTTP caching)", () => {
      // Production binary path from logs: /app/veryfront
      const isCompiled = testDenoCompiledDetection("/app/veryfront");
      assertEquals(isCompiled, true, "Production binary should be detected as compiled");

      // Simulate the http-cache decision logic
      const isDeno = true; // We're in Deno
      const canDoNativeHttpImports = isDeno && !isCompiled;
      assertEquals(
        canDoNativeHttpImports,
        false,
        "Compiled binary should NOT be able to do native HTTP imports",
      );
      // When canDoNativeHttpImports is false, HTTP imports ARE cached (correct)
    });

    it("should detect standard Deno as NOT compiled (skips HTTP caching)", () => {
      const isCompiled = testDenoCompiledDetection("/home/user/.deno/bin/deno");
      assertEquals(isCompiled, false, "Standard Deno should NOT be detected as compiled");

      // Simulate the http-cache decision logic
      const isDeno = true;
      const canDoNativeHttpImports = isDeno && !isCompiled;
      assertEquals(
        canDoNativeHttpImports,
        true,
        "Standard Deno CAN do native HTTP imports",
      );
      // When canDoNativeHttpImports is true, HTTP imports are NOT cached (correct for dev)
    });
  });
});
