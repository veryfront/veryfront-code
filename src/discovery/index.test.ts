import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearTrackedAgents, clearTranspileCache } from "./index.ts";
import type { DiscoveryConfig, DiscoveryResult } from "./index.ts";

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
        workDirs: ["work"],
        verbose: true,
        scheduleDirs: ["schedules"],
        webhookDirs: ["webhooks"],
      };

      assertEquals(config.toolDirs?.length, 2);
      assertEquals(config.verbose, true);
    });
  });

  describe("DiscoveryResult type", () => {
    it("should have all expected map fields", () => {
      const result: DiscoveryResult = {
        tools: new Map(),
        agents: new Map(),
        skills: new Map(),
        resources: new Map(),
        prompts: new Map(),
        workflows: new Map(),
        works: new Map(),
        tasks: new Map(),
        schedules: new Map(),
        webhooks: new Map(),
        evals: new Map(),
        errors: [],
      };

      assertEquals(result.tools.size, 0);
      assertEquals(result.agents.size, 0);
      assertEquals(result.resources.size, 0);
      assertEquals(result.prompts.size, 0);
      assertEquals(result.workflows.size, 0);
      assertEquals(result.works.size, 0);
      assertEquals(result.tasks.size, 0);
      assertEquals(result.schedules.size, 0);
      assertEquals(result.webhooks.size, 0);
      assertEquals(result.evals.size, 0);
      assertEquals(result.errors.length, 0);
    });
  });
});
