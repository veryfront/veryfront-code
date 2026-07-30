import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearTranspileCache,
  createProjectDiscoveryConfig,
  DEFAULT_PROJECT_DISCOVERY_DIRS,
  discoverAll,
  getProjectDiscoveryDirectories,
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

  describe("project discovery configuration", () => {
    it("preserves a bounded source-generation cache namespace", () => {
      const config = createProjectDiscoveryConfig({
        projectDir: "/project",
        cacheNamespace: "project:preview:main:snapshot:7",
      });

      assertEquals(config.cacheNamespace, "project:preview:main:snapshot:7");
    });

    it("rejects invalid cache namespaces before discovery", () => {
      for (const cacheNamespace of ["", "project\0snapshot", "x".repeat(4_097)]) {
        assertThrows(
          () =>
            createProjectDiscoveryConfig({
              projectDir: "/project",
              cacheNamespace,
            }),
          Error,
          "cacheNamespace",
        );
      }
    });

    it("uses one enabled-path set for discovery and file watching", () => {
      const config = createProjectDiscoveryConfig({
        projectDir: "/project",
        config: {
          ai: {
            prompts: {
              discovery: { paths: ["src/ai/prompts", "shared/primitives"] },
            },
            resources: {
              discovery: { paths: ["content/resources", "shared/primitives"] },
            },
            workflows: {
              discovery: { enabled: false },
            },
          },
        },
      });

      assertEquals(config.promptDirs, ["src/ai/prompts", "shared/primitives"]);
      assertEquals(config.resourceDirs, ["content/resources", "shared/primitives"]);
      assertEquals(config.workflowDirs, []);
      assertEquals(getProjectDiscoveryDirectories(config), [
        "tools",
        "agents",
        "skills",
        "content/resources",
        "shared/primitives",
        "src/ai/prompts",
        "tasks",
        "schedules",
        "webhooks",
        "evals",
      ]);
    });

    it("returns canonical detached path snapshots and immutable defaults", () => {
      const configuredPaths = ["tools", "nested/tools"];
      const config = createProjectDiscoveryConfig({
        projectDir: "/project",
        config: {
          ai: {
            tools: {
              discovery: {
                paths: configuredPaths,
              },
            },
          },
        },
      });

      configuredPaths.push("late-mutation");

      assertEquals(config.toolDirs, ["tools", "nested/tools"]);
      assertEquals(Object.isFrozen(DEFAULT_PROJECT_DISCOVERY_DIRS), true);
      assertEquals(Object.isFrozen(DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs), true);
    });

    it("rejects discovery paths that can escape or alias the project root", () => {
      for (
        const path of [
          "",
          ".",
          "../tools",
          "tools/../outside",
          "tools//nested",
          "/absolute/tools",
          String.raw`C:\absolute\tools`,
          String.raw`C:relative\tools`,
          "file:///absolute/tools",
          "FILE:///absolute/tools",
        ]
      ) {
        assertThrows(
          () =>
            createProjectDiscoveryConfig({
              projectDir: "/project",
              config: {
                ai: {
                  tools: {
                    discovery: { paths: [path] },
                  },
                },
              },
            }),
          Error,
          "discovery path",
        );
      }
    });

    it("rejects unsafe direct discovery config before filesystem access", async () => {
      let filesystemCalls = 0;
      const fsAdapter = {
        exists: () => {
          filesystemCalls++;
          return Promise.resolve(false);
        },
      } as unknown as FileSystemAdapter;

      await assertRejects(
        () =>
          discoverAll({
            baseDir: "/project",
            toolDirs: ["../outside"],
            fsAdapter,
          }),
        Error,
        "tool discovery path is invalid",
      );
      assertEquals(filesystemCalls, 0);
    });

    it("rejects file-URL base directories before filesystem access", async () => {
      let filesystemCalls = 0;
      const fsAdapter = {
        exists: () => {
          filesystemCalls++;
          return Promise.resolve(false);
        },
      } as unknown as FileSystemAdapter;

      await assertRejects(
        () =>
          discoverAll({
            baseDir: "FILE:///project",
            fsAdapter,
          }),
        Error,
        "baseDir",
      );
      assertEquals(filesystemCalls, 0);
    });

    it("snapshots direct discovery config before the first asynchronous read", async () => {
      const firstRead = Promise.withResolvers<boolean>();
      const inspectedPaths: string[] = [];
      const fsAdapter = {
        exists: (path: string) => {
          inspectedPaths.push(path);
          return inspectedPaths.length === 1 ? firstRead.promise : Promise.resolve(false);
        },
      } as unknown as FileSystemAdapter;
      const toolDirs = ["tools"];
      const discovery = discoverAll({
        baseDir: "/project",
        toolDirs,
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
      });

      toolDirs.push("late-mutation");
      firstRead.resolve(false);
      await discovery;

      assertEquals(inspectedPaths, ["/project/tools"]);
    });
  });
});
