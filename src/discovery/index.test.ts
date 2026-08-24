import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearTrackedAgents, clearTranspileCache, createEmptyDiscoveryResult } from "./index.ts";
import type { DiscoveryConfig } from "./index.ts";

describe("src/discovery/index", () => {
  describe("clearTranspileCache", () => {
    it("should not throw when clearing empty cache", () => {
      clearTranspileCache();
    });

    it("should be callable multiple times", () => {
      clearTranspileCache();
      clearTranspileCache();
    });
  });

  describe("clearTrackedAgents", () => {
    it("should not throw when clearing empty tracked agents", () => {
      clearTrackedAgents();
    });

    it("should be callable multiple times", () => {
      clearTrackedAgents();
      clearTrackedAgents();
    });
  });

  describe("DiscoveryConfig type", () => {
    it("should accept minimal config", () => {
      const config: DiscoveryConfig = { baseDir: "/tmp/project" };

      assertEquals(config.baseDir, "/tmp/project");
      assertEquals(config.toolDirs, undefined);
      assertEquals(config.agentDirs, undefined);
    });

    it("should accept full config", () => {
      const config: DiscoveryConfig = {
        baseDir: "/tmp/project",
        toolDirs: ["tools", "custom-tools"],
        agentDirs: ["agents"],
        resourceDirs: ["resources"],
        promptDirs: ["prompts"],
        workflowDirs: ["workflows"],
        verbose: true,
        scheduleDirs: ["schedules"],
        webhookDirs: ["webhooks"],
      };

      assertEquals(config.toolDirs?.length, 2);
      assertEquals(config.verbose, true);
    });
  });

  describe("DiscoveryResult type", () => {
    // Every primitive map the factory must expose; `errors` is the one
    // non-map field and is checked separately.
    const EMPTY_RESULT_MAP_FIELDS = [
      "agents",
      "evals",
      "prompts",
      "resources",
      "schedules",
      "skills",
      "tasks",
      "tools",
      "webhooks",
      "workflows",
    ] as const;

    it("should have all expected map fields", () => {
      const result = createEmptyDiscoveryResult();

      assertEquals(
        Object.keys(result).sort(),
        [...EMPTY_RESULT_MAP_FIELDS, "errors"].sort(),
        "createEmptyDiscoveryResult must expose every result field",
      );
      for (const field of EMPTY_RESULT_MAP_FIELDS) {
        const value: unknown = result[field];
        assert(value instanceof Map, `${field} must be a Map on an empty discovery result`);
        assertEquals(value.size, 0, `${field} must start empty`);
      }
      assertEquals(result.errors, [], "errors must start as an empty array");
    });
  });
});
