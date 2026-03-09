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

    it("should return limited capabilities for cloudflare-workers", () => {
      const caps = getPlatformCapabilities("cloudflare-workers");
      assertEquals(caps.canRunMCPServer, false);
      assertEquals(caps.hasFileSystem, false);
      assertEquals(caps.maxAgentSteps, 3);
      assertEquals(caps.streamingRecommended, true);
    });

    it("should return unknown capabilities", () => {
      const caps = getPlatformCapabilities("unknown");
      assertEquals(caps.canRunMCPServer, false);
      assertEquals(caps.displayName, "Unknown Platform");
    });
  });

  describe("supportsCapability", () => {
    it("should return true for boolean capabilities that are true", () => {
      assertEquals(supportsCapability("canRunMCPServer"), true);
    });

    it("should return true for positive number capabilities", () => {
      assertEquals(supportsCapability("maxAgentSteps"), true);
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

    it("should error when maxSteps exceeds platform limit", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 10 },
        "cloudflare-workers",
      );
      assertEquals(result.compatible, false);
      assertEquals(result.errors.length > 0, true);
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

    it("should be compatible when maxSteps is within limit", () => {
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
  });

  describe("detectPlatform", () => {
    it("should detect current platform", () => {
      const platform = detectPlatform();
      assertEquals(typeof platform, "string");
      assertEquals(platform.length > 0, true);
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

    it("should return specific limits for cloudflare-workers", () => {
      const caps = getPlatformCapabilities("cloudflare-workers");
      assertEquals(caps.cpuTimeLimit, 30_000);
      assertEquals(caps.memoryLimit, 128);
    });

    it("should return limits for unknown platform", () => {
      const caps = getPlatformCapabilities("unknown");
      assertEquals(caps.cpuTimeLimit, 60_000);
      assertEquals(caps.memoryLimit, 512);
      assertEquals(caps.maxAgentSteps, 5);
    });
  });

  describe("supportsCapability edge cases", () => {
    it("should return a boolean for hasFileSystem", () => {
      assertEquals(typeof supportsCapability("hasFileSystem"), "boolean");
    });

    it("should return a boolean for streamingRecommended", () => {
      assertEquals(typeof supportsCapability("streamingRecommended"), "boolean");
    });

    it("should return a boolean for canRunMCPServer", () => {
      assertEquals(typeof supportsCapability("canRunMCPServer"), "boolean");
    });
  });

  describe("getPlatformWarnings edge cases", () => {
    it("should return an array", () => {
      const warnings = getPlatformWarnings();
      assertEquals(Array.isArray(warnings), true);
    });
  });
});
