import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectPlatform,
  getPlatformCapabilities,
  getPlatformWarnings,
  supportsCapability,
  validatePlatformCompatibility,
} from "./core-platform.ts";

function assertCapabilityNameTypes(): void {
  // @ts-expect-error Numeric constraints are not capabilities.
  supportsCapability("maxAgentSteps", "deno");
  // @ts-expect-error Display metadata is not a capability.
  supportsCapability("displayName", "deno");
}

void assertCapabilityNameTypes;

describe("platform/core-platform", () => {
  describe("getPlatformCapabilities", () => {
    it("returns truthful baseline features for local runtimes", () => {
      for (const platform of ["deno", "node", "bun"] as const) {
        const capabilities = getPlatformCapabilities(platform);
        assertEquals(capabilities.canRunMCPServer, true);
        assertEquals(capabilities.hasFileSystem, true);
        assertEquals(capabilities.supportsLongRunning, true);
        assertEquals(capabilities.maxAgentSteps, null);
        assertEquals(capabilities.cpuTimeLimit, null);
        assertEquals(capabilities.memoryLimit, null);
      }
    });

    it("does not invent deployment limits for Workers or unknown hosts", () => {
      for (const platform of ["cloudflare-workers", "unknown"] as const) {
        const capabilities = getPlatformCapabilities(platform);
        assertEquals(capabilities.canRunMCPServer, false);
        assertEquals(capabilities.hasFileSystem, false);
        assertEquals(capabilities.maxAgentSteps, null);
        assertEquals(capabilities.cpuTimeLimit, null);
        assertEquals(capabilities.memoryLimit, null);
      }
    });

    it("applies explicit deployment capabilities without changing the baseline", () => {
      const configured = getPlatformCapabilities("cloudflare-workers", {
        hasFileSystem: true,
        maxAgentSteps: 12,
        cpuTimeLimit: 5_000,
      });

      assertEquals(configured.hasFileSystem, true);
      assertEquals(configured.maxAgentSteps, 12);
      assertEquals(configured.cpuTimeLimit, 5_000);
      assertEquals(getPlatformCapabilities("cloudflare-workers").hasFileSystem, false);
    });

    it("returns frozen capability records", () => {
      const capabilities = getPlatformCapabilities("deno");
      assertEquals(Object.isFrozen(capabilities), true);

      try {
        (capabilities as { hasFileSystem: boolean }).hasFileSystem = false;
      } catch {
        // Frozen records may throw in strict mode.
      }

      assertEquals(getPlatformCapabilities("deno").hasFileSystem, true);
    });

    it("rejects invalid configured limits", async () => {
      await assertRejects(
        async () => {
          getPlatformCapabilities("cloudflare-workers", { maxAgentSteps: 0 });
        },
        Error,
        "maxAgentSteps",
      );
    });

    it("treats inherited object names as unknown platforms", () => {
      assertEquals(
        getPlatformCapabilities("constructor" as never).displayName,
        "Unknown Platform",
      );
    });

    it("snapshots each override accessor exactly once", () => {
      let reads = 0;
      const overrides = Object.defineProperty({}, "maxAgentSteps", {
        enumerable: true,
        get() {
          reads++;
          return reads === 1 ? 5 : 0;
        },
      });

      const capabilities = getPlatformCapabilities(
        "cloudflare-workers",
        overrides,
      );

      assertEquals(capabilities.maxAgentSteps, 5);
      assertEquals(reads, 1);
    });

    it("does not apply inherited overrides", () => {
      const overrides = Object.create({ hasFileSystem: true });
      assertEquals(
        getPlatformCapabilities("cloudflare-workers", overrides).hasFileSystem,
        false,
      );
    });

    it("treats explicit undefined values as omitted overrides", () => {
      const capabilities = getPlatformCapabilities("cloudflare-workers", {
        hasFileSystem: undefined,
        maxAgentSteps: undefined,
      });

      assertEquals(capabilities.hasFileSystem, false);
      assertEquals(capabilities.maxAgentSteps, null);
    });
  });

  describe("supportsCapability", () => {
    it("answers only boolean feature questions", () => {
      assertEquals(supportsCapability("hasFileSystem", "deno"), true);
      assertEquals(supportsCapability("hasFileSystem", "cloudflare-workers"), false);
      assertEquals(supportsCapability("streamingRecommended", "cloudflare-workers"), true);
    });

    it("rejects inherited object members as capability names", () => {
      assertThrows(
        () => supportsCapability("toString" as never, "deno"),
        Error,
        "capability",
      );
    });
  });

  describe("getPlatformWarnings", () => {
    it("does not report invented step, CPU, or memory limits", () => {
      const warnings = getPlatformWarnings("cloudflare-workers");

      assertEquals(warnings.some((warning) => warning.includes("agent steps")), false);
      assertEquals(warnings.some((warning) => warning.includes("CPU time")), false);
      assertEquals(warnings.some((warning) => warning.includes("MCP server")), true);
      assertEquals(warnings.some((warning) => warning.includes("file system")), true);
    });

    it("reports explicit deployment limits without arbitrary warning thresholds", () => {
      const warnings = getPlatformWarnings("cloudflare-workers", {
        maxAgentSteps: 12,
        cpuTimeLimit: 120_000,
        memoryLimit: 256,
      });

      assertEquals(warnings.some((warning) => warning.includes("12")), true);
      assertEquals(warnings.some((warning) => warning.includes("120000 milliseconds")), true);
      assertEquals(warnings.some((warning) => warning.includes("256 megabytes")), true);
    });
  });

  describe("validatePlatformCompatibility", () => {
    it("does not reject maxSteps when the deployment has no configured limit", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 100 },
        "cloudflare-workers",
      );

      assertEquals(result.compatible, true);
      assertEquals(result.errors, []);
    });

    it("enforces an explicit deployment step limit", () => {
      const result = validatePlatformCompatibility(
        { maxSteps: 10 },
        "cloudflare-workers",
        { maxAgentSteps: 5 },
      );

      assertEquals(result.compatible, false);
      assertEquals(result.errors.some((error) => error.includes("platform limit (5)")), true);
    });

    it("uses configured filesystem and MCP features", () => {
      const baseline = validatePlatformCompatibility(
        { requiresFileSystem: true, requiresMCP: true },
        "cloudflare-workers",
      );
      const configured = validatePlatformCompatibility(
        { requiresFileSystem: true, requiresMCP: true },
        "cloudflare-workers",
        { hasFileSystem: true, canRunMCPServer: true },
      );

      assertEquals(baseline.compatible, false);
      assertEquals(baseline.errors.length, 2);
      assertEquals(configured.compatible, true);
    });

    it("warns about streaming only when it is recommended and disabled", () => {
      assertEquals(
        validatePlatformCompatibility(
          { streaming: false },
          "cloudflare-workers",
        ).warnings.length,
        1,
      );
      assertEquals(
        validatePlatformCompatibility(
          { streaming: true },
          "cloudflare-workers",
        ).warnings,
        [],
      );
    });

    it("snapshots compatibility accessors once before validation", () => {
      let reads = 0;
      const config = Object.defineProperty({}, "maxSteps", {
        enumerable: true,
        get() {
          reads++;
          return reads === 1 ? 10 : 100;
        },
      });

      const result = validatePlatformCompatibility(
        config,
        "cloudflare-workers",
        { maxAgentSteps: 5 },
      );

      assertEquals(reads, 1);
      assertEquals(result.errors, ["Agent maxSteps (10) exceeds platform limit (5)"]);
    });

    it("rejects invalid compatibility configuration", () => {
      assertThrows(
        () => validatePlatformCompatibility({ maxSteps: Number.NaN }, "deno"),
        Error,
        "maxSteps",
      );
      assertThrows(
        () => validatePlatformCompatibility(null as never, "deno"),
        Error,
        "configuration",
      );

      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      assertThrows(
        () => validatePlatformCompatibility(revoked.proxy, "deno"),
        Error,
        "not readable",
      );
    });
  });

  describe("detectPlatform", () => {
    it("maps the canonical runtime classifier to a known platform", () => {
      assertEquals(
        ["deno", "node", "bun", "cloudflare-workers", "unknown"].includes(detectPlatform()),
        true,
      );
    });
  });
});
