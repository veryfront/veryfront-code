import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectPlatform,
  getPlatformCapabilities,
  getPlatformWarnings,
  supportsCapability,
  validatePlatformCompatibility,
} from "./core-platform.ts";

describe("platform/core-platform", () => {
  describe("getPlatformCapabilities", () => {
    it("should return capabilities for deno", () => {
      const caps = getPlatformCapabilities("deno");
      assertEquals(caps.canRunMCPServer, true);
      assertEquals(caps.hasFileSystem, true);
      assertEquals(caps.supportsLongRunning, true);
      assertEquals(caps.displayName, "Deno");
    });

    it("should return capabilities for node", () => {
      const caps = getPlatformCapabilities("node");
      assertEquals(caps.canRunMCPServer, true);
      assertEquals(caps.hasFileSystem, true);
      assertEquals(caps.displayName, "Node.js");
    });

    it("should return capabilities for bun", () => {
      const caps = getPlatformCapabilities("bun");
      assertEquals(caps.canRunMCPServer, true);
      assertEquals(caps.displayName, "Bun");
    });

    it("reports invariant Cloudflare capabilities without inventing plan limits", () => {
      const caps = getPlatformCapabilities("cloudflare-workers");
      assertEquals(caps.canRunMCPServer, false);
      assertEquals(caps.hasFileSystem, false);
      assertEquals(caps.cpuTimeLimit, null);
      assertEquals(caps.memoryLimit, 128);
      assertEquals(caps.supportsLongRunning, true);
      assertEquals(caps.streamingRecommended, true);
    });

    it("should return unknown capabilities", () => {
      const caps = getPlatformCapabilities("unknown");
      assertEquals(caps.canRunMCPServer, false);
      assertEquals(caps.displayName, "Unknown Platform");
    });

    it("returns immutable capability records", () => {
      const caps = getPlatformCapabilities("deno");
      assertEquals(Object.isFrozen(caps), true);
    });

    it("does not expose mutable global capability state", () => {
      const caps = getPlatformCapabilities("deno");
      const mutableCaps = caps as unknown as { hasFileSystem: boolean };
      try {
        mutableCaps.hasFileSystem = false;
      } catch {
        // Frozen records throw in strict mode; either way the shared contract must be unchanged.
      }
      const observed = getPlatformCapabilities("deno").hasFileSystem;
      if (!Object.isFrozen(caps)) mutableCaps.hasFileSystem = true;
      assertEquals(observed, true);
    });
  });

  describe("supportsCapability", () => {
    it("reports boolean capabilities for an explicit platform", () => {
      assertEquals(
        supportsCapability("canRunMCPServer", "deno"),
        true,
      );
      assertEquals(
        supportsCapability("canRunMCPServer", "cloudflare-workers"),
        false,
      );
    });
  });

  describe("getPlatformWarnings", () => {
    it("should return no warnings for deno platform", () => {
      const warnings = getPlatformWarnings();
      assertEquals(Array.isArray(warnings), true);
    });
  });

  describe("validatePlatformCompatibility", () => {
    it("should be compatible for simple config on deno", () => {
      const result = validatePlatformCompatibility({}, "deno");
      assertEquals(result.compatible, true);
      assertEquals(result.errors.length, 0);
    });

    it("does not turn a plan-dependent Cloudflare CPU budget into an agent-step limit", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 10 },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, true);
      assertEquals(result.errors, []);
    });

    it("should error when filesystem required but not supported", () => {
      const result = validatePlatformCompatibility(
        { requiresFileSystem: true },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, false);
      assertEquals(result.errors.some((e) => e.includes("file system")), true);
    });

    it("should error when MCP required but not supported", () => {
      const result = validatePlatformCompatibility(
        { requiresMCP: true },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, false);
      assertEquals(result.errors.some((e) => e.includes("MCP")), true);
    });

    it("should warn when streaming not enabled but recommended", () => {
      const result = validatePlatformCompatibility(
        { streaming: false },
        "cloudflare-workers",
      );
      assertEquals(result.warnings.some((w) => w.includes("Streaming")), true);
    });

    it("should not warn about streaming when enabled", () => {
      const result = validatePlatformCompatibility(
        { streaming: true },
        "cloudflare-workers",
      );
      assertEquals(result.warnings.some((w) => w.includes("Streaming")), false);
    });

    it("should be fully compatible on deno with all requirements", () => {
      const result = validatePlatformCompatibility(
        { requiresFileSystem: true, requiresMCP: true, maxSteps: 100 },
        "deno",
      );
      assertEquals(result.compatible, true);
      assertEquals(result.errors.length, 0);
    });

    it("accepts a valid authored maxSteps policy", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 2 },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, true);
    });

    it("should not error for streaming:true on non-streaming platform", () => {
      const result = validatePlatformCompatibility(
        { streaming: true },
        "deno",
      );
      assertEquals(result.warnings.length, 0);
    });

    it("should use detected platform when none specified", () => {
      const result = validatePlatformCompatibility({});
      assertEquals(result.compatible, true);
    });

    it("rejects invalid authored maxSteps values", () => {
      for (const maxSteps of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = validatePlatformCompatibility({ maxSteps }, "deno");
        assertEquals(result.compatible, false);
        assertEquals(
          result.errors.some((error) => error.includes("positive safe integer")),
          true,
        );
      }
    });
  });

  describe("detectPlatform", () => {
    it("should detect current platform", () => {
      const platform = detectPlatform();
      assertEquals(typeof platform, "string");
      assertEquals(platform.length > 0, true);
    });

    it("should return a known platform value", () => {
      const platform = detectPlatform();
      const known = ["deno", "node", "bun", "cloudflare-workers", "unknown"];
      assertEquals(known.includes(platform), true);
    });
  });

  describe("getPlatformCapabilities edge cases", () => {
    it("should detect current platform when no argument given", () => {
      const caps = getPlatformCapabilities();
      assertEquals(typeof caps.displayName, "string");
      assertEquals(caps.displayName.length > 0, true);
    });

    it("should return null cpuTimeLimit for deno", () => {
      const caps = getPlatformCapabilities("deno");
      assertEquals(caps.cpuTimeLimit, null);
      assertEquals(caps.memoryLimit, null);
    });

    it("returns only the invariant Cloudflare memory limit", () => {
      const caps = getPlatformCapabilities("cloudflare-workers");
      assertEquals(caps.cpuTimeLimit, null);
      assertEquals(caps.memoryLimit, 128);
    });

    it("does not invent resource limits for an unknown platform", () => {
      const caps = getPlatformCapabilities("unknown");
      assertEquals(caps.cpuTimeLimit, null);
      assertEquals(caps.memoryLimit, null);
    });
  });

  describe("supportsCapability edge cases", () => {
    it("should return false for streamingRecommended on deno", () => {
      assertEquals(
        supportsCapability("streamingRecommended", "deno"),
        false,
      );
    });

    it("should return true for hasFileSystem on deno", () => {
      assertEquals(supportsCapability("hasFileSystem", "deno"), true);
    });

    it("should return true for supportsLongRunning on deno", () => {
      assertEquals(
        supportsCapability("supportsLongRunning", "deno"),
        true,
      );
    });
  });

  describe("getPlatformWarnings edge cases", () => {
    it("should return empty array for deno", () => {
      const warnings = getPlatformWarnings();
      assertEquals(warnings, []);
    });

    it("does not report fabricated Cloudflare CPU or step ceilings", () => {
      const warnings = getPlatformWarnings("cloudflare-workers");
      assertEquals(
        warnings.some((warning) => warning.includes("no native file system")),
        true,
      );
      assertEquals(warnings.some((warning) => warning.includes("limited agent steps")), false);
      assertEquals(warnings.some((warning) => warning.includes("CPU time limit")), false);
    });
  });

  describe("validatePlatformCompatibility - multiple errors", () => {
    it("should return multiple errors for cloudflare-workers with all requirements", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 100, requiresFileSystem: true, requiresMCP: true, streaming: false },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, false);
      assertEquals(result.errors.length, 2);
      assertEquals(result.warnings.length, 1);
    });

    it("should return errors for unknown platform", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 100, requiresFileSystem: true, requiresMCP: true },
        "unknown",
      );
      assertEquals(result.compatible, false);
      assertEquals(result.errors.length >= 2, true);
    });
  });
});
