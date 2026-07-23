import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearTrackedAgents,
  clearTranspileCache,
  createProjectDiscoveryConfig,
  DEFAULT_PROJECT_DISCOVERY_DIRS,
  discoverAll,
} from "./index.ts";
import type { DiscoveryConfig, DiscoveryResult } from "./index.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

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

    it("rejects discovery directories that escape the project root", async () => {
      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: ["../outside"],
            agentDirs: [],
            skillDirs: [],
            resourceDirs: [],
            promptDirs: [],
            workflowDirs: [],
            taskDirs: [],
            scheduleDirs: [],
            webhookDirs: [],
            evalDirs: [],
          }),
        TypeError,
        "project-relative",
      );
    });

    it("rejects absolute discovery directories", async () => {
      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: ["/outside"],
            agentDirs: [],
            skillDirs: [],
            resourceDirs: [],
            promptDirs: [],
            workflowDirs: [],
            taskDirs: [],
            scheduleDirs: [],
            webhookDirs: [],
            evalDirs: [],
          }),
        TypeError,
        "project-relative",
      );
    });

    it("rejects non-array discovery directory configuration at runtime", async () => {
      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: "tools" as unknown as string[],
            agentDirs: [],
            skillDirs: [],
            resourceDirs: [],
            promptDirs: [],
            workflowDirs: [],
            taskDirs: [],
            scheduleDirs: [],
            webhookDirs: [],
            evalDirs: [],
          }),
        TypeError,
        "must be arrays",
      );
      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: null as unknown as string[],
            agentDirs: [],
            skillDirs: [],
            resourceDirs: [],
            promptDirs: [],
            workflowDirs: [],
            taskDirs: [],
            scheduleDirs: [],
            webhookDirs: [],
            evalDirs: [],
          }),
        TypeError,
        "must be arrays",
      );
    });

    it("rejects duplicate discovery roots after path normalization", async () => {
      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: ["tools", "./tools/"],
            agentDirs: [],
            skillDirs: [],
            resourceDirs: [],
            promptDirs: [],
            workflowDirs: [],
            taskDirs: [],
            scheduleDirs: [],
            webhookDirs: [],
            evalDirs: [],
          }),
        TypeError,
        "duplicate roots",
      );
    });

    it("snapshots discovery configuration before asynchronous work", async () => {
      const probedPaths: string[] = [];
      const fsAdapter = {
        exists(path: string) {
          probedPaths.push(path);
          return Promise.resolve(false);
        },
      } as unknown as FileSystemAdapter;
      let baseDirReads = 0;
      const config = {
        toolDirs: ["tools"],
        agentDirs: [],
        skillDirs: [],
        resourceDirs: [],
        promptDirs: [],
        workflowDirs: [],
        taskDirs: [],
        scheduleDirs: [],
        webhookDirs: [],
        evalDirs: [],
        fsAdapter,
      } as unknown as DiscoveryConfig;
      Object.defineProperty(config, "baseDir", {
        enumerable: true,
        get() {
          baseDirReads++;
          return baseDirReads === 1 ? "/project" : "/outside";
        },
      });

      await discoverAll(config);

      assertEquals(baseDirReads, 1);
      assertEquals(probedPaths, ["/project/tools"]);
    });

    it("keeps exported defaults immutable and returns independent path arrays", () => {
      assertThrows(
        () => (DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs as string[]).push("other"),
        TypeError,
      );

      const first = createProjectDiscoveryConfig({ projectDir: "/project" });
      const second = createProjectDiscoveryConfig({ projectDir: "/project" });
      first.toolDirs.push("custom-tools");

      assertEquals(second.toolDirs, ["tools"]);
      assertEquals(DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs, ["tools"]);
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
      assertEquals(result.tasks.size, 0);
      assertEquals(result.schedules.size, 0);
      assertEquals(result.webhooks.size, 0);
      assertEquals(result.evals.size, 0);
      assertEquals(result.errors.length, 0);
    });
  });
});
