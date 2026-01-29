import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { subWorkflow } from "./sub-workflow.ts";

describe("workflow/dsl/sub-workflow", () => {
  describe("subWorkflow", () => {
    it("should create a sub-workflow node", () => {
      const dummyWorkflow = { name: "child", steps: [] };
      const node = subWorkflow("nested", {
        workflow: dummyWorkflow,
      });
      assertEquals(node.id, "nested");
      assertEquals(node.config.type, "subWorkflow");
    });

    it("should throw for empty id", () => {
      assertThrows(
        () => subWorkflow("", { workflow: { name: "w", steps: [] } }),
        Error,
        "non-empty",
      );
    });

    it("should throw for missing workflow", () => {
      assertThrows(
        () =>
          subWorkflow("test", {
            workflow: undefined as unknown as { name: string; steps: [] },
          }),
        Error,
        "workflow",
      );
    });

    it("should pass through optional config", () => {
      const node = subWorkflow("nested", {
        workflow: { name: "w", steps: [] },
        checkpoint: true,
        timeout: "30s",
      });
      const config = node.config as {
        checkpoint: boolean;
        timeout: string;
      };
      assertEquals(config.checkpoint, true);
      assertEquals(config.timeout, "30s");
    });
  });
});
