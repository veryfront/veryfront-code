import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "../../limits.ts";
import type { WorkflowNode } from "../../types.ts";
import { canonicalizeWorkflowNodes } from "./node-identity.ts";

function stepNode(id: string): WorkflowNode {
  return { id, config: { type: "step", tool: "test" } };
}

function staticMapNode(id: string, itemCount: number, processor: WorkflowNode): WorkflowNode {
  return {
    id,
    config: {
      type: "map",
      items: Array.from({ length: itemCount }, (_, index) => index),
      processor,
    },
  };
}

describe("Workflow DAG node identity", () => {
  it("rejects root identities reserved for dynamic map items", () => {
    const dynamicMap: WorkflowNode = {
      id: "map",
      config: {
        type: "map",
        items: () => [],
        processor: stepNode("processor"),
      },
    };

    assertThrows(
      () => canonicalizeWorkflowNodes([dynamicMap, stepNode("map_0")]),
      Error,
      'node ID "map_0" collides with dynamic map item identities',
    );
    assertThrows(
      () => canonicalizeWorkflowNodes([stepNode("map_12/child"), dynamicMap]),
      Error,
      'node ID "map_12/child" collides with dynamic map item identities',
    );

    assertEquals(canonicalizeWorkflowNodes([dynamicMap, stepNode("map_helper")]).length, 2);
  });

  it("rejects root identities reserved for dynamic loop descendants", () => {
    const dynamicLoop: WorkflowNode = {
      id: "loop",
      config: {
        type: "loop",
        while: () => false,
        steps: () => [],
        maxIterations: 1,
      },
    };

    assertThrows(
      () => canonicalizeWorkflowNodes([dynamicLoop, stepNode("loop/child")]),
      Error,
      'node ID "loop/child" collides with dynamic loop descendants',
    );
  });

  it("rejects static map expansion beyond the persistent identity budget", () => {
    const accepted = staticMapNode(
      "outer",
      99,
      staticMapNode("inner", 100, stepNode("leaf")),
    );
    assertEquals(canonicalizeWorkflowNodes([accepted]).length, 1);

    const oversized = staticMapNode(
      "outer",
      100,
      staticMapNode("inner", 100, stepNode("leaf")),
    );
    assertThrows(
      () => canonicalizeWorkflowNodes([oversized]),
      Error,
      "cannot expand beyond 10000 persistent node identities",
    );
  });

  it("rejects generated identities that exceed the public ID limit", () => {
    const map = staticMapNode(
      "m".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS),
      1,
      stepNode("processor"),
    );

    assertThrows(
      () => canonicalizeWorkflowNodes([map]),
      Error,
      `Derived workflow node ID cannot exceed ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units`,
    );
  });
});
