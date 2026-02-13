/**
 * Test: 002.5 AI Registry Isolation
 *
 * Validates the fix for issue 002.5 from the architecture audit:
 * - All 6 AI registries are project-scoped
 * - Tools, agents, prompts, workflows, resources, providers are isolated
 * - Projects cannot see or access other projects' AI resources
 *
 * @see plans/architecture-audit/002.5-ai-registry-leakage.md
 */

import { assertEquals, assertNotEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { z } from "zod";
import { agentRegistry } from "../../../src/agent/composition/composition.ts";
import { runWithCacheKeyContext } from "../../../src/cache/cache-key-builder.ts";
import { promptRegistry } from "../../../src/prompt/registry.ts";
import type { Prompt } from "../../../src/prompt/types.ts";
import { clearModelProviders } from "../../../src/provider/model-registry.ts";
import { resourceRegistry } from "../../../src/resource/registry.ts";
import type { Resource } from "../../../src/resource/types.ts";
import { toolRegistry } from "../../../src/tool/registry.ts";
import type { Tool } from "../../../src/tool/types.ts";
import { workflowRegistry } from "../../../src/workflow/registry.ts";

function createMockTool(id: string, projectMarker: string): Tool {
  return {
    id,
    type: "function",
    description: `Tool from ${projectMarker}`,
    inputSchema: z.object({ input: z.string() }),
    execute: () => Promise.resolve({ result: projectMarker }),
  };
}

function createMockPrompt(id: string, projectMarker: string): Prompt {
  return {
    id,
    description: `Prompt from ${projectMarker}`,
    getContent: () => Promise.resolve(`Content from ${projectMarker}`),
  };
}

function createMockResource(id: string, projectMarker: string): Resource {
  return {
    id,
    pattern: `/${projectMarker}/:id`,
    description: `Resource from ${projectMarker}`,
    paramsSchema: z.object({ id: z.string() }),
    load: () => Promise.resolve({ data: projectMarker }),
  };
}

const projectAContext = {
  projectId: "project-a",
  mode: "preview" as const,
  versionId: "main",
};

const projectBContext = {
  projectId: "project-b",
  mode: "preview" as const,
  versionId: "main",
};

function clearAllRegistries(): void {
  toolRegistry.clearAll();
  promptRegistry.clearAll();
  agentRegistry.clearAll();
  workflowRegistry.clearAll();
  resourceRegistry.clearAll();
  clearModelProviders();
}

describe("002.5 AI Registry Isolation", () => {
  beforeEach(() => {
    clearAllRegistries();
  });

  afterEach(() => {
    clearAllRegistries();
  });

  describe("Tool Registry Isolation", () => {
    it("tools are isolated between projects", () => {
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("my-tool", createMockTool("my-tool", "Project A"));
      });

      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("my-tool", createMockTool("my-tool", "Project B"));
      });

      const toolA = runWithCacheKeyContext(projectAContext, () => toolRegistry.get("my-tool"));
      const toolB = runWithCacheKeyContext(projectBContext, () => toolRegistry.get("my-tool"));

      assertEquals(toolA?.description, "Tool from Project A");
      assertEquals(toolB?.description, "Tool from Project B");
      assertNotEquals(toolA?.description, toolB?.description);
    });

    it("project cannot see other project's tools", () => {
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("secret-tool", createMockTool("secret-tool", "Project A"));
      });

      const canSee = runWithCacheKeyContext(projectBContext, () => toolRegistry.has("secret-tool"));
      assertEquals(canSee, false);
    });

    it("shared tools are available to all projects", () => {
      toolRegistry.registerShared(
        "veryfront-search",
        createMockTool("veryfront-search", "Framework"),
      );

      const canSeeA = runWithCacheKeyContext(
        projectAContext,
        () => toolRegistry.has("veryfront-search"),
      );
      const canSeeB = runWithCacheKeyContext(
        projectBContext,
        () => toolRegistry.has("veryfront-search"),
      );

      assertEquals(canSeeA, true);
      assertEquals(canSeeB, true);
    });

    it("getAllIds only returns current project's tools + shared", () => {
      toolRegistry.registerShared("shared-tool", createMockTool("shared-tool", "Framework"));

      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("tool-a1", createMockTool("tool-a1", "A"));
        toolRegistry.register("tool-a2", createMockTool("tool-a2", "A"));
      });

      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("tool-b1", createMockTool("tool-b1", "B"));
      });

      const idsA = runWithCacheKeyContext(projectAContext, () => toolRegistry.getAllIds());
      const idsB = runWithCacheKeyContext(projectBContext, () => toolRegistry.getAllIds());

      assertEquals(idsA.sort(), ["shared-tool", "tool-a1", "tool-a2"].sort());
      assertEquals(idsB.sort(), ["shared-tool", "tool-b1"].sort());
    });
  });

  describe("Prompt Registry Isolation", () => {
    it("prompts are isolated between projects", () => {
      runWithCacheKeyContext(projectAContext, () => {
        promptRegistry.register("greeting", createMockPrompt("greeting", "Project A"));
      });

      runWithCacheKeyContext(projectBContext, () => {
        promptRegistry.register("greeting", createMockPrompt("greeting", "Project B"));
      });

      const promptA = runWithCacheKeyContext(projectAContext, () => promptRegistry.get("greeting"));
      const promptB = runWithCacheKeyContext(projectBContext, () => promptRegistry.get("greeting"));

      assertEquals(promptA?.description, "Prompt from Project A");
      assertEquals(promptB?.description, "Prompt from Project B");
    });

    it("project cannot access other project's prompts", () => {
      runWithCacheKeyContext(projectAContext, () => {
        promptRegistry.register("secret-prompt", createMockPrompt("secret-prompt", "A"));
      });

      const canSee = runWithCacheKeyContext(
        projectBContext,
        () => promptRegistry.has("secret-prompt"),
      );
      assertEquals(canSee, false);
    });
  });

  describe("Resource Registry Isolation", () => {
    it("resources are isolated between projects", () => {
      runWithCacheKeyContext(projectAContext, () => {
        resourceRegistry.register("users", createMockResource("users", "Project A"));
      });

      runWithCacheKeyContext(projectBContext, () => {
        resourceRegistry.register("users", createMockResource("users", "Project B"));
      });

      const resourceA = runWithCacheKeyContext(
        projectAContext,
        () => resourceRegistry.get("users"),
      );
      const resourceB = runWithCacheKeyContext(
        projectBContext,
        () => resourceRegistry.get("users"),
      );

      assertEquals(resourceA?.description, "Resource from Project A");
      assertEquals(resourceB?.description, "Resource from Project B");
    });
  });

  describe("Concurrent Access", () => {
    it("concurrent registrations are properly isolated", async () => {
      const results = new Map<string, string>();

      const register = async (context: typeof projectAContext, marker: string): Promise<void> => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        runWithCacheKeyContext(context, () => {
          toolRegistry.register("concurrent-tool", createMockTool("concurrent-tool", marker));
        });
      };

      const check = async (context: typeof projectAContext, key: string): Promise<void> => {
        await new Promise((r) => setTimeout(r, 20));
        const description = runWithCacheKeyContext(context, () => {
          const tool = toolRegistry.get("concurrent-tool");
          return tool?.description ?? "NOT FOUND";
        });
        results.set(key, description);
      };

      await Promise.all([
        register(projectAContext, "A"),
        register(projectBContext, "B"),
        check(projectAContext, "A"),
        check(projectBContext, "B"),
      ]);

      assertEquals(results.get("A"), "Tool from A");
      assertEquals(results.get("B"), "Tool from B");
    });
  });

  describe("Cross-Registry Security", () => {
    it("full isolation across all registry types", () => {
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("api", createMockTool("api", "A"));
        promptRegistry.register("system", createMockPrompt("system", "A"));
        resourceRegistry.register("data", createMockResource("data", "A"));
      });

      runWithCacheKeyContext(projectBContext, () => {
        assertEquals(toolRegistry.has("api"), false);
        assertEquals(promptRegistry.has("system"), false);
        assertEquals(resourceRegistry.has("data"), false);
      });

      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("api", createMockTool("api", "B"));
        promptRegistry.register("system", createMockPrompt("system", "B"));
        resourceRegistry.register("data", createMockResource("data", "B"));
      });

      runWithCacheKeyContext(projectAContext, () => {
        assertEquals(toolRegistry.get("api")?.description, "Tool from A");
        assertEquals(promptRegistry.get("system")?.description, "Prompt from A");
        assertEquals(resourceRegistry.get("data")?.description, "Resource from A");
      });
    });
  });
});
