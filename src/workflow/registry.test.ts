import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getAllWorkflowIds, getWorkflow, registerWorkflow, workflowRegistry } from "./registry.ts";
import type { WorkflowDefinition, WorkflowNode } from "./types.ts";
import { workflow } from "./dsl/workflow.ts";
import { step } from "./dsl/step.ts";
import { parallel } from "./dsl/parallel.ts";
import { branch } from "./dsl/branch.ts";

function node(id: string, type: string): WorkflowNode {
  return { id, config: { type } as WorkflowNode["config"] };
}

describe("WorkflowRegistry", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  describe("register()", () => {
    it("should register a workflow definition", () => {
      const definition: WorkflowDefinition = {
        id: "test-workflow",
        description: "A test workflow",
        steps: [],
      };

      workflowRegistry.register({ definition, id: "test-workflow" });

      assertEquals(workflowRegistry.has("test-workflow"), true);
    });

    it("should register a plain workflow definition", () => {
      const definition: WorkflowDefinition = {
        id: "plain-workflow",
        steps: [node("step1", "step")],
      };

      workflowRegistry.register(definition);

      assertEquals(workflowRegistry.has("plain-workflow"), true);
    });

    it("should extract metadata from definition", () => {
      const definition: WorkflowDefinition = {
        id: "metadata-test",
        description: "Test description",
        version: "1.0.0",
        timeout: "30m",
        steps: [node("step1", "step"), node("step2", "parallel")],
      };

      workflowRegistry.register(definition);

      const metadata = workflowRegistry.get("metadata-test");
      assertExists(metadata);
      assertEquals(metadata.id, "metadata-test");
      assertEquals(metadata.description, "Test description");
      assertEquals(metadata.version, "1.0.0");
      assertEquals(metadata.timeout, "30m");
      assertEquals(metadata.nodeCount, 2);
      assertEquals(metadata.nodeTypes.sort(), ["parallel", "step"]);
      assertEquals(metadata.hasInputSchema, false);
      assertEquals(metadata.hasOutputSchema, false);
    });
  });

  describe("get()", () => {
    it("should return metadata for registered workflow", () => {
      workflowRegistry.register({ id: "get-test", steps: [] });

      const metadata = workflowRegistry.get("get-test");
      assertExists(metadata);
      assertEquals(metadata.id, "get-test");
    });

    it("should return undefined for non-existent workflow", () => {
      assertEquals(workflowRegistry.get("non-existent"), undefined);
    });
  });

  describe("getDefinition()", () => {
    it("should return definition for registered workflow", () => {
      const definition: WorkflowDefinition = {
        id: "def-test",
        description: "Definition test",
        steps: [],
      };

      workflowRegistry.register(definition);

      const stored = workflowRegistry.getDefinition("def-test");
      assertExists(stored);
      assertEquals(stored.id, "def-test");
      assertEquals(stored.description, "Definition test");
    });

    it("should return undefined for non-existent workflow", () => {
      assertEquals(workflowRegistry.getDefinition("non-existent"), undefined);
    });
  });

  describe("has()", () => {
    it("should return true for registered workflow", () => {
      workflowRegistry.register({ id: "has-test", steps: [] });
      assertEquals(workflowRegistry.has("has-test"), true);
    });

    it("should return false for non-registered workflow", () => {
      assertEquals(workflowRegistry.has("not-registered"), false);
    });
  });

  describe("getAllIds()", () => {
    it("should return all registered workflow IDs", () => {
      workflowRegistry.register({ id: "wf-1", steps: [] });
      workflowRegistry.register({ id: "wf-2", steps: [] });
      workflowRegistry.register({ id: "wf-3", steps: [] });

      const ids = workflowRegistry.getAllIds();
      assertEquals(ids.length, 3);
      assertEquals(ids.sort(), ["wf-1", "wf-2", "wf-3"]);
    });

    it("should return empty array when no workflows registered", () => {
      assertEquals(workflowRegistry.getAllIds(), []);
    });
  });

  describe("getAll()", () => {
    it("should return all workflow metadata as a Map", () => {
      workflowRegistry.register({ id: "map-1", steps: [] });
      workflowRegistry.register({ id: "map-2", steps: [] });

      const all = workflowRegistry.getAll();
      assertEquals(all.size, 2);
      assertExists(all.get("map-1"));
      assertExists(all.get("map-2"));
    });
  });

  describe("getAllAsArray()", () => {
    it("should return all workflow metadata as an array", () => {
      workflowRegistry.register({ id: "arr-1", steps: [] });
      workflowRegistry.register({ id: "arr-2", steps: [] });

      const all = workflowRegistry.getAllAsArray();
      assertEquals(all.length, 2);
      assertEquals(all.map((m) => m.id).sort(), ["arr-1", "arr-2"]);
    });
  });

  describe("getStats()", () => {
    it("should return correct statistics", () => {
      workflowRegistry.register({
        id: "stats-1",
        steps: [node("s1", "step"), node("s2", "step")],
      });
      workflowRegistry.register({
        id: "stats-2",
        steps: [node("p1", "parallel")],
      });

      const stats = workflowRegistry.getStats();
      assertEquals(stats.total, 2);
      assertEquals(stats.byNodeType["step"], 1);
      assertEquals(stats.byNodeType["parallel"], 1);
    });

    it("should count schemas", () => {
      workflowRegistry.register({
        id: "schema-test",
        inputSchema: {} as import("zod").ZodSchema,
        outputSchema: {} as import("zod").ZodSchema,
        steps: [],
      });

      const stats = workflowRegistry.getStats();
      assertEquals(stats.withInputSchema, 1);
      assertEquals(stats.withOutputSchema, 1);
    });
  });

  describe("unregister()", () => {
    it("should remove a workflow", () => {
      workflowRegistry.register({ id: "to-remove", steps: [] });
      assertEquals(workflowRegistry.has("to-remove"), true);

      const result = workflowRegistry.unregister("to-remove");
      assertEquals(result, true);
      assertEquals(workflowRegistry.has("to-remove"), false);
    });

    it("should return false for non-existent workflow", () => {
      assertEquals(workflowRegistry.unregister("not-there"), false);
    });
  });

  describe("clear()", () => {
    it("should remove all workflows", () => {
      workflowRegistry.register({ id: "clear-1", steps: [] });
      workflowRegistry.register({ id: "clear-2", steps: [] });

      workflowRegistry.clear();

      assertEquals(workflowRegistry.getAllIds(), []);
    });
  });
});

