import "#veryfront/schemas/_test-setup.ts";
/**
 * Composite Namespacing Tests
 *
 * Composite builders prefix child IDs into their own namespace. Every
 * reference to those IDs has to move with them, otherwise the child graph
 * cannot resolve its own dependencies.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { branch } from "./branch.ts";
import { loop } from "./loop.ts";
import { parallel } from "./parallel.ts";
import { step } from "./step.ts";
import type {
  BranchNodeConfig,
  LoopNodeConfig,
  ParallelNodeConfig,
  WorkflowNode,
} from "../types.ts";
import { buildGraph } from "../executor/dag/graph.ts";
import { removeWorkflowNodeNamespace } from "./validation.ts";

function dependentStep(id: string, dependsOn: string[]): WorkflowNode {
  return { ...step(id, { tool: "noop" }), dependsOn };
}

function parallelConfig(node: WorkflowNode): ParallelNodeConfig {
  return node.config as ParallelNodeConfig;
}

function branchConfig(node: WorkflowNode): BranchNodeConfig {
  return node.config as BranchNodeConfig;
}

function loopConfig(node: WorkflowNode): LoopNodeConfig {
  return node.config as LoopNodeConfig;
}

describe("composite node namespacing", () => {
  it("rebases dependsOn references inside a parallel node", () => {
    const node = parallel("fanout", [
      step("first", { tool: "noop" }),
      dependentStep("second", ["first"]),
    ]);

    const config = parallelConfig(node);
    assertEquals(config.nodes.map((child) => child.id), ["fanout/first", "fanout/second"]);
    assertEquals(config.nodes[1]?.dependsOn, ["fanout/first"]);

    // The child graph is what the executor actually runs; it must resolve.
    buildGraph(config.nodes);
  });

  it("rebases dependsOn references inside both branch arms", () => {
    const node = branch("review", {
      condition: () => true,
      then: [step("draft", { tool: "noop" }), dependentStep("publish", ["draft"])],
      else: [step("reject", { tool: "noop" }), dependentStep("notify", ["reject"])],
    });

    const config = branchConfig(node);
    assertEquals(config.then.map((child) => child.id), [
      "review/then/draft",
      "review/then/publish",
    ]);
    assertEquals(config.then[1]?.dependsOn, ["review/then/draft"]);
    buildGraph(config.then);

    assertEquals(config.else?.map((child) => child.id), [
      "review/else/reject",
      "review/else/notify",
    ]);
    assertEquals(config.else?.[1]?.dependsOn, ["review/else/reject"]);
    buildGraph(config.else ?? []);
  });

  it("rebases descendants of a nested composite into the outer namespace", () => {
    const node = parallel("outer", [
      branch("inner", {
        condition: () => true,
        then: [step("draft", { tool: "noop" }), dependentStep("publish", ["draft"])],
      }),
    ]);

    const inner = parallelConfig(node).nodes[0];
    assertEquals(inner?.id, "outer/inner");

    const nested = branchConfig(inner as WorkflowNode);
    assertEquals(nested.then.map((child) => child.id), [
      "outer/inner/then/draft",
      "outer/inner/then/publish",
    ]);
    assertEquals(nested.then[1]?.dependsOn, ["outer/inner/then/draft"]);
    buildGraph(nested.then);
  });

  it("namespaces static loop children and their dependencies", () => {
    const node = loop("poll", {
      while: () => true,
      maxIterations: 1,
      steps: [
        step("fetch", { tool: "noop" }),
        dependentStep("confirm", ["fetch"]),
      ],
    });

    const config = loopConfig(node);
    assertEquals(Array.isArray(config.steps), true);
    const steps = config.steps as WorkflowNode[];
    assertEquals(steps.map((child) => child.id), ["poll/fetch", "poll/confirm"]);
    assertEquals(steps[1]?.dependsOn, ["poll/fetch"]);
    buildGraph(steps);
  });

  it("restores a namespaced static graph for a suspended legacy iteration", () => {
    const node = loop("poll", {
      while: () => true,
      maxIterations: 1,
      steps: [
        step("fetch", { tool: "noop" }),
        dependentStep("confirm", ["fetch"]),
      ],
    });
    const restored = removeWorkflowNodeNamespace(
      "poll/",
      loopConfig(node).steps as WorkflowNode[],
    );

    assertEquals(restored.map((child) => child.id), ["fetch", "confirm"]);
    assertEquals(restored[1]?.dependsOn, ["fetch"]);
    buildGraph(restored);
  });

  it("rebases static loop descendants into an outer composite namespace", () => {
    const node = parallel("outer", [
      loop("poll", {
        while: () => true,
        maxIterations: 1,
        steps: [step("gate", { tool: "noop" })],
      }),
    ]);

    const nested = loopConfig(parallelConfig(node).nodes[0]!);
    assertEquals((nested.steps as WorkflowNode[]).map((child) => child.id), [
      "outer/poll/gate",
    ]);
  });

  it("leaves already-namespaced children and their references untouched", () => {
    const node = parallel("fanout", [
      step("fanout/first", { tool: "noop" }),
      dependentStep("fanout/second", ["fanout/first"]),
    ]);

    const config = parallelConfig(node);
    assertEquals(config.nodes.map((child) => child.id), ["fanout/first", "fanout/second"]);
    assertEquals(config.nodes[1]?.dependsOn, ["fanout/first"]);
  });

  it("preserves an empty dependency list", () => {
    const node = parallel("fanout", [
      dependentStep("only", []),
    ]);

    assertEquals(parallelConfig(node).nodes[0]?.dependsOn, []);
  });
});
