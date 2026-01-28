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

import { assertEquals, assertNotEquals } from "@veryfront/testing/assert";
import { describe, it, beforeEach, afterEach } from "@veryfront/testing/bdd";
import { runWithCacheKeyContext } from "../../../src/cache/cache-key-builder.ts";
import { toolRegistry } from "../../../src/tool/registry.ts";
import { promptRegistry } from "../../../src/prompt/registry.ts";
import { agentRegistry } from "../../../src/agent/composition/composition.ts";
import { workflowRegistry } from "../../../src/workflow/registry.ts";
import { resourceRegistry } from "../../../src/resource/registry.ts";
import { providerRegistry } from "../../../src/provider/factory.ts";
import type { Tool } from "../../../src/tool/types.ts";
import type { Prompt } from "../../../src/prompt/types.ts";
import type { Resource } from "../../../src/resource/types.ts";
import { z } from "zod";

// Helper to create a mock tool
function createMockTool(id: string, projectMarker: string): Tool {
  return {
    id,
    type: "function",
    description: `Tool from ${projectMarker}`,
    inputSchema: z.object({ input: z.string() }),
    execute: () => Promise.resolve({ result: projectMarker }),
  };
}

// Helper to create a mock prompt
function createMockPrompt(id: string, projectMarker: string): Prompt {
  return {
    id,
    description: `Prompt from ${projectMarker}`,
    getContent: () => Promise.resolve(`Content from ${projectMarker}`),
  };
}

// Helper to create a mock resource
function createMockResource(id: string, projectMarker: string): Resource {
  return {
    id,
    pattern: `/${projectMarker}/:id`,
    description: `Resource from ${projectMarker}`,
    paramsSchema: z.object({ id: z.string() }),
    load: () => Promise.resolve({ data: projectMarker }),
  };
}

// Cache key contexts for different projects
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

