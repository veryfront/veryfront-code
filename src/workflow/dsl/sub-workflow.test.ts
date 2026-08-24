import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { subWorkflow } from "./sub-workflow.ts";
import type {
  SubWorkflowNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";

function expectSubWorkflowConfig(node: WorkflowNode): SubWorkflowNodeConfig {
  if (node.config.type !== "subWorkflow") {
    throw new Error(`Expected subWorkflow node, got ${node.config.type}`);
  }
  return node.config;
}

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
      const childWorkflow: WorkflowDefinition = { id: "w", steps: [] };
      const input = (context: WorkflowContext) => context;
      const output = (result: unknown) => result;
      const node = subWorkflow("nested", {
        workflow: childWorkflow,
        checkpoint: true,
        timeout: "30s",
        input,
        output,
      });

      assertEquals(node.config.checkpoint, true);
      assertEquals(node.config.timeout, "30s");

      const config = expectSubWorkflowConfig(node);
      assertEquals(config.workflow, childWorkflow, "subWorkflow must forward the child definition");
      assertEquals(config.input, input, "subWorkflow must forward the input mapper");
      assertEquals(config.output, output, "subWorkflow must forward the output transform");
    });
  });
});
