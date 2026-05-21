import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatWorkflowDiscoveryErrors } from "./command.ts";

describe("workflow command", () => {
  it("formats workflow load errors for non-debug logs", () => {
    const lines = formatWorkflowDiscoveryErrors([
      {
        filePath: "workflows/my-workflow.ts",
        error: "Step \"start\" must specify either 'agent' or 'tool'",
      },
    ]);

    assertEquals(lines, [
      "  - workflows/my-workflow.ts: Step \"start\" must specify either 'agent' or 'tool'",
    ]);
  });

  it("limits workflow load errors in logs", () => {
    const lines = formatWorkflowDiscoveryErrors(
      Array.from({ length: 6 }, (_, index) => ({
        filePath: `workflows/workflow-${index}.ts`,
        error: "Invalid workflow",
      })),
    );

    assertEquals(lines.length, 6);
    assertEquals(lines.at(-1), "  - 1 more workflow file failed to load");
  });
});
