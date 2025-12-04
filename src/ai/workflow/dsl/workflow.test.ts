/**
 * Workflow DSL Tests
 */

import {
  assertEquals,
  assertExists,
  assertThrows,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { dag, dependsOn, sequence, workflow } from "./workflow.ts";
import { step } from "./step.ts";

describe("workflow()", () => {
  it("should create a workflow with static steps", () => {
    const wf = workflow({
      id: "test-workflow",
      steps: [
        step("step1", { agent: "test-agent" }),
        step("step2", { tool: "test-tool" }),
      ],
    });

    assertEquals(wf.id, "test-workflow");
    assertExists(wf.definition);
    assertEquals(wf.definition.id, "test-workflow");
  });

  it("should create a workflow with dynamic steps", () => {
    const wf = workflow<{ topic: string }>({
      id: "dynamic-workflow",
      steps: ({ input }) => [
        step("research", { agent: "researcher", input: input.topic }),
      ],
    });

    assertEquals(wf.id, "dynamic-workflow");
    assertExists(wf.definition.steps);
    assertEquals(typeof wf.definition.steps, "function");
  });

  it("should include optional fields", () => {
    const wf = workflow({
      id: "full-workflow",
      description: "A test workflow",
      version: "1.0.0",
      timeout: "1h",
      retry: { maxAttempts: 3 },
      steps: [],
    });

    assertEquals(wf.definition.description, "A test workflow");
    assertEquals(wf.definition.version, "1.0.0");
    assertEquals(wf.definition.timeout, "1h");
    assertEquals(wf.definition.retry?.maxAttempts, 3);
  });

  it("should throw on missing id", () => {
    assertThrows(
      // @ts-expect-error Testing invalid input
      () => workflow({ steps: [] }),
      Error,
      "id",
    );
  });

  it("should throw on missing steps", () => {
    assertThrows(
      // @ts-expect-error Testing invalid input
      () => workflow({ id: "test" }),
      Error,
      "steps",
    );
  });
});

describe("sequence()", () => {
  it("should add dependsOn to sequential nodes", () => {
    const nodes = sequence(
      step("step1", { agent: "agent1" }),
      step("step2", { agent: "agent2" }),
      step("step3", { agent: "agent3" }),
    );

    assertEquals(nodes.length, 3);
    assertEquals(nodes[0]!.dependsOn, undefined);
    assertEquals(nodes[1]!.dependsOn, ["step1"]);
    assertEquals(nodes[2]!.dependsOn, ["step2"]);
  });

  it("should handle single node", () => {
    const nodes = sequence(step("only", { agent: "agent" }));

    assertEquals(nodes.length, 1);
    assertEquals(nodes[0]!.dependsOn, undefined);
  });

  it("should handle empty array", () => {
    const nodes = sequence();
    assertEquals(nodes.length, 0);
  });
});

describe("dag()", () => {
  it("should create nodes from object", () => {
    const nodes = dag({
      fetch: step("fetch", { tool: "fetcher" }),
      process: step("process", { agent: "processor" }),
    });

    assertEquals(nodes.length, 2);
    assertEquals(nodes[0]!.id, "fetch");
    assertEquals(nodes[1]!.id, "process");
  });

  it("should handle nodes with explicit dependencies", () => {
    const nodes = dag({
      fetch: step("fetch", { tool: "fetcher" }),
      process: {
        node: step("process", { agent: "processor" }),
        dependsOn: ["fetch"],
      },
    });

    assertEquals(nodes.length, 2);
    assertEquals(nodes[1]!.dependsOn, ["fetch"]);
  });
});

describe("dependsOn()", () => {
  it("should add single dependency", () => {
    const node = dependsOn(
      step("process", { agent: "processor" }),
      "fetch",
    );

    assertEquals(node.dependsOn, ["fetch"]);
  });

  it("should add multiple dependencies", () => {
    const node = dependsOn(
      step("merge", { tool: "merger" }),
      "step1",
      "step2",
      "step3",
    );

    assertEquals(node.dependsOn, ["step1", "step2", "step3"]);
  });

  it("should append to existing dependencies", () => {
    const nodeWithDeps = { ...step("test", { agent: "a" }), dependsOn: ["existing"] };
    const node = dependsOn(nodeWithDeps, "new");

    assertEquals(node.dependsOn, ["existing", "new"]);
  });
});
