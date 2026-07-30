import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WorkflowNode } from "../../types.ts";
import { buildGraph, getReadyNodes, hasCycle } from "./graph.ts";

function node(id: string, dependsOn?: string[]): WorkflowNode {
  return {
    id,
    ...(dependsOn === undefined ? {} : { dependsOn }),
    config: { type: "step", agent: "test" },
  };
}

describe("Workflow DAG graph", () => {
  it("preserves implicit ordering in a mixed explicit graph", () => {
    const nodes = [node("a"), node("b"), node("c", ["b"])];
    const graph = buildGraph(nodes);

    assertEquals(graph.adjList.get("a"), ["b"]);
    assertEquals(graph.adjList.get("b"), ["c"]);
    assertEquals(getReadyNodes(graph.inDegree, {}), ["a"]);
    assertEquals(hasCycle(nodes, graph.adjList), false);
  });

  it("does not manufacture a cycle when an explicit edge reverses declaration order", () => {
    const nodes = [node("a", ["b"]), node("b")];
    const graph = buildGraph(nodes);

    assertEquals(graph.adjList.get("a"), []);
    assertEquals(graph.adjList.get("b"), ["a"]);
    assertEquals(getReadyNodes(graph.inDegree, {}), ["b"]);
    assertEquals(hasCycle(nodes, graph.adjList), false);
  });

  it("detects cycles iteratively at the maximum admitted graph size", () => {
    const count = 10_000;
    const nodes = Array.from(
      { length: count },
      (_, index) => node(`node-${index}`, index === 0 ? [] : [`node-${index - 1}`]),
    );
    const graph = buildGraph(nodes);

    assertEquals(hasCycle(nodes, graph.adjList), false);

    graph.adjList.get(`node-${count - 1}`)!.push("node-0");
    assertEquals(hasCycle(nodes, graph.adjList), true);
  });
});
