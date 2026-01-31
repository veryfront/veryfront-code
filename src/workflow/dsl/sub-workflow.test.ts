import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { subWorkflow } from "./sub-workflow.ts";
import type { WorkflowDefinition } from "../types.ts";

describe("workflow/dsl/sub-workflow", () => {
  describe("subWorkflow", () => {
    it("should create a sub-workflow node", () => {
      const dummyWorkflow = { id: "child", steps: [] };
      const node = subWorkflow("nested", { workflow: dummyWorkflow });

      assertEquals(node.id, "nested");
      assertEquals(node.config.type, "subWorkflow");
    });

    it("should throw for empty id", () => {
      assertThrows(
        () => subWorkflow("", { workflow: { id: "w", steps: [] } }),
        Error,
        "non-empty",
      );
    });

    it("should throw for missing workflow", () => {
      assertThrows(
        () =>
          subWorkflow("test", {
            workflow: undefined as unknown as WorkflowDefinition,
          }),
        Error,
        "workflow",
      );
    });

    it("should pass through optional config", () => {
      const node = subWorkflow("nested", {
        workflow: { id: "w", steps: [] },
        checkpoint: true,
        timeout: "30s",
      });

      assertEquals(node.config.checkpoint, true);
      assertEquals(node.config.timeout, "30s");
    });
  });
});
