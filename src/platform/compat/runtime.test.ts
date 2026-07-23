import "#veryfront/schemas/_test-setup.ts";
/**
 * Runtime Detection Tests
 *
 * These tests verify the cross-runtime detection utilities work correctly.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectRuntimeEnvironment,
  detectRuntimeFromHost,
  detectRuntimeFromHosts,
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

    it("keeps runtime flags mutually exclusive and consistent with classification", () => {
      const activeCount = [isDeno, isNode, isBun, isCloudflare].filter(Boolean).length;
      const runtime = detectRuntimeEnvironment();
      assertEquals(activeCount, runtime === "unknown" ? 0 : 1);
      assertEquals(isDeno, runtime === "deno");
      assertEquals(isNode, runtime === "node");
      assertEquals(isBun, runtime === "bun");
      assertEquals(isCloudflare, runtime === "cloudflare");
    });
  });

  describe("detectRuntimeFromHost", () => {
    const nodeProcess = {
      versions: { node: "24.0.0" },
      release: { name: "node" },
      cwd: () => "/workspace",
    };
    const denoRuntime = {
      version: { deno: "2.0.0" },
      build: { os: "linux" },
      execPath: () => "/runtime/deno",
    };
    const bunRuntime = { version: "1.2.0", serve: () => ({}) };

    it("prioritizes Cloudflare over Node and Bun compatibility globals", () => {
      assertEquals(
        detectRuntimeFromHost({
          navigator: { userAgent: "Cloudflare-Workers" },
          process: nodeProcess,
          Bun: bunRuntime,
        }),
        "cloudflare",
      );
    });

    it("recognizes Workers without navigator through runtime APIs", () => {
      assertEquals(
        detectRuntimeFromHost({ caches: {}, WebSocketPair: class {} }),
        "cloudflare",
      );
    });

    it("recognizes native Deno even when its Node compatibility process exists", () => {
      assertEquals(
        detectRuntimeFromHost({
          Deno: denoRuntime,
          process: {
            ...nodeProcess,
            versions: { node: "24.0.0", deno: "2.0.0" },
          },
        }),
        "deno",
      );
    });

    it("recognizes Bun before its Node-compatible process", () => {
      assertEquals(detectRuntimeFromHost({ Bun: bunRuntime, process: nodeProcess }), "bun");
    });

    it("ignores an empty Bun shim and recognizes Node", () => {
      assertEquals(detectRuntimeFromHost({ Bun: {}, process: nodeProcess }), "node");
      assertEquals(
        detectRuntimeFromHost({ Bun: { version: "   ", serve: () => ({}) }, process: nodeProcess }),
        "node",
      );
    });

    it("recognizes Node in the presence of a dnt Deno shim", () => {
      assertEquals(
        detectRuntimeFromHost({ Deno: denoRuntime, process: nodeProcess }),
        "node",
      );
    });

    it("rejects browser process and Bun shims", () => {
      assertEquals(
        detectRuntimeFromHost({ process: { versions: { node: "24.0.0" } }, Bun: {} }),
        "unknown",
      );
    });

    it("treats hostile globals as unknown", () => {
      const hostile = new Proxy({}, {
        get: () => {
          throw new Error("blocked");
        },
        has: () => {
          throw new Error("blocked");
        },
      });

      assertEquals(detectRuntimeFromHost(hostile), "unknown");
    });

    it("falls back to the universal host when an SSR self stub is not a runtime", () => {
      assertEquals(
        detectRuntimeFromHosts(
          { window: {}, navigator: { userAgent: "Veryfront SSR" } },
          { process: nodeProcess },
        ),
        "node",
      );
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
    it("prefers Deno's standalone runtime signal over the executable name", () => {
      assertEquals(
        testDenoCompiledDetection("/opt/homebrew/bin/deno", true),
        true,
        "Deno.build.standalone is authoritative for compiled executables",
      );
      assertEquals(
        testDenoCompiledDetection("/usr/local/bin/custom-deno-name", false),
        false,
        "a non-standalone Deno runtime is not compiled even when renamed",
      );
    });

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
      assertEquals(testDenoCompiledDetection(42 as unknown as string), false);
      assertEquals(testDenoCompiledDetection(""), false);
      assertEquals(
        testDenoCompiledDetection("/app/veryfront", "yes" as unknown as boolean),
        false,
      );
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

    it("treats an explicitly undefined window value as server-side", () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
      try {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: undefined,
          writable: true,
        });
        assertEquals(isServerEnvironment(), true);
        assertEquals(isBrowserEnvironment(), false);
      } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
      }
    });
  });

  describe("runtime constants consistency", () => {
    it("isDeno should match expected runtime", () => {
      if (isDeno) {
        assertEquals(isNode, false);
        assertEquals(isBun, false);
      }
    });

    it("isNode should match expected runtime", () => {
      if (isNode) {
        assertEquals(isDeno, false);
        assertEquals(isBun, false);
      }
    });

    it("isBun should match expected runtime", () => {
      if (isBun) {
        assertEquals(isDeno, false);
        assertEquals(isNode, false);
      }
    });

    it("isCloudflare should be boolean", () => {
      assertEquals(typeof isCloudflare, "boolean");
    });

    it("isNodeRuntime() should agree with isNode constant", () => {
      assertEquals(isNodeRuntime(), isNode);
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