describe("Exported helper functions", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  describe("registerWorkflow()", () => {
    it("should register via helper function", () => {
      registerWorkflow({ id: "helper-test", steps: [] });
      assertEquals(workflowRegistry.has("helper-test"), true);
    });
  });

  describe("getWorkflow()", () => {
    it("should get workflow via helper function", () => {
      workflowRegistry.register({ id: "get-helper", steps: [] });

      const metadata = getWorkflow("get-helper");
      assertExists(metadata);
      assertEquals(metadata.id, "get-helper");
    });
  });

  describe("getAllWorkflowIds()", () => {
    it("should get all IDs via helper function", () => {
      workflowRegistry.register({ id: "ids-1", steps: [] });
      workflowRegistry.register({ id: "ids-2", steps: [] });

      const ids = getAllWorkflowIds();
      assertEquals(ids.sort(), ["ids-1", "ids-2"]);
    });
  });
});

describe("Auto-registration with workflow() DSL", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  it("should auto-register when creating workflow via DSL", () => {
    const wf = workflow({
      id: "auto-registered",
      description: "Auto-registered workflow",
      steps: [step("step1", { agent: "test-agent" })],
    });

    assertEquals(wf.id, "auto-registered");
    assertEquals(workflowRegistry.has("auto-registered"), true);

    const metadata = workflowRegistry.get("auto-registered");
    assertExists(metadata);
    assertEquals(metadata.description, "Auto-registered workflow");
    assertEquals(metadata.nodeCount, 1);
  });

  it("should extract node types from parallel nodes", () => {
    workflow({
      id: "parallel-test",
      steps: [
        parallel("p1", [
          step("s1", { agent: "a1" }),
          step("s2", { agent: "a2" }),
        ]),
      ],
    });

    const metadata = workflowRegistry.get("parallel-test");
    assertExists(metadata);
    assertEquals(metadata.nodeTypes.includes("parallel"), true);
  });

  it("should extract node types from branch nodes", () => {
    workflow({
      id: "branch-test",
      steps: [
        branch("b1", {
          condition: () => true,
          then: [step("then-step", { agent: "a1" })],
          else: [step("else-step", { agent: "a2" })],
        }),
      ],
    });

    const metadata = workflowRegistry.get("branch-test");
    assertExists(metadata);
    assertEquals(metadata.nodeTypes.includes("branch"), true);
  });
});