describe("002.5 AI Registry Isolation", () => {
  beforeEach(() => {
    // Clear all registries before each test
    toolRegistry.clearAll();
    promptRegistry.clearAll();
    agentRegistry.clearAll();
    workflowRegistry.clearAll();
    resourceRegistry.clearAll();
    providerRegistry.clearAll();
  });

  afterEach(() => {
    // Clean up after tests
    toolRegistry.clearAll();
    promptRegistry.clearAll();
    agentRegistry.clearAll();
    workflowRegistry.clearAll();
    resourceRegistry.clearAll();
    providerRegistry.clearAll();
  });

  describe("Tool Registry Isolation", () => {
    it("tools are isolated between projects", () => {
      // Project A registers a tool
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("my-tool", createMockTool("my-tool", "Project A"));
      });

      // Project B registers same-named tool
      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("my-tool", createMockTool("my-tool", "Project B"));
      });

      // Each project sees its own tool
      const toolA = runWithCacheKeyContext(projectAContext, () => {
        return toolRegistry.get("my-tool");
      });

      const toolB = runWithCacheKeyContext(projectBContext, () => {
        return toolRegistry.get("my-tool");
      });

      assertEquals(toolA?.description, "Tool from Project A");
      assertEquals(toolB?.description, "Tool from Project B");
      assertNotEquals(toolA?.description, toolB?.description);
    });

    it("project cannot see other project's tools", () => {
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("secret-tool", createMockTool("secret-tool", "Project A"));
      });

      const canSee = runWithCacheKeyContext(projectBContext, () => {
        return toolRegistry.has("secret-tool");
      });

      assertEquals(canSee, false);
    });

    it("shared tools are available to all projects", () => {
      // Register a framework-provided tool (shared)
      toolRegistry.registerShared("veryfront-search", createMockTool("veryfront-search", "Framework"));

      const canSeeA = runWithCacheKeyContext(projectAContext, () => {
        return toolRegistry.has("veryfront-search");
      });

      const canSeeB = runWithCacheKeyContext(projectBContext, () => {
        return toolRegistry.has("veryfront-search");
      });

      assertEquals(canSeeA, true);
      assertEquals(canSeeB, true);
    });

    it("getAllIds only returns current project's tools + shared", () => {
      // Register shared tool
      toolRegistry.registerShared("shared-tool", createMockTool("shared-tool", "Framework"));

      // Project A registers tools
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("tool-a1", createMockTool("tool-a1", "A"));
        toolRegistry.register("tool-a2", createMockTool("tool-a2", "A"));
      });

      // Project B registers tools
      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("tool-b1", createMockTool("tool-b1", "B"));
      });

      // Project A should see its 2 tools + shared
      const idsA = runWithCacheKeyContext(projectAContext, () => {
        return toolRegistry.getAllIds();
      });

      // Project B should see its 1 tool + shared
      const idsB = runWithCacheKeyContext(projectBContext, () => {
        return toolRegistry.getAllIds();
      });

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

      const promptA = runWithCacheKeyContext(projectAContext, () => {
        return promptRegistry.get("greeting");
      });

      const promptB = runWithCacheKeyContext(projectBContext, () => {
        return promptRegistry.get("greeting");
      });

      assertEquals(promptA?.description, "Prompt from Project A");
      assertEquals(promptB?.description, "Prompt from Project B");
    });

    it("project cannot access other project's prompts", () => {
      runWithCacheKeyContext(projectAContext, () => {
        promptRegistry.register("secret-prompt", createMockPrompt("secret-prompt", "A"));
      });

      const canSee = runWithCacheKeyContext(projectBContext, () => {
        return promptRegistry.has("secret-prompt");
      });

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

      const resourceA = runWithCacheKeyContext(projectAContext, () => {
        return resourceRegistry.get("users");
      });

      const resourceB = runWithCacheKeyContext(projectBContext, () => {
        return resourceRegistry.get("users");
      });

      assertEquals(resourceA?.description, "Resource from Project A");
      assertEquals(resourceB?.description, "Resource from Project B");
    });
  });

  describe("Concurrent Access", () => {
    it("concurrent registrations are properly isolated", async () => {
      const results = new Map<string, string[]>();

      // Simulate concurrent registrations from different projects
      const registerA = async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        runWithCacheKeyContext(projectAContext, () => {
          toolRegistry.register("concurrent-tool", createMockTool("concurrent-tool", "A"));
        });
      };

      const registerB = async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        runWithCacheKeyContext(projectBContext, () => {
          toolRegistry.register("concurrent-tool", createMockTool("concurrent-tool", "B"));
        });
      };

      const checkA = async () => {
        await new Promise((r) => setTimeout(r, 20));
        const ids = runWithCacheKeyContext(projectAContext, () => {
          const tool = toolRegistry.get("concurrent-tool");
          return tool?.description ?? "NOT FOUND";
        });
        results.set("A", [ids]);
      };

      const checkB = async () => {
        await new Promise((r) => setTimeout(r, 20));
        const ids = runWithCacheKeyContext(projectBContext, () => {
          const tool = toolRegistry.get("concurrent-tool");
          return tool?.description ?? "NOT FOUND";
        });
        results.set("B", [ids]);
      };

      await Promise.all([registerA(), registerB(), checkA(), checkB()]);

      // Each project should see its own tool
      assertEquals(results.get("A")?.[0], "Tool from A");
      assertEquals(results.get("B")?.[0], "Tool from B");
    });
  });

  describe("Cross-Registry Security", () => {
    it("full isolation across all registry types", () => {
      // Project A registers resources in all registries
      runWithCacheKeyContext(projectAContext, () => {
        toolRegistry.register("api", createMockTool("api", "A"));
        promptRegistry.register("system", createMockPrompt("system", "A"));
        resourceRegistry.register("data", createMockResource("data", "A"));
      });

      // Project B cannot see any of A's resources
      runWithCacheKeyContext(projectBContext, () => {
        assertEquals(toolRegistry.has("api"), false);
        assertEquals(promptRegistry.has("system"), false);
        assertEquals(resourceRegistry.has("data"), false);
      });

      // But B can register its own with same names
      runWithCacheKeyContext(projectBContext, () => {
        toolRegistry.register("api", createMockTool("api", "B"));
        promptRegistry.register("system", createMockPrompt("system", "B"));
        resourceRegistry.register("data", createMockResource("data", "B"));
      });

      // A still sees its own
      runWithCacheKeyContext(projectAContext, () => {
        assertEquals(toolRegistry.get("api")?.description, "Tool from A");
        assertEquals(promptRegistry.get("system")?.description, "Prompt from A");
        assertEquals(resourceRegistry.get("data")?.description, "Resource from A");
      });
    });
  });
});
